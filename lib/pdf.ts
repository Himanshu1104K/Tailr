// Resume JSON → one-column, ATS-friendly PDF. Pure JS (no browser), so it runs on Vercel.
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createElement as h, type ReactElement, type ReactNode } from "react";
import type { Resume } from "./schemas";

// k scales font sizes and spacing together, so the layout shrinks evenly when content runs long.
const styles = (k: number) => StyleSheet.create({
  page: { padding: 36 * k, fontSize: 9.5 * k, fontFamily: "Helvetica", lineHeight: 1.35, color: "#111" },
  name: { fontSize: 18 * k, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 3 * k },
  headline: { fontSize: 10.5 * k, color: "#333" },
  contact: { marginTop: 4 * k, color: "#333" },
  section: { marginTop: 10 * k },
  heading: {
    fontSize: 10 * k, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.8,
    borderBottomWidth: 0.75, borderBottomColor: "#999", paddingBottom: 2 * k, marginBottom: 4 * k,
  },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#444" },
  item: { marginBottom: 5 * k },
  bullet: { flexDirection: "row", marginTop: 1.5 * k },
  dot: { width: 10 * k },
  bulletText: { flex: 1 },
});

const dates = (a: string, b: string) => [a, b].filter(Boolean).join(" – ");

function ResumeDoc(r: Resume, k: number) {
  const s = styles(k);
  const section = (title: string, children: ReactNode) => h(View, { style: s.section }, h(Text, { style: s.heading }, title), children);
  const bullets = (items: string[]) =>
    items.map((b, i) => h(View, { key: i, style: s.bullet }, h(Text, { style: s.dot }, "•"), h(Text, { style: s.bulletText }, b)));
  const contact = [r.contact.email, r.contact.phone, r.contact.location].filter(Boolean);
  return h(
    Document,
    { title: `${r.name} — Resume`, author: r.name },
    h(
      Page,
      { size: "A4", style: s.page },
      h(Text, { style: s.name }, r.name),
      r.headline && h(Text, { style: s.headline }, r.headline),
      h(
        Text,
        { style: s.contact },
        contact.join("  ·  "),
        ...r.contact.links.flatMap((l, i) => [
          contact.length || i ? "  ·  " : "",
          h(Link, { key: l.url, src: l.url }, l.label || l.url),
        ]),
      ),
      r.summary && section("Summary", h(Text, null, r.summary)),
      r.skills.length > 0 &&
        section(
          "Skills",
          r.skills.map((g, i) => h(Text, { key: i }, g.category ? h(Text, { style: s.bold }, `${g.category}: `) : null, g.items.join(", "))),
        ),
      r.experience.length > 0 &&
        section(
          "Experience",
          r.experience.map((e, i) =>
            h(
              View,
              { key: i, style: s.item, wrap: false },
              h(View, { style: s.row }, h(Text, { style: s.bold }, `${e.title} — ${e.company}`), h(Text, { style: s.muted }, dates(e.start, e.end))),
              e.location && h(Text, { style: s.muted }, e.location),
              ...bullets(e.bullets),
            ),
          ),
        ),
      r.projects.length > 0 &&
        section(
          "Projects",
          r.projects.map((p, i) =>
            h(View, { key: i, style: s.item, wrap: false }, h(Text, { style: s.bold }, p.link ? `${p.name} — ${p.link}` : p.name), ...bullets(p.bullets)),
          ),
        ),
      r.education.length > 0 &&
        section(
          "Education",
          r.education.map((e, i) =>
            h(
              View,
              { key: i, style: s.item },
              h(View, { style: s.row }, h(Text, { style: s.bold }, `${e.degree} — ${e.institution}`), h(Text, { style: s.muted }, dates(e.start, e.end))),
              e.details && h(Text, null, e.details),
            ),
          ),
        ),
      r.certifications.length > 0 && section("Certifications", bullets(r.certifications)),
    ),
  );
}

const render = (r: Resume, k: number) => renderToBuffer(ResumeDoc(r, k) as ReactElement<any>);

/** Page objects in the PDF ("/Type /Page", not "/Pages"). Page dictionaries are written uncompressed. */
export const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

const SCALES = [1, 0.95, 0.9, 0.86, 0.82]; // 9.5pt body → ~7.8pt floor, still readable
const MIN_BULLETS = 2;

/** Removes the least important line: last project bullet, then a project, then the last bullet of the oldest long role. */
function trimOne(r: Resume): Resume | null {
  const projects = r.projects.map((p) => ({ ...p, bullets: [...p.bullets] }));
  const lastP = projects.at(-1);
  if (lastP && lastP.bullets.length > 1) { lastP.bullets.pop(); return { ...r, projects }; }
  if (lastP) return { ...r, projects: projects.slice(0, -1) };
  for (let i = r.experience.length - 1; i >= 0; i--) {
    if (r.experience[i].bullets.length > MIN_BULLETS) {
      const experience = r.experience.map((e, j) => (j === i ? { ...e, bullets: e.bullets.slice(0, -1) } : e));
      return { ...r, experience };
    }
  }
  return null; // nothing left that is safe to drop
}

/**
 * Renders the resume on exactly one A4 page: shrinks type first, then drops the least important lines.
 * Returns the resume as actually printed, so what is stored matches the PDF.
 */
export async function renderResumePdf(r: Resume): Promise<{ pdf: Buffer; resume: Resume }> {
  for (const k of SCALES) {
    const pdf = await render(r, k);
    if (pageCount(pdf) <= 1) return { pdf, resume: r };
  }
  const k = SCALES.at(-1)!;
  for (let next = trimOne(r); next; next = trimOne(next)) {
    const pdf = await render(next, k);
    if (pageCount(pdf) <= 1) return { pdf, resume: next };
  }
  throw new Error("Resume does not fit on one page even at the smallest size — shorten the base resume.");
}

export const pdfName = (r: Resume, company: string) =>
  `${r.name || "Resume"}_${company}`.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "") + ".pdf";
