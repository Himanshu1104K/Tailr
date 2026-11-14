// Vercel: Telegram webhook. Long work (fetch, tailoring) runs after the response via after().
import { webhookCallback } from "grammy";
import { after } from "next/server";
import { createBot } from "@/lib/bot";
import { config, env } from "@/lib/config";
import { processJob } from "@/lib/worker";

export const maxDuration = 300;

let handler: ((req: Request) => Promise<Response>) | undefined;

function getHandler() {
  return (handler ??= webhookCallback(
    createBot({
      defer: (task) => after(task),
      onApproved: (job) => {
        // hybrid: auto-lane jobs wait in the queue for the local worker.
        if (config.mode === "hybrid" && job.lane === "auto") return;
        after(() => processJob(job.id));
      },
    }),
    "std/http",
    { secretToken: env("TELEGRAM_WEBHOOK_SECRET") },
  ));
}

export const POST = (req: Request) => getHandler()(req);
