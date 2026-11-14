// The single AI entry point. Codex CLI locally, xAI Grok API on Vercel — same prompt, same schema.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, env, onVercel } from "./config";

export const llmBackend = () =>
  config.llm.backend === "auto" ? (onVercel ? "grok" : "codex") : config.llm.backend;

export async function llm<T>(prompt: string, schema: object, name: string): Promise<T> {
  const text = llmBackend() === "codex" ? await serial(() => codex(prompt, schema)) : await grok(prompt, schema, name);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`AI returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

// Codex calls run one at a time to stay within plan rate limits.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

async function codex(prompt: string, schema: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "job-seeker-"));
  try {
    const schemaFile = join(dir, "schema.json");
    const outFile = join(dir, "out.json");
    await writeFile(schemaFile, JSON.stringify(schema));
    const args = [
      "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
      "-C", dir, // empty working dir: Codex sees nothing but the prompt
      "--output-schema", schemaFile, "-o", outFile,
      ...(config.llm.codexModel ? ["-m", config.llm.codexModel] : []),
      "-", // prompt via stdin
    ];
    await exec("codex", args, prompt, 5 * 60_000);
    return await readFile(outFile, "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function exec(cmd: string, args: string[], stdin: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"], timeout: timeoutMs });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    child.on("error", (e: NodeJS.ErrnoException) =>
      reject(e.code === "ENOENT" ? new Error("Codex CLI not found. Run: npm i -g @openai/codex && codex login") : e),
    );
    child.on("close", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`codex exited ${code ?? signal}: ${stderr.trim().slice(-500)}`)),
    );
    child.stdin.end(stdin);
  });
}

/** xAI Grok via the Responses API (xAI's recommended endpoint), strict structured output. */
async function grok(prompt: string, schema: object, name: string): Promise<string> {
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env("XAI_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.llm.grokModel,
      input: prompt,
      store: false, // xAI keeps responses 30 days by default — not with resume data
      text: { format: { type: "json_schema", name, schema, strict: true } },
    }),
    // Reasoning models can be slow; stay under Vercel's 300 s function limit.
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) throw new Error(`Grok API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[] };
  // output can hold reasoning items too — find the message, then its output_text part.
  const parts = data.output?.find((o) => o.type === "message")?.content ?? [];
  const text = parts.find((c) => c.type === "output_text")?.text;
  if (!text) throw new Error(`Grok returned no output${parts[0]?.refusal ? `: ${parts[0].refusal}` : ""}`);
  return text;
}
