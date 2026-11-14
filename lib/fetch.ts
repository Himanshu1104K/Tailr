// Daily pipeline: saved pool first → JSearch only if needed → filter → rank → store (dedupe) → send top N cards.
import { createHash } from "node:crypto";
import { config, errMsg, nowIn } from "./config";
import { all, first, getDb, kvGet, kvSet, type Job, type Lane, type WorkMode } from "./db";
import { experienceFits, fitScore, laneFor, matchesLocation, parseExperience, pickApplyUrl, workMode } from "./filter";
import { budget, searchJobs, StopSearching, type RawJob } from "./jsearch";
import { esc, notify, sendCards } from "./notify";
import { getBaseResume } from "./resume";

interface Candidate {
  dedupeKey: string;
  role: string;
  title: string;
  company: string;
  location: string;
  workMode: WorkMode;
  lane: Lane;
  ats: string | null;
  publisher: string;
  url: string;
  applyUrl: string;
  description: string;
  expMin: number | null;
  expMax: number | null;
  fitScore: number;
  postedAt: string | null;
}

/** Applies every filter; returns null if the job should be dropped. */
export function toCandidate(raw: RawJob, role: string, skills: string[]): Candidate | null {
  const { search } = config;
  const description = raw.job_description ?? "";
  const location = raw.job_location || [raw.job_city, raw.job_state, raw.job_country].filter(Boolean).join(", ");
  const mode = workMode(raw.job_is_remote, `${raw.job_title}\n${description}`);

  const exp = parseExperience(description, raw.job_required_experience?.required_experience_in_months);
  if (!experienceFits(exp, search.experienceYears)) return null;
  if (mode !== "remote" && !matchesLocation(location, search.locations)) return null;

  const score = fitScore({ role, title: raw.job_title, description, skills, postedAt: raw.job_posted_at_datetime_utc });
  if (mode === "remote" && (!search.includeRemote || score < search.remoteMinScore)) return null;

  const applyUrl = pickApplyUrl(raw.apply_options ?? [], raw.job_apply_link);
  if (!applyUrl) return null;

  const { lane, ats } = laneFor(applyUrl);
  // Same job reposted across publishers → same key.
  const dedupeKey = createHash("sha1")
    .update([raw.employer_name, raw.job_title, raw.job_city ?? location].map((s) => (s ?? "").trim().toLowerCase()).join("|"))
    .digest("hex");

  return {
    dedupeKey, role, title: raw.job_title, company: raw.employer_name, location, workMode: mode, lane, ats,
    publisher: raw.job_publisher ?? "", url: raw.job_apply_link || applyUrl, applyUrl, description,
    expMin: exp?.min ?? null, expMax: exp?.max ?? null, fitScore: score, postedAt: raw.job_posted_at_datetime_utc ?? null,
  };
}

// Unsent matches stay usable for a week; after that postings are likely filled or expired.
const POOL = "status = 'overflow' AND created_at >= datetime('now', '-7 days')";
// Rank at least this many candidates per card before picking, so the 5 sent are the best of a real choice.
const CANDIDATES_PER_CARD = 2;

const insertSql = `INSERT INTO jobs (dedupe_key, role, title, company, location, work_mode, lane, ats, publisher, url, apply_url,
    description, exp_min, exp_max, fit_score, posted_at, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'overflow')
  ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`;

/** Stores matches as 'overflow'; returns how many were new (ON CONFLICT drops jobs seen before). */
async function store(cands: Candidate[]) {
  if (!cands.length) return 0;
  const results = await (await getDb()).batch(
    cands.map((c) => ({
      sql: insertSql,
      args: [c.dedupeKey, c.role, c.title, c.company, c.location, c.workMode, c.lane, c.ats, c.publisher, c.url,
        c.applyUrl, c.description, c.expMin, c.expMax, c.fitScore, c.postedAt],
    })),
    "write",
  );
  return results.filter((r) => r.rows[0]).length;
}

const poolSize = async () => (await first<{ n: number }>(`SELECT count(*) AS n FROM jobs WHERE ${POOL}`))?.n ?? 0;

/**
 * Pool-first, request-lean daily run:
 * 1. Today's remaining cards = dailyCap − already sent today.
 * 2. If the unsent pool already holds enough candidates → 0 API requests.
 * 3. Otherwise run searches one at a time (rotating where yesterday stopped) until it does.
 * 4. Send the best `need` from the pool.
 */
export async function runFetch() {
  const { search } = config;
  const today = nowIn().date;
  const sentToday = (await first<{ n: number }>("SELECT count(*) AS n FROM jobs WHERE sent_on = ?", [today]))?.n ?? 0;
  const need = search.dailyCap - sentToday;
  if (need <= 0) {
    await notify(`✅ Today's ${search.dailyCap} jobs were already sent. /more shows extra matches (no API cost).`);
    return { requests: 0, newMatches: 0, sent: 0, errors: [] as string[] };
  }

  const base = await getBaseResume();
  const skills = base.skills.flatMap((g) => g.items);

  // Requests available = roles × (searchIn areas + remote). Results are then filtered by search.locations.
  const queries = config.roles.flatMap((role) => [
    ...search.searchIn.map((area) => ({ role, q: `${role} in ${area}`, remote: false })),
    ...(search.includeRemote ? [{ role, q: `${role} remote`, remote: true }] : []),
  ]);
  const start = Number((await kvGet("jsearch:next_query")) ?? 0) % queries.length;

  const want = need * CANDIDATES_PER_CARD;
  const errors: string[] = [];
  let note = ""; // budget reached before any request: informational, not a failure
  let requests = 0;
  let newMatches = 0;
  for (let i = 0; i < queries.length && (await poolSize()) < want; i++) {
    // Out of today's requests is the normal end of a run, not an error — only report it if nothing ran.
    const { blocked } = await budget();
    if (blocked) {
      if (requests === 0) note = blocked;
      break;
    }
    const idx = (start + i) % queries.length;
    const { role, q, remote } = queries[idx];
    try {
      const cands = (await searchJobs(q, remote))
        .map((raw) => toCandidate(raw, role, skills))
        .filter((c): c is Candidate => c !== null);
      requests++;
      newMatches += await store(cands);
      await kvSet("jsearch:next_query", String(idx + 1)); // next run continues from here
    } catch (e) {
      errors.push(`${q}: ${errMsg(e)}`);
      if (e instanceof StopSearching) break; // budget/key problem: the rest would fail the same way
    }
  }

  const jobs = await all<Job>(`SELECT * FROM jobs WHERE ${POOL} ORDER BY fit_score DESC, id DESC LIMIT ?`, [need]);
  const left = await poolSize() - jobs.length;
  const auto = jobs.filter((j) => j.lane === "auto").length;
  const b = await budget();

  await notify(
    (jobs.length
      ? `📋 <b>${jobs.length} job${jobs.length > 1 ? "s" : ""} for you</b> (${auto} 🤖 auto · ${jobs.length - auto} 🧑 assisted)`
      : "📋 No new matching jobs right now.") +
      (left > 0 ? `\n${left} more saved → /more` : "") +
      (note ? `\n⏸️ ${esc(note)}` : "") +
      `\n<i>JSearch: ${requests} request${requests === 1 ? "" : "s"} this run · ${b.usedMonth}/${search.monthlyRequestLimit} this month · ${b.allowanceToday - b.usedToday} left today</i>` +
      (errors.length ? `\n\n⚠️ ${errors.length} search(es) failed:\n<code>${esc(errors.join("\n").slice(0, 800))}</code>` : ""),
  );
  await sendCards(jobs);

  return { requests, newMatches, sent: jobs.length, errors };
}
