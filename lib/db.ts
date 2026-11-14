import { createClient, type Client, type InArgs } from "@libsql/client";
import { onVercel } from "./config";

export type Lane = "auto" | "assisted";
export type WorkMode = "onsite" | "hybrid" | "remote";
export type Status =
  | "overflow" // matched, not sent yet (over the daily cap) → /more
  | "new" // sent as a card, waiting for Yes/No
  | "skipped"
  | "approved" // queued for tailoring
  | "tailoring"
  | "ready" // PDF sent, waiting for you to apply
  | "applied"
  | "failed";

export interface Job {
  id: number;
  dedupe_key: string;
  role: string;
  title: string;
  company: string;
  location: string;
  work_mode: WorkMode;
  lane: Lane;
  ats: string | null;
  publisher: string;
  url: string;
  apply_url: string;
  description: string;
  exp_min: number | null;
  exp_max: number | null;
  fit_score: number;
  posted_at: string | null;
  status: Status;
  error: string | null;
  message_id: number | null;
  sent_on: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY,
  dedupe_key  TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,
  title       TEXT NOT NULL,
  company     TEXT NOT NULL,
  location    TEXT NOT NULL,
  work_mode   TEXT NOT NULL,
  lane        TEXT NOT NULL,
  ats         TEXT,
  publisher   TEXT NOT NULL,
  url         TEXT NOT NULL,
  apply_url   TEXT NOT NULL,
  description TEXT NOT NULL,
  exp_min     REAL,
  exp_max     REAL,
  fit_score   INTEGER NOT NULL,
  posted_at   TEXT,
  status      TEXT NOT NULL,
  error       TEXT,
  message_id  INTEGER,
  sent_on     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, fit_score DESC);
CREATE INDEX IF NOT EXISTS jobs_sent_on ON jobs(sent_on);
CREATE TABLE IF NOT EXISTS applications (
  job_id       INTEGER PRIMARY KEY REFERENCES jobs(id),
  resume_json  TEXT NOT NULL,
  cover_letter TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  method       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  applied_at   TEXT
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let client: Client | undefined;
let ready: Promise<void> | undefined;

/** Lazily connects and creates tables once per process. */
export async function getDb(): Promise<Client> {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:jobs.db";
    if (onVercel && url.startsWith("file:")) {
      throw new Error("On Vercel, TURSO_DATABASE_URL must be a Turso libsql:// URL (no local disk).");
    }
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
    ready = client.executeMultiple(SCHEMA);
  }
  await ready;
  return client;
}

export async function all<T>(sql: string, args: InArgs = []): Promise<T[]> {
  const r = await (await getDb()).execute({ sql, args });
  return r.rows as unknown as T[];
}

export const first = async <T>(sql: string, args: InArgs = []) => (await all<T>(sql, args))[0];
export const run = async (sql: string, args: InArgs = []) => void (await all(sql, args));

export const kvGet = async (key: string) =>
  (await first<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]))?.value;

export const kvSet = (key: string, value: string) =>
  run("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
