// Pure functions: filtering, lane classification and fit scoring. No I/O, no AI.
import type { Lane, WorkMode } from "./db";

// Common alternate spellings, so "Bengaluru" in a posting matches "Bangalore" in config.
const CITY_ALIASES: Record<string, string> = {
  bengaluru: "bangalore",
  gurugram: "gurgaon",
  bombay: "mumbai",
  "new delhi": "delhi",
  madras: "chennai",
  calcutta: "kolkata",
  "navi mumbai": "mumbai",
};

const canon = (s: string) => {
  let t = s.toLowerCase();
  for (const [alias, city] of Object.entries(CITY_ALIASES)) t = t.replaceAll(alias, city);
  return t;
};

export const matchesLocation = (jobLocation: string, locations: string[]) => {
  const loc = canon(jobLocation);
  return locations.some((city) => loc.includes(canon(city.trim())));
};

export function workMode(isRemote: boolean | undefined, text: string): WorkMode {
  if (isRemote) return "remote";
  return /\bhybrid\b/i.test(text) ? "hybrid" : "onsite";
}

export interface ExpRange {
  min: number;
  max: number | null;
}

// "3-5 years", "3 to 5 yrs", "5+ years", "minimum 4 years of experience"
const EXP_RE = /(\d{1,2})(?:\.\d)?\s*(\+|plus)?\s*(?:(?:-|–|—|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)/gi;

/** Required experience from the description, falling back to JSearch's months field. */
export function parseExperience(description: string, requiredMonths?: number | null): ExpRange | null {
  const matches = [...description.matchAll(EXP_RE)];
  // Prefer a match that is followed by "experience"/"exp" — avoids "founded 20 years ago".
  const followedByExp = (x: RegExpMatchArray) => {
    const end = x.index! + x[0].length;
    return /exp/i.test(description.slice(end, end + 30).split(/[.;\n]/)[0]); // same sentence only
  };
  const m = matches.find(followedByExp) ?? matches[0];
  if (m) {
    const min = Number(m[1]);
    const max = m[3] ? Number(m[3]) : null;
    if (min <= 30 && (max === null || max >= min)) return { min, max };
  }
  if (requiredMonths) return { min: requiredMonths / 12, max: null };
  return null;
}

/** Keeps a job if you are within its range; allows 1 year of stretch on the minimum. */
export const experienceFits = (exp: ExpRange | null, years: number) =>
  !exp || (exp.min <= years + 1 && (exp.max === null || exp.max >= years));

const ATS_HOSTS: Record<string, string> = {
  "boards.greenhouse.io": "greenhouse",
  "job-boards.greenhouse.io": "greenhouse",
  "jobs.lever.co": "lever",
  "jobs.ashbyhq.com": "ashby",
};

export function laneFor(url: string): { lane: Lane; ats: string | null } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {}
  const ats = ATS_HOSTS[host] ?? null;
  return { lane: ats ? "auto" : "assisted", ats };
}

/** Prefer an apply link on a supported ATS (auto lane), otherwise the first one. */
export function pickApplyUrl(options: { apply_link?: string }[], fallback?: string): string | undefined {
  const links = [...options.map((o) => o.apply_link), fallback].filter((x): x is string => !!x);
  return links.find((l) => laneFor(l).lane === "auto") ?? links[0];
}

const STOP = new Set(["and", "of", "the", "for", "a", "an", "-", "/", "&"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w && !STOP.has(w));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const mentions = (text: string, term: string) =>
  new RegExp(`(^|[^a-z0-9+#.])${esc(term.toLowerCase())}($|[^a-z0-9+#])`).test(text);

// Title words that mean the same thing in job titles ("QA Intern" ≈ "Test Engineer").
const SYNONYMS: Record<string, string> = {
  qa: "test", quality: "test", assurance: "test", tester: "test", testing: "test", sdet: "test", tests: "test",
  developer: "engineer", sde: "engineer", programmer: "engineer",
};
const titleWords = (s: string) => words(s).map((w) => SYNONYMS[w] ?? w);

// Filler words in skill names — "UAT Support" should match a posting that just says "UAT".
const GENERIC = new Set(["testing", "test", "support", "cycle", "life", "reports", "report", "cases", "case",
  "scenarios", "scenario", "execution", "management", "tools", "skills", "basics", "knowledge"]);

/** A skill matches if the exact phrase appears, or every meaningful word of it does. */
export function skillMentioned(text: string, skill: string) {
  if (mentions(text, skill)) return true;
  const core = words(skill).filter((w) => !GENERIC.has(w));
  return core.length > 0 && core.every((w) => mentions(text, w));
}

/**
 * 0–100. title match 40% · skill overlap 50% · recency 10%.
 * ponytail: keyword overlap + small synonym list, not semantics. Upgrade to embeddings if ranking feels off.
 */
export function fitScore(i: { role: string; title: string; description: string; skills: string[]; postedAt?: string | null; now?: Date }) {
  const roleWords = [...new Set(titleWords(i.role))];
  const jobTitle = new Set(titleWords(i.title));
  const title = roleWords.length ? roleWords.filter((w) => jobTitle.has(w)).length / roleWords.length : 0;

  const text = `${i.title}\n${i.description}`.toLowerCase();
  const hits = i.skills.filter((s) => s.trim() && skillMentioned(text, s.trim())).length;
  const skill = Math.min(1, hits / Math.max(1, Math.min(10, i.skills.length)));

  let recency = 0.5;
  if (i.postedAt) {
    const hours = ((i.now ?? new Date()).getTime() - new Date(i.postedAt).getTime()) / 36e5;
    if (Number.isFinite(hours)) recency = hours <= 24 ? 1 : Math.max(0, 1 - (hours - 24) / 144);
  }
  return Math.round(40 * title + 50 * skill + 10 * recency);
}
