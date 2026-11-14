// Vercel Cron: daily fetch (schedule in vercel.json). Vercel sends the CRON_SECRET bearer automatically.
import { env } from "@/lib/config";
import { runFetch } from "@/lib/fetch";

export const maxDuration = 300;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await runFetch());
}
