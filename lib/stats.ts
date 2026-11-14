// Everything the dashboard shows, read straight from the jobs DB. Read-only.
import { config, nowIn } from "./config";
import { all } from "./db";
import { budget } from "./jsearch";

type Row = Record<string, string | number | null>;
interface Recent { id: number; title: string; company: string; role: string; work_mode: string; fit_score: number; status: string; apply_url: string; updated_at: string; applied_at: string | null }
export interface Bar { label: string; value: number }
export interface Day { date: string; matched: number; sent: number; approved: number; applied: number }

const DAYS = 30;
// SQLite datetime('now') is UTC ("YYYY-MM-DD HH:MM:SS"); convert to the configured timezone's date.
const localDate = (utc: string) => nowIn(undefined, new Date(utc.replace(" ", "T") + "Z")).date;
const n = (v: unknown) => Number(v ?? 0);
const groupBy = async (col: string, limit = 6) =>
  (await all<Row>(`SELECT ${col} AS label, count(*) AS value FROM jobs GROUP BY 1 ORDER BY 2 DESC LIMIT ?`, [limit]))
    .map((r) => ({ label: String(r.label || "Unknown"), value: n(r.value) }));

export async function getStats() {
  const today = nowIn().date;
  const days: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) days.push(nowIn(undefined, new Date(Date.now() - i * 864e5)).date);

  const [statusRows, jobDates, appRows, kvRows, fitRows, avgRow, recent, quota] = await Promise.all([
    all<Row>("SELECT status, count(*) AS n FROM jobs GROUP BY status"),
    // ponytail: scans all jobs (a few thousand at most for one person); add a date WHERE if it ever gets slow.
    all<Row>("SELECT created_at, sent_on, status, updated_at FROM jobs"),
    all<Row>("SELECT created_at, applied_at FROM applications"),
    all<Row>("SELECT key, value FROM kv WHERE key LIKE 'jsearch:d:%'"),
    all<Row>("SELECT min(fit_score / 10, 9) AS bucket, count(*) AS n FROM jobs GROUP BY 1"),
    all<Row>("SELECT avg(fit_score) AS avg, max(fit_score) AS max FROM jobs"),
    all<Recent>(`SELECT j.id, j.title, j.company, j.role, j.work_mode, j.fit_score, j.status, j.apply_url, j.updated_at, a.applied_at
      FROM jobs j LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.status IN ('approved', 'tailoring', 'ready', 'applied', 'failed') ORDER BY j.updated_at DESC LIMIT 8`),
    budget(),
  ]);

  const status = Object.fromEntries(statusRows.map((r) => [String(r.status), n(r.n)])) as Record<string, number>;
  const s = (k: string) => status[k] ?? 0;
  const matched = Object.values(status).reduce((a, b) => a + b, 0);
  const approved = s("approved") + s("tailoring") + s("ready") + s("applied") + s("failed");
  const sent = matched - s("overflow");
  const tailored = appRows.length;

  // Daily series. "approved" uses updated_at of jobs that moved past the card stage (close enough: last touch).
  const daily = new Map<string, Day>(days.map((d) => [d, { date: d, matched: 0, sent: 0, approved: 0, applied: 0 }]));
  for (const r of jobDates) {
    const m = daily.get(localDate(String(r.created_at)));
    if (m) m.matched++;
    const se = r.sent_on ? daily.get(String(r.sent_on)) : undefined;
    if (se) se.sent++;
    if (["approved", "tailoring", "ready", "applied", "failed"].includes(String(r.status))) {
      const ap = daily.get(localDate(String(r.updated_at)));
      if (ap) ap.approved++;
    }
  }
  const appliedDates = appRows.filter((r) => r.applied_at).map((r) => localDate(String(r.applied_at)));
  for (const d of appliedDates) { const x = daily.get(d); if (x) x.applied++; }

  // Streak: consecutive days (ending today or yesterday) with at least one application.
  const appliedSet = new Set(appliedDates);
  let streak = 0;
  for (let i = days.length - 1 - (appliedSet.has(today) ? 0 : 1); i >= 0 && appliedSet.has(days[i]); i--) streak++;

  const requestsByDay = new Map(kvRows.map((r) => [String(r.key).slice(10), n(r.value)]));
  const fit = Array.from({ length: 10 }, (_, i) => ({
    label: i === 9 ? "90–100" : `${i * 10}–${i * 10 + 9}`,
    value: n(fitRows.find((r) => n(r.bucket) === i)?.n),
  }));

  return {
    today,
    name: String(config.profile.fullName ?? "").split(" ")[0] || "there",
    roles: config.roles,
    schedule: config.schedule,
    minScore: config.search.remoteMinScore,
    totals: {
      matched, sent, approved, tailored, applied: s("applied"), skipped: s("skipped"), failed: s("failed"),
      waiting: s("new"), ready: s("ready"), queued: s("approved") + s("tailoring"), pool: s("overflow"),
      avgFit: Math.round(n(avgRow[0]?.avg)),
      maxFit: n(avgRow[0]?.max),
    },
    todays: {
      sent: daily.get(today)?.sent ?? 0,
      applied: daily.get(today)?.applied ?? 0,
      requests: requestsByDay.get(today) ?? 0,
    },
    streak,
    daily: [...daily.values()],
    requests: days.map((d) => ({ label: d, value: requestsByDay.get(d) ?? 0 })),
    quota: { ...quota, monthlyLimit: config.search.monthlyRequestLimit, dailyCap: config.search.dailyCap },
    funnel: [
      { label: "Matched", value: matched },
      { label: "Sent to Telegram", value: sent },
      { label: "Approved", value: approved },
      { label: "Resume tailored", value: tailored },
      { label: "Applied", value: s("applied") },
    ],
    fit,
    byRole: await groupBy("role"),
    byMode: await groupBy("work_mode"),
    bySource: await groupBy("publisher"),
    byCompany: await groupBy("company"),
    byAts: await groupBy("COALESCE(ats, lane)"),
    recent: recent.map((r) => ({ ...r, ago: ago(r.applied_at ?? r.updated_at) })),
  };
}

function ago(utc: string) {
  const sec = (Date.now() - Date.parse(utc.replace(" ", "T") + "Z")) / 1000;
  return sec < 60 ? "now" : sec < 3600 ? `${Math.floor(sec / 60)}m` : sec < 86400 ? `${Math.floor(sec / 3600)}h` : `${Math.floor(sec / 86400)}d`;
}

export type Stats = Awaited<ReturnType<typeof getStats>>;
