// Telegram commands and buttons. Shared by local polling and the Vercel webhook.
import { Bot, InlineKeyboard } from "grammy";
import { config, env, errMsg } from "./config";
import { all, first, run, type Job } from "./db";
import { runFetch } from "./fetch";
import { cardText, chatId, esc, notify, sendCards, TG_CLIENT } from "./notify";
import { getBaseResume } from "./resume";

export interface BotHooks {
  /** Run long work after replying (Vercel: next/server after(); local: fire-and-forget). */
  defer(task: () => Promise<unknown>): void;
  /** A job was approved (or retried) and is in the queue. */
  onApproved(job: Job): void;
}

const HELP = `<b>Job Seeker</b>
/fetch — search now (the daily search runs at ${config.schedule.time})
/more — next batch of matched jobs over today's cap
/pending — re-send cards you haven't answered
/status — counts by status
/resume — show the parsed resume · <code>/resume reload</code> to re-parse

Settings live in <code>config/config.json</code>.`;

export function createBot(hooks: BotHooks) {
  const bot = new Bot(env("TELEGRAM_BOT_TOKEN"), { client: TG_CLIENT });
  // Empty during first-time setup: /start then replies with your chat id, everything else is blocked.
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID ? chatId() : 0;
  const report = (e: unknown) => notify(`⚠️ <code>${esc(errMsg(e).slice(0, 800))}</code>`).catch(console.error);

  bot.command("start", (ctx) =>
    ctx.chat.id === allowed
      ? ctx.reply(HELP, { parse_mode: "HTML" })
      : ctx.reply(`Not authorised. Your chat id is ${ctx.chat.id} — put it in TELEGRAM_ALLOWED_CHAT_ID.`),
  );

  // Everything below is for the owner only.
  bot.use((ctx, next) => (ctx.chat?.id === allowed ? next() : undefined));

  bot.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));

  bot.command("fetch", async (ctx) => {
    await ctx.reply("🔎 Searching…");
    hooks.defer(() => runFetch().catch(report));
  });

  bot.command("more", async (ctx) => {
    const jobs = await all<Job>("SELECT * FROM jobs WHERE status = 'overflow' AND created_at >= datetime('now', '-7 days') ORDER BY fit_score DESC, id DESC LIMIT ?", [
      config.search.dailyCap,
    ]);
    if (!jobs.length) return ctx.reply("No more matched jobs. Try /fetch.");
    hooks.defer(() => sendCards(jobs).catch(report));
  });

  bot.command("pending", async (ctx) => {
    const jobs = await all<Job>("SELECT * FROM jobs WHERE status = 'new' ORDER BY fit_score DESC LIMIT ?", [config.search.dailyCap]);
    if (!jobs.length) return ctx.reply("Nothing pending 🎉");
    hooks.defer(() => sendCards(jobs).catch(report));
  });

  bot.command("status", async (ctx) => {
    const rows = await all<{ status: string; n: number }>("SELECT status, count(*) AS n FROM jobs GROUP BY status ORDER BY n DESC");
    await ctx.reply(rows.length ? rows.map((r) => `${r.status}: ${r.n}`).join("\n") : "No jobs yet. Try /fetch.");
  });

  bot.command("resume", async (ctx) => {
    const reload = ctx.match.trim() === "reload";
    await ctx.reply(reload ? "Re-parsing resume…" : "Reading resume…");
    hooks.defer(async () => {
      try {
        const r = await getBaseResume(reload);
        const skills = r.skills.flatMap((g) => g.items);
        await notify(
          `<b>${esc(r.name)}</b> — ${esc(r.headline)}\n` +
            `${r.experience.length} roles · ${r.projects.length} projects · ${skills.length} skills\n` +
            `<i>${esc(skills.slice(0, 25).join(", "))}</i>`,
        );
      } catch (e) {
        await report(e);
      }
    });
  });

  bot.callbackQuery(/^([ynar]):(\d+)$/, async (ctx) => {
    const [, action, idStr] = ctx.match;
    const id = Number(idStr);
    const keep = (p: Promise<unknown>) => p.catch(() => {}); // "message is not modified" etc.

    if (action === "y" || action === "r") {
      const from = action === "y" ? "('new', 'overflow')" : "('failed')";
      const job = await first<Job>(
        `UPDATE jobs SET status = 'approved', error = NULL, updated_at = datetime('now') WHERE id = ? AND status IN ${from} RETURNING *`,
        [id],
      );
      if (!job) return ctx.answerCallbackQuery("Already handled");
      await ctx.answerCallbackQuery(action === "y" ? "Approved ✅" : "Retrying ♻️");
      await keep(ctx.editMessageText(`${cardText(job)}\n\n✅ <i>Approved — tailoring your resume…</i>`, { parse_mode: "HTML" }));
      hooks.onApproved(job);
    } else if (action === "n") {
      const job = await first<Job>(
        "UPDATE jobs SET status = 'skipped', updated_at = datetime('now') WHERE id = ? AND status IN ('new', 'overflow') RETURNING *",
        [id],
      );
      await ctx.answerCallbackQuery(job ? "Skipped" : "Already handled");
      if (job) await keep(ctx.editMessageText(`${cardText(job)}\n\n❌ <i>Skipped</i>`, { parse_mode: "HTML" }));
    } else {
      const job = await first<Job>(
        "UPDATE jobs SET status = 'applied', updated_at = datetime('now') WHERE id = ? AND status = 'ready' RETURNING *",
        [id],
      );
      if (!job) return ctx.answerCallbackQuery("Already handled");
      await run("UPDATE applications SET applied_at = datetime('now') WHERE job_id = ?", [id]);
      await ctx.answerCallbackQuery("Marked as applied ✅");
      await keep(ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().url("✅ Applied · view posting", job.apply_url) }));
    }
  });

  bot.catch((err) => console.error("bot:", errMsg(err.error)));
  return bot;
}
