// Outbound Telegram messages. Usable without a running bot (worker, cron).
import { Api, InlineKeyboard, InputFile } from "grammy";
import { env, nowIn } from "./config";
import { run, type Job } from "./db";
import type { Tailored } from "./schemas";

// Node's built-in fetch instead of grammY's default node-fetch@2, which calls the deprecated
// url.parse() and logs DEP0169 once per process (each Vercel instance).
// grammY passes a polyfilled AbortSignal (abort-controller pkg) that native fetch rejects,
// so bridge it to a native one — keeps grammY's request timeouts working.
const nativeFetch: typeof fetch = (input, init) => {
  const s = init?.signal as { aborted: boolean; addEventListener(t: "abort", f: () => void): void } | null | undefined;
  if (!s || s instanceof AbortSignal) return fetch(input, init);
  const c = new AbortController();
  if (s.aborted) c.abort();
  else s.addEventListener("abort", () => c.abort());
  return fetch(input, { ...init, signal: c.signal });
};
export const TG_CLIENT = { fetch: nativeFetch };

let api: Api | undefined;
export const tg = () => (api ??= new Api(env("TELEGRAM_BOT_TOKEN"), TG_CLIENT));
export const chatId = () => Number(env("TELEGRAM_ALLOWED_CHAT_ID"));

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MODE = { onsite: "🏢 On-site", hybrid: "🏠 Hybrid", remote: "🌍 Remote" } as const;
const LANE = { auto: "🤖 auto", assisted: "🧑 assisted" } as const;

export function cardText(j: Job) {
  const exp = j.exp_min === null ? "" : ` · ${j.exp_min}${j.exp_max === null ? "+" : `–${j.exp_max}`} yrs`;
  return [
    `<b>${esc(j.title)}</b>`,
    `${esc(j.company)} · ${esc(j.location || "—")}`,
    `${MODE[j.work_mode]} · ${LANE[j.lane]} · via ${esc(j.publisher)}${exp} · fit ${j.fit_score}`,
  ].join("\n");
}

const cardKeyboard = (j: Job) =>
  new InlineKeyboard().text("✅ Yes", `y:${j.id}`).text("❌ No", `n:${j.id}`).url("🔗 View", j.url);

export const notify = (html: string, reply_markup?: InlineKeyboard) =>
  tg().sendMessage(chatId(), html, { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } });

/** Sends one card per job and marks them as sent today (counts toward the daily cap). */
export async function sendCards(jobs: Job[]) {
  const today = nowIn().date;
  for (const j of jobs) {
    const msg = await notify(cardText(j), cardKeyboard(j));
    await run(
      "UPDATE jobs SET status = 'new', message_id = ?, sent_on = COALESCE(sent_on, ?), updated_at = datetime('now') WHERE id = ?",
      [msg.message_id, today, j.id],
    );
  }
}

/** Assisted hand-off: cover letter + answers, then the PDF with Apply / I applied buttons. */
export async function sendHandoff(j: Job, t: Tailored, pdf: Uint8Array, filename: string) {
  const answers = t.answers.map((a) => `<b>${esc(a.question)}</b>\n${esc(a.answer.slice(0, 600))}`).join("\n\n");
  await notify(`<b>Cover letter — ${esc(j.company)}</b>\n\n${esc(t.coverLetter.slice(0, 2500))}\n\n${answers}`);

  const note = j.lane === "auto" ? "\n🤖 Auto-submit isn't enabled yet — apply with the button." : "";
  await tg().sendDocument(chatId(), new InputFile(pdf, filename), {
    caption: `📄 <b>${esc(j.title)}</b>\n${esc(j.company)} · ${esc(j.location)}${note}`,
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .url(`🔗 Apply on ${j.publisher || "site"}`, j.apply_url)
      .row()
      .text("✅ I applied", `a:${j.id}`),
  });
}
