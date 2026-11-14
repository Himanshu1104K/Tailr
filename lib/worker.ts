// Approved job → tailored resume → PDF → Telegram hand-off.
import { InlineKeyboard } from "grammy";
import { errMsg } from "./config";
import { first, run, type Job } from "./db";
import { esc, notify, sendHandoff } from "./notify";
import { pdfName, renderResumePdf } from "./pdf";
import { getBaseResume } from "./resume";
import { tailor } from "./tailor";

// A job stuck in 'tailoring' for 10+ min (crash, Vercel timeout) is up for grabs again.
const CLAIMABLE = `(status = 'approved' OR (status = 'tailoring' AND updated_at < datetime('now', '-10 minutes')))`;

export async function processJob(id: number) {
  // Atomic claim: only one process (local worker or Vercel) can win a job.
  const job = await first<Job>(
    `UPDATE jobs SET status = 'tailoring', updated_at = datetime('now') WHERE id = ? AND ${CLAIMABLE} RETURNING *`,
    [id],
  );
  if (!job) return;

  try {
    const base = await getBaseResume();
    const t = await tailor(base, job);
    const pdf = await renderResumePdf(t.resume);
    await run(
      `INSERT INTO applications (job_id, resume_json, cover_letter, answers_json, method) VALUES (?, ?, ?, ?, 'assisted')
       ON CONFLICT(job_id) DO UPDATE SET resume_json = excluded.resume_json, cover_letter = excluded.cover_letter,
         answers_json = excluded.answers_json, created_at = datetime('now')`,
      [job.id, JSON.stringify(t.resume), t.coverLetter, JSON.stringify(t.answers)],
    );
    // ponytail: auto lane falls back to the assisted hand-off until the ATS adapters (Playwright) land.
    await sendHandoff(job, t, pdf, pdfName(t.resume, job.company));
    await run("UPDATE jobs SET status = 'ready', error = NULL, updated_at = datetime('now') WHERE id = ?", [job.id]);
  } catch (e) {
    const msg = errMsg(e);
    console.error(`job ${job.id} failed:`, msg);
    await run("UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?", [msg, job.id]);
    await notify(
      `⚠️ <b>${esc(job.title)}</b> at ${esc(job.company)} failed:\n<code>${esc(msg.slice(0, 600))}</code>`,
      new InlineKeyboard().text("♻️ Retry", `r:${job.id}`),
    ).catch(console.error);
  }
}

/** Polls the queue; returns a kick() to process immediately (e.g. right after you tap Yes). */
export function startWorker(intervalMs = 15_000): () => void {
  let busy = false;
  const drain = async () => {
    if (busy) return;
    busy = true;
    try {
      for (;;) {
        const next = await first<{ id: number }>(`SELECT id FROM jobs WHERE ${CLAIMABLE} ORDER BY updated_at LIMIT 1`);
        if (!next) break;
        await processJob(next.id);
      }
    } catch (e) {
      console.error("worker:", errMsg(e));
    } finally {
      busy = false;
    }
  };
  setInterval(drain, intervalMs);
  void drain();
  return () => void drain();
}
