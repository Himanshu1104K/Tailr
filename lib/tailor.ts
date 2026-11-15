// Base resume + job → tailored resume, cover letter, common answers. Validated: no invented facts.
import { config } from "./config";
import type { Job } from "./db";
import { llm } from "./llm";
import { tailoredSchema, type Resume, type Tailored } from "./schemas";

const QUESTIONS = [
  "Why are you interested in this role?",
  "Summarise your most relevant experience for this role.",
  "What is your notice period?",
  "What are your salary expectations?",
];

function prompt(base: Resume, job: Job, previousErrors: string[]) {
  return `You are tailoring a resume for ONE job application. Return JSON matching the schema.

STRICT RULES — breaking any of these makes the output unusable:
1. Use ONLY facts present in BASE_RESUME. Never invent or change employers, job titles, dates, degrees, skills, tools, numbers or metrics.
2. Keep every experience entry, with company, title, start and end copied exactly.
3. Skills: only items that already appear in BASE_RESUME skills, spelled exactly the same. You may reorder items and groups, and drop irrelevant ones.
4. Every number you write must already appear somewhere in BASE_RESUME.
5. Keep "name", "contact", "education" and "certifications" exactly as in BASE_RESUME.

WHAT TO DO:
- Rewrite "headline" and "summary" (2–3 sentences) for this role.
- Reorder and reword bullets so work relevant to the job comes first and uses the job's vocabulary where it is truthful. Max 4 bullets per role, each under 25 words. Keep at least 2 per role.
- Order skills so the job's required skills that the candidate has come first.
- Keep at most 2 projects, the most relevant to the job, with at most 2 bullets each.
- The resume MUST fit on one A4 page: summary under 50 words, no filler. Shorter is better than overflowing.
- "coverLetter": 150–220 words of plain text to the hiring team at ${job.company}. Specific to this job, no placeholders, no invented facts, signed with the candidate's name.
- "answers": answer each of these in under 80 words, using only BASE_RESUME and PROFILE (say "Open to discussion" if the profile has no value): ${JSON.stringify(QUESTIONS)}
${previousErrors.length ? `\nYOUR PREVIOUS ATTEMPT WAS REJECTED FOR:\n- ${previousErrors.join("\n- ")}\nFix every one of these.\n` : ""}
JOB:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location} (${job.work_mode})
Description:
${job.description.slice(0, 12_000)}

PROFILE:
${JSON.stringify(config.profile)}

BASE_RESUME:
${JSON.stringify(base)}`;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const expKey = (e: Resume["experience"][number]) => norm([e.company, e.title, e.start, e.end].join(" | "));
const numbers = (s: string) => s.match(/\d+(?:[.,]\d+)?/g) ?? [];

/** Returns a list of problems; empty = safe to send. */
export function validate(base: Resume, t: Tailored): string[] {
  const errors: string[] = [];

  const baseExp = new Set(base.experience.map(expKey));
  const tExp = new Set(t.resume.experience.map(expKey));
  for (const k of tExp) if (!baseExp.has(k)) errors.push(`Experience entry not in base resume: "${k}"`);
  for (const k of baseExp) if (!tExp.has(k)) errors.push(`Experience entry missing or altered: "${k}"`);

  const baseSkills = new Set(base.skills.flatMap((g) => g.items).map(norm));
  const extra = t.resume.skills.flatMap((g) => g.items).filter((s) => !baseSkills.has(norm(s)));
  if (extra.length) errors.push(`Skills not in base resume: ${extra.join(", ")}`);

  const baseProjects = new Set(base.projects.map((p) => norm(p.name)));
  for (const p of t.resume.projects) if (!baseProjects.has(norm(p.name))) errors.push(`Project not in base resume: "${p.name}"`);

  const baseNums = new Set(numbers(JSON.stringify(base)));
  const written = [
    t.resume.headline,
    t.resume.summary,
    ...t.resume.experience.flatMap((e) => e.bullets),
    ...t.resume.projects.flatMap((p) => p.bullets),
    t.coverLetter,
  ].join("\n");
  const newNums = [...new Set(numbers(written))].filter((n) => !baseNums.has(n));
  if (newNums.length) errors.push(`Numbers not in base resume: ${newNums.join(", ")}`);

  return errors;
}

/** One retry with the validator's feedback, then give up loudly. */
export async function tailor(base: Resume, job: Job): Promise<Tailored> {
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = await llm<Tailored>(prompt(base, job, errors), tailoredSchema, "tailored_resume");
    // Identity fields are never the model's to change — force them.
    t.resume = { ...t.resume, name: base.name, contact: base.contact, education: base.education, certifications: base.certifications };
    errors = validate(base, t);
    if (!errors.length) return t;
  }
  throw new Error(`Tailored resume failed validation: ${errors.join("; ")}`);
}
