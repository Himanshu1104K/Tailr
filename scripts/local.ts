// Local runner: `npm run local`.
//   mode "local"            → Telegram polling + daily schedule + worker (everything on this machine)
//   mode "hybrid" | "vercel" → worker only (the bot lives on Vercel; this drains the queue with Codex)
import { createBot } from "../lib/bot";
import { config, errMsg, nowIn } from "../lib/config";
import { getDb, kvGet, kvSet } from "../lib/db";
import { runFetch } from "../lib/fetch";
import { llmBackend } from "../lib/llm";
import { startWorker } from "../lib/worker";

/** Runs the fetch once per day at/after schedule.time — catches up if the machine was asleep. */
function startSchedule() {
  const tick = async () => {
    const { date, time } = nowIn();
    if (time < config.schedule.time || (await kvGet("last_fetch")) === date) return;
    await kvSet("last_fetch", date);
    console.log(`[${date} ${time}] daily fetch`);
    const r = await runFetch();
    console.log(`  requests ${r.requests}, new matches ${r.newMatches}, sent ${r.sent}, errors ${r.errors.length}`);
  };
  const safeTick = () => tick().catch((e) => console.error("schedule:", errMsg(e)));
  void safeTick();
  setInterval(safeTick, 60_000);
}

await getDb();
const kick = startWorker();
console.log(`Job Seeker — mode: ${config.mode}, AI: ${llmBackend()}`);

if (config.mode === "local") {
  const bot = createBot({
    defer: (task) => void task().catch((e) => console.error(errMsg(e))),
    onApproved: () => kick(),
  });
  await bot.api.deleteWebhook(); // polling and webhooks are mutually exclusive
  if (process.env.TELEGRAM_ALLOWED_CHAT_ID) startSchedule();
  else console.log("Setup mode: send /start to your bot to get your chat id, put it in .env, then restart.");
  process.once("SIGINT", () => void bot.stop());
  process.once("SIGTERM", () => void bot.stop());
  await bot.start({ onStart: (me) => console.log(`@${me.username} is listening. Daily fetch at ${config.schedule.time} ${config.schedule.timezone}.`) });
} else {
  console.log("Worker only — the bot runs on Vercel. Processing approved jobs from the queue…");
}
