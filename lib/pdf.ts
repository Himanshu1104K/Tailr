// Resume JSON → one-column, ATS-friendly PDF. Pure JS (no browser), so it runs on Vercel.
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createElement as h, type ReactElement, type ReactNode } from "react";
import type { Resume } from "./schemas";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: "Helvetica", lineHeight: 1.35, color: "#111" },
  name: { fontSize: 18, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 3 },
  headline: { fontSize: 10.5, color: "#333" },
  contact: { marginTop: 4, color: "#333" },
  section: { marginTop: 10 },
  heading: {
    fontSize: 10, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.8,
    borderBottomWidth: 0.75, borderBottomColor: "#999", paddingBottom: 2, marginBottom: 4,
  },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Helvetica-Bold" },
  muted: { color: "#444" },
  item: { marginBottom: 5 },
  bullet: { flexDirection: "row", marginTop: 1.5 },
  dot: { width: 10 },
  bulletText: { flex: 1 },
});

const section = (title: string, children: ReactNode) => h(View, { style: s.section }, h(Text, { style: s.heading }, title), children);
const bullets = (items: string[]) =>
  items.map((b, i) => h(View, { key: i, style: s.bullet }, h(Text, { style: s.dot }, "•"), h(Text, { style: s.bulletText }, b)));
const dates = (a: string, b: string) => [a, b].filter(Boolean).join(" – ");

function ResumeDoc(r: Resume) {
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

export const renderResumePdf = (r: Resume) => renderToBuffer(ResumeDoc(r) as ReactElement<any>);

export const pdfName = (r: Resume, company: string) =>
  `${r.name || "Resume"}_${company}`.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "") + ".pdf";
