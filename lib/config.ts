import raw from "../config/config.json";

export type Mode = "local" | "vercel" | "hybrid";

export interface Config {
  mode: Mode;
  roles: string[];
  search: {
    locations: string[];
    searchIn: string[];
    monthlyRequestLimit: number;
    hourlyRequestLimit: number;
    requestsPerDay: number;
    country: string;
    experienceYears: number;
    includeRemote: boolean;
    remoteMinScore: number;
    dailyCap: number;
    datePosted: "all" | "today" | "3days" | "week" | "month";
  };
  schedule: { time: string; timezone: string };
  resume: { path: string };
  llm: { backend: "auto" | "codex" | "grok"; codexModel: string; grokModel: string };
  profile: Record<string, string | number | boolean>;
}

function check(c: Config): Config {
  const fail = (m: string): never => {
    throw new Error(`config/config.json: ${m}`);
  };
  if (!["local", "vercel", "hybrid"].includes(c.mode)) fail("mode must be local | vercel | hybrid");
  if (!c.roles?.length) fail("roles must list at least one job title");
  // Empty searchIn + locations = remote-only (non-remote results never match an empty locations list).
  if (!c.search?.searchIn?.length && !c.search?.includeRemote) fail('search.searchIn must list at least one area (e.g. "Delhi NCR") unless includeRemote is true');
  if (c.search.searchIn?.length && !c.search.locations?.length) fail("search.locations must list at least one city when searchIn is set");
  if (!(c.search.monthlyRequestLimit > 0)) fail("search.monthlyRequestLimit must be greater than 0");
  if (!(c.search.hourlyRequestLimit > 0)) fail("search.hourlyRequestLimit must be greater than 0");
  if (!(c.search.requestsPerDay > 0)) fail("search.requestsPerDay must be greater than 0");
  if (typeof c.search.experienceYears !== "number") fail("search.experienceYears must be a number");
  if (!(c.search.dailyCap > 0)) fail("search.dailyCap must be greater than 0");
  if (!/^\d\d:\d\d$/.test(c.schedule?.time ?? "")) fail('schedule.time must look like "09:00"');
  if (!["auto", "codex", "grok"].includes(c.llm?.backend)) fail("llm.backend must be auto | codex | grok");
  if (!c.llm.grokModel) fail('llm.grokModel must be set (e.g. "grok-4.7")');
  return c;
}

export const config = check(raw as unknown as Config);
export const onVercel = Boolean(process.env.VERCEL);

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return v;
}

/** Current date ("YYYY-MM-DD") and time ("HH:MM") in the configured timezone. */
export function nowIn(timeZone = config.schedule.timezone, at = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
