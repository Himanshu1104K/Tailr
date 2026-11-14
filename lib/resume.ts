// Base resume: data/resume.pdf → structured JSON, cached in the DB by file hash.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText } from "unpdf";
import { config } from "./config";
import { kvGet, kvSet } from "./db";
import { llm } from "./llm";
import { resumeSchema, type Resume } from "./schemas";

/** Re-parses only when the PDF changes (or force=true), so replacing the file is all you need to do. */
export async function getBaseResume(force = false): Promise<Resume> {
  // data/** is shipped via outputFileTracingIncludes, so tell the bundler not to trace this path.
  const path = join(/*turbopackIgnore: true*/ process.cwd(), config.resume.path);
  const pdf = await readFile(path).catch(() => {
    throw new Error(`Resume not found at ${config.resume.path}. Put your PDF there.`);
  });
  const hash = createHash("sha256").update(pdf).digest("hex");

  if (!force) {
    const cached = await kvGet("resume");
    if (cached) {
      const c = JSON.parse(cached) as { hash: string; resume: Resume };
      if (c.hash === hash) return c.resume;
    }
  }

  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  if (!text.trim()) throw new Error("Could not read any text from the resume PDF (is it a scanned image?).");

  const resume = await llm<Resume>(
    `Extract this resume into the JSON schema.
- Copy facts exactly as written. Do not summarise, improve, reword or invent anything.
- Use "" for missing text fields and [] for missing lists.
- Keep dates exactly as written (e.g. "Jan 2022", "Present").
- Keep the resume's own skill groupings as categories; if it has none, group sensibly.
- Every bullet point goes into "bullets" verbatim.

RESUME TEXT:
${text}`,
    resumeSchema,
    "resume",
  );
  await kvSet("resume", JSON.stringify({ hash, resume }));
  return resume;
}
