# Job Seeker

A personal Telegram bot that finds jobs for the roles you care about every day and sends you up to 10. You tap **Yes** or **No** on each. For every Yes it tailors your resume and cover letter to that job, then either applies for you or gives you everything ready to submit.

Built with Next.js (App Router route handlers). It runs on your machine, on Vercel, or split across both.

---

## Quick start

```bash
npm install
cp .env.example .env              # add your bot token, chat id and JSearch key
# put your resume at data/resume.pdf
# edit config/config.json         (roles, cities, experience, profile)
npm i -g @openai/codex && codex login
npm run local
```

Then send `/start` to your bot. If it replies "Not authorised", copy the chat id it shows into `TELEGRAM_ALLOWED_CHAT_ID` and restart.

| Command | Does |
|---|---|
| `npm run local` | Runs the bot, the daily search and the worker locally (or only the worker, see [Modes](#modes)) |
| `npm test` | Runs self-checks on the filters, scoring and resume validator (no network) |
| `npm run typecheck` | Type-checks the code (`tsc --noEmit`) |
| `npm run build` | Runs the Next.js production build, which is what Vercel runs |

---

## Where your stuff goes

| What | Where | Notes |
|---|---|---|
| **Everything you tune** | `config/config.json` | Roles, cities, experience, cap, schedule, mode, AI, profile |
| **Your resume** | `data/resume.pdf` | Replace the file whenever you like. It is re-parsed automatically when its contents change. |
| **Secrets** | `.env` locally, Vercel environment variables when deployed | See `.env.example` |
| **Database** | `jobs.db` locally, Turso on Vercel | Created automatically |

### `config/config.json`

```jsonc
{
  "mode": "local",                     // local | vercel | hybrid (see Modes)
  "roles": ["Software Test Engineer", "QA Engineer"],
  "search": {
    "searchIn": ["Delhi NCR"],         // what is sent to JSearch (1 request per role per area)
    "locations": ["Gurgaon", "Delhi", "Noida"],  // on-site/hybrid jobs kept only in these
    "monthlyRequestLimit": 200,        // JSearch free plan — hard stop when reached
    "hourlyRequestLimit": 1000,        // JSearch free plan hourly cap
    "requestsPerDay": 1,               // searches per day (1 request = up to 10 raw jobs)
    "country": "in",
    "experienceYears": 1,
    "includeRemote": true,             // remote jobs anywhere…
    "remoteMinScore": 70,              // …but only if fit score ≥ 70
    "dailyCap": 10,                    // max job cards per day
    "datePosted": "3days"              // all | today | 3days | week | month
  },
  "schedule": { "time": "09:00", "timezone": "Asia/Kolkata" },
  "resume": { "path": "data/resume.pdf" },
  "llm": { "backend": "auto", "codexModel": "", "grokModel": "grok-4.7" },  // auto = Codex locally, Grok on Vercel
  "profile": { "fullName": "…", "email": "…", "noticePeriod": "30 days", "…": "…" }
}
```

The config is checked at startup, and a wrong value fails with a clear message. `profile` holds the facts application forms ask for, and it feeds the cover letter and the ready-made answers.

---

## How it works

```
schedule ─► saved pool enough? ─no─► JSearch, one search at a time ─► filter ─► score ─► dedupe ─► pool
                     │ yes (0 requests)                                                            │
                     └──────────────────────────► best `dailyCap` from pool ─► Telegram cards ◄─────┘
                                                                                           │
                                                                                  ✅ Yes / ❌ No
                                                                                           │
                       worker ─► AI tailors resume + cover letter + answers ─► validate ─► PDF
                                                                                           │
                             Telegram: cover letter, answers, PDF, [🔗 Apply] [✅ I applied]
```

### Filters (in code, no AI)

| Filter | Rule |
|---|---|
| Location | On-site and hybrid jobs are kept only in `search.locations`. Common aliases also match, such as Bengaluru = Bangalore and Gurugram = Gurgaon. |
| Remote | Remote jobs are kept from anywhere, but only if the fit score is at least `remoteMinScore`. |
| Experience | Read from phrases like "3–5 years exp" in the posting. The job is kept if `min ≤ you + 1` and `max ≥ you`. If nothing is stated, the job is kept. |
| Salary, company | Not filtered |

### Fit score (0–100, no AI)

The score is 40% title match with your role, 50% overlap with the skills in your resume, and 10% recency. The best `dailyCap` jobs from the pool are sent each day. Unsent matches stay in the pool for 7 days, and `/more` shows them at no API cost.

### Two lanes

| | 🤖 Auto | 🧑 Assisted |
|---|---|---|
| Apply link | Greenhouse, Lever or Ashby form | LinkedIn, Naukri, Indeed, anything else |
| After Yes | The bot fills in and submits the form (**not built yet**, see Roadmap) | You get the PDF, cover letter, answers and an **Apply** button. You submit, then tap **I applied**. |

The bot never logs into or automates LinkedIn, Naukri or Indeed. It only reads their listings through the JSearch API, so your accounts are not at risk. For now, auto-lane jobs use the assisted hand-off too, with a note on the message.

### Resume tailoring

The AI may rewrite the headline and summary, reorder and reword bullets, and reorder skills. It may **not** invent anything. `validate()` in `lib/tailor.ts` rejects a resume if it:
- adds, drops or edits any experience entry (company, title or dates)
- adds a skill or project that isn't in your base resume
- contains any number that isn't in your base resume

Your name, contact details, education and certifications are always copied from the base resume. If validation fails, the AI retries once with the errors. If it fails again, the job is marked `failed` and you get a **♻️ Retry** button.

---

## AI backends

| Where | Backend | Auth |
|---|---|---|
| Your machine | **Codex CLI** (`codex exec`, structured output, read-only sandbox, run in an empty temp folder) | `codex login` |
| Vercel | **xAI Grok API**, Responses endpoint (strict structured output, `store: false` so xAI keeps nothing) | `XAI_API_KEY` + `llm.grokModel` (default `grok-4.7`) |

The Codex CLI can't run on Vercel: it isn't installed there, and Vercel keeps no login files between requests. Both backends share the same prompts and JSON schemas in `lib/schemas.ts`. With `llm.backend: "auto"`, the bot uses Codex locally and Grok on Vercel. Set `"backend": "grok"` to use Grok locally too. For a cheaper model, set `grokModel` to `grok-4.3`.

AI is used only to parse the resume (once per new PDF) and for each job you tap Yes on. Jobs you skip, and jobs that don't make the daily cut, cost nothing.

---

## Modes

| `mode` | Bot + daily search | Tailoring | Auto-submit | Your machine |
|---|---|---|---|---|
| `local` (default) | Local, polling Telegram | Codex | ✅ (when built) | Must be on |
| `vercel` | Vercel webhook + cron | Grok API | ❌ assisted only | Not needed |
| `hybrid` | Vercel webhook + cron | Grok on Vercel, Codex in the local worker | ✅ when the worker runs | Runs `npm run local` (worker only) |

### Deploying to Vercel (`vercel` / `hybrid`)

1. Create a Turso database and set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, `JSEARCH_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET` and `XAI_API_KEY` in Vercel.
3. Set `mode` in `config/config.json`. `llm.grokModel` defaults to `grok-4.7`.
4. Deploy, then register the webhook:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<app>.vercel.app/api/telegram&secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
5. The daily search time on Vercel comes from `vercel.json` and is in UTC. `30 3 * * *` is 09:00 IST. Change it there if you change `schedule.time`.

`config/config.json` and `data/resume.pdf` are bundled into the deployment, so **keep the repo private**. After you change them, redeploy.

---

## Telegram

| Command | Does |
|---|---|
| `/start`, `/help` | Shows the help text, or your chat id if you aren't authorised yet |
| `/fetch` | Runs the search now |
| `/more` | Sends the next batch of matched jobs that went over today's cap |
| `/pending` | Re-sends cards you haven't answered |
| `/status` | Shows job counts by status |
| `/resume` | Shows what was parsed from your resume. `/resume reload` re-parses it. |

**Buttons:** ✅ Yes · ❌ No · 🔗 View on job cards. 🔗 Apply · ✅ I applied on the PDF. ♻️ Retry on failures.

---

## Code layout

```
app/api/telegram/route.ts   Vercel webhook (long work runs via next/server after())
app/api/cron/route.ts       Vercel daily search (checks CRON_SECRET)
scripts/local.ts            local runner: polling bot + schedule + worker
scripts/selftest.ts         npm test
lib/config.ts               loads + validates config/config.json, env helpers
lib/db.ts                   libSQL client, schema (auto-created), Job type
lib/jsearch.ts              JSearch API client
lib/filter.ts               pure: location, work mode, experience, lane, fit score
lib/fetch.ts                daily pipeline + daily cap
lib/bot.ts                  commands + buttons (shared by both runtimes)
lib/notify.ts               outbound Telegram messages (cards, hand-off)
lib/worker.ts               queue: claim → tailor → PDF → hand-off
lib/resume.ts               data/resume.pdf → JSON (cached by file hash)
lib/tailor.ts               tailoring prompt + validator
lib/llm.ts                  the single AI entry point (codex | grok)
lib/schemas.ts              JSON schemas + Resume/Tailored types
lib/pdf.ts                  resume JSON → one-column PDF
```

**Job status flow:** `overflow → new → approved → tailoring → ready → applied`. A job can also become `skipped` (you tapped No) or `failed` (♻️ Retry sends it back to `approved`).

Each job is claimed with an atomic `UPDATE … RETURNING`, so a job is never processed twice, even when Vercel and the local worker both run. A job stuck in `tailoring` for more than 10 minutes, for example after a crash, is picked up again automatically.

---

## Safety

- The bot only answers `TELEGRAM_ALLOWED_CHAT_ID`. The webhook checks Telegram's secret token, and the cron route checks `CRON_SECRET`.
- `.env` and `jobs.db` are gitignored.
- Nothing invented goes into a resume (see the validator above).
- The bot never automates LinkedIn, Naukri or Indeed.

---

## Roadmap

- [x] Daily search, filters, fit score, daily cap, dedupe, Telegram cards
- [x] Resume parsing, tailoring, validation, PDF, assisted hand-off
- [x] Codex and Grok backends, local, Vercel and hybrid modes
- [ ] **Auto-submit:** Playwright adapters for Greenhouse, Lever and Ashby, with a `dryRun` screenshot mode, a daily submit cap and confirmation screenshots (local/worker only)
- [ ] Answer bank for unknown screening questions (asked once in Telegram, then reused)
- [ ] Workable, SmartRecruiters, Workday

**JSearch quota (free plan: 200/month, 1000/hour).** Requests are spent only when needed:
1. **Pool first.** Today's cards = `dailyCap` minus the cards already sent today. If the pool of unsent matches from the last 7 days holds at least twice that many, the run makes **0 requests**.
2. **One search at a time.** Otherwise searches run one by one, from the `roles × (searchIn + remote)` list, and stop as soon as the pool is big enough. The next run continues the rotation where this one stopped, so every role and the remote search get covered over the days.
3. **Daily request limit.** At most `requestsPerDay` searches a day, and never more than an even share of what's left this month. Running out of today's requests ends the run normally; the remaining cards come from the saved pool.
4. **Hard stops.** Searching stops at the monthly, daily-allowance or hourly limit. A 401 or 403 stops the run instead of failing on every search. Requests are spaced 1.5 s apart, and a 429 is retried once.

Only successful requests are counted, matching OpenWebNinja's billing. The digest shows requests this run, this month, and what's left today. **Expectations:** one request returns up to 10 jobs, but the experience and location filters keep only some of them. A real Delhi NCR test kept 2 of 9 for a 1-year resume. So `requestsPerDay: 1` gives roughly 2–3 fresh cards a day plus whatever is saved, and uses about 30 of the 200 monthly requests. The quota resets monthly, so unused requests are lost. Raise `requestsPerDay` (up to about 6 fits 200 a month) to get closer to 10 good cards a day.
