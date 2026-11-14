// JSearch via OpenWebNinja (Google Jobs aggregate — LinkedIn, Indeed, Naukri, company sites).
// Key from the OpenWebNinja dashboard. Free plan: 200 requests/month, 1000/hour.
import { config, env, nowIn } from "./config";
import { kvGet, kvSet } from "./db";

export interface RawJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_publisher?: string;
  job_apply_link?: string;
  apply_options?: { publisher?: string; apply_link?: string }[];
  job_description?: string;
  job_is_remote?: boolean;
  job_location?: string | null;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_posted_at_datetime_utc?: string | null;
  job_required_experience?: { required_experience_in_months?: number | null } | null;
}

const ENDPOINT = "https://api.openwebninja.com/jsearch/search";

/** Thrown when continuing would waste quota or can't succeed (budget reached, bad key). Stops the whole run. */
export class StopSearching extends Error {}

/**
 * Spreads what's left of the month evenly over the remaining days (today included),
 * so a burst of /fetch can't drain the month early. Pure — tested in selftest.
 */
export function dailyAllowance(monthlyLimit: number, usedMonth: number, usedToday: number, date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const remainingAtDayStart = Math.max(0, monthlyLimit - (usedMonth - usedToday));
  return Math.ceil(remainingAtDayStart / (daysInMonth - d + 1));
}

// ponytail: local mirror of the provider's counters (responses carry no quota headers).
// The OpenWebNinja dashboard is the source of truth; its monthly cycle may start on your signup date.
function keys() {
  const { date, time } = nowIn();
  return { month: `jsearch:${date.slice(0, 7)}`, day: `jsearch:d:${date}`, hour: `jsearch:h:${date}T${time.slice(0, 2)}`, date };
}
const count = async (key: string) => Number((await kvGet(key)) ?? 0);

export async function budget() {
  const k = keys();
  const [usedMonth, usedToday, usedHour] = await Promise.all([count(k.month), count(k.day), count(k.hour)]);
  const { monthlyRequestLimit, hourlyRequestLimit, requestsPerDay } = config.search;
  // Your chosen pace (requestsPerDay), never more than an even share of what's left this month.
  const allowanceToday = Math.min(requestsPerDay, dailyAllowance(monthlyRequestLimit, usedMonth, usedToday, k.date));
  const blocked =
    usedMonth >= monthlyRequestLimit ? `Monthly JSearch limit reached (${usedMonth}/${monthlyRequestLimit}).`
    : usedToday >= allowanceToday ? `Today's JSearch requests used (${usedToday}/${allowanceToday}, search.requestsPerDay). Saved jobs: /more.`
    : usedHour >= hourlyRequestLimit ? `Hourly JSearch limit reached (${usedHour}/${hourlyRequestLimit}).`
    : null;
  return { usedMonth, usedToday, usedHour, allowanceToday, blocked };
}

async function recordRequest() {
  const k = keys();
  for (const key of [k.month, k.day, k.hour]) await kvSet(key, String((await count(key)) + 1));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

/** One request = one page of up to 10 jobs. Budget-checked, spaced 1.5 s apart, one retry on 429. */
export async function searchJobs(query: string, remoteOnly: boolean): Promise<RawJob[]> {
  const { search } = config;
  const params = new URLSearchParams({
    query,
    page: "1",
    num_pages: "1", // each extra page is another request
    country: search.country,
    date_posted: search.datePosted,
  });
  if (remoteOnly) params.set("work_from_home", "true");
  // Not using job_requirements: tested 2026-11-14, it returned 0 results (Google only tags a few postings).
  // Experience is filtered locally from the description instead (filter.ts).

  for (let attempt = 0; ; attempt++) {
    const { blocked } = await budget();
    if (blocked) throw new StopSearching(blocked);
    await sleep(Math.max(0, lastRequestAt + 1500 - Date.now()));
    lastRequestAt = Date.now();

    const res = await fetch(`${ENDPOINT}?${params}`, {
      headers: { "x-api-key": env("JSEARCH_API_KEY") },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      await recordRequest(); // only successful calls are billed
      return ((await res.json()) as { data?: RawJob[] }).data ?? [];
    }

    const body = (await res.text()).slice(0, 200);
    if (res.status === 401) throw new StopSearching(`JSearch 401: ${body} — check JSEARCH_API_KEY (OpenWebNinja dashboard key).`);
    if (res.status === 403) throw new StopSearching(`JSearch 403: ${body} — plan/quota issue; check the OpenWebNinja dashboard.`);
    if (res.status === 429 && attempt === 0) {
      await sleep(5000);
      continue;
    }
    if (res.status === 429) throw new StopSearching("JSearch 429: rate limited — try /fetch again later.");
    throw new Error(`JSearch ${res.status}: ${body}`);
  }
}
