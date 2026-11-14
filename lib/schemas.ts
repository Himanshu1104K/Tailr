// JSON Schemas shared by both AI backends (Codex --output-schema and Grok structured outputs).
// Strict mode: every property required, no extras; "" / [] stand in for missing values.

export interface Resume {
  name: string;
  headline: string;
  contact: { email: string; phone: string; location: string; links: { label: string; url: string }[] };
  summary: string;
  skills: { category: string; items: string[] }[];
  experience: { company: string; title: string; location: string; start: string; end: string; bullets: string[] }[];
  projects: { name: string; link: string; bullets: string[] }[];
  education: { institution: string; degree: string; start: string; end: string; details: string }[];
  certifications: string[];
}

export interface Tailored {
  resume: Resume;
  coverLetter: string;
  answers: { question: string; answer: string }[];
}

const str = { type: "string" };
const strs = { type: "array", items: str };
const list = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const resumeSchema = obj({
  name: str,
  headline: str,
  contact: obj({ email: str, phone: str, location: str, links: list(obj({ label: str, url: str })) }),
  summary: str,
  skills: list(obj({ category: str, items: strs })),
  experience: list(obj({ company: str, title: str, location: str, start: str, end: str, bullets: strs })),
  projects: list(obj({ name: str, link: str, bullets: strs })),
  education: list(obj({ institution: str, degree: str, start: str, end: str, details: str })),
  certifications: strs,
});

export const tailoredSchema = obj({
  resume: resumeSchema,
  coverLetter: str,
  answers: list(obj({ question: str, answer: str })),
});
