"use client";
// Tailr dashboard — bento layout. All data comes from lib/stats.ts via the server page.
import * as React from "react";
import { useRouter } from "next/navigation";
import type { Stats } from "@/lib/stats";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const cx = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(" ");
const fmtDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/* ---------------- hooks ---------------- */

function useReducedMotion() {
  const [r, setR] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const u = () => setR(mq.matches);
    u();
    mq.addEventListener("change", u);
    return () => mq.removeEventListener("change", u);
  }, []);
  return r;
}

function useMounted() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    const t = window.setTimeout(() => setOn(true), 120); // rAF can stall (background tab, headless)
    return () => { cancelAnimationFrame(id); window.clearTimeout(t); };
  }, []);
  return on;
}

function useCountUp(target: number, enabled: boolean, duration = 1300) {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setV(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);
  return v;
}

function smooth(pts: ReadonlyArray<readonly [number, number]>) {
  return pts
    .map(([x, y], i) => {
      if (i === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      const [px, py] = pts[i - 1];
      const m = (px + x) / 2;
      return `C ${m.toFixed(1)} ${py.toFixed(1)}, ${m.toFixed(1)} ${y.toFixed(1)}, ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Seconds until HH:MM in a timezone (wraps to tomorrow). */
function secsUntil(time: string, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  const now = +p.hour * 3600 + +p.minute * 60 + +p.second;
  const [h, m] = time.split(":").map(Number);
  return (((h * 3600 + m * 60 - now) % 86400) + 86400) % 86400;
}

/* ---------------- shell ---------------- */

function Tile({ title, action, area, id, className, children }: {
  title?: React.ReactNode; action?: React.ReactNode; area: string; id?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className={cx("tile", className)} style={{ gridArea: area }}>
      {(title || action) && (
        <header className="tile-h">
          {title && <h3>{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Pills<T extends string>({ value, options, onChange, label }: { value: T; options: T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="pills">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)} className={cx(o === value && "on")}>
          {o}
        </button>
      ))}
    </div>
  );
}

/* ---------------- hero: greeting, total applied, 30-day strip ---------------- */

function HeroTile({ s, reduced }: { s: Stats; reduced: boolean }) {
  const mounted = useMounted();
  const shown = useCountUp(s.totals.applied, !reduced);
  const days = s.daily;
  const max = Math.max(1, ...days.map((d) => d.applied + d.sent));
  const month = days.reduce((t, d) => t + d.applied, 0);
  const [hover, setHover] = React.useState<number | null>(null);

  return (
    <Tile area="hero" id="overview">
      <div className="hero-top">
        <div className="min0">
          <p className="greet">Hey, <span className="accent-fg">{s.name}</span></p>
          <p className="muted sm">Here’s your job hunt at a glance — {s.roles.join(" · ")}, remote.</p>
        </div>
        <div className="hero-num">
          <p className="muted xs">Total applied</p>
          <p className="mono big">{Math.round(shown)}</p>
          <p className="mono xs">
            <span className="accent-fg">+{month}</span><span className="muted"> · 30d · {s.todays.applied} today</span>
          </p>
        </div>
      </div>

      <div className="strip-wrap">
        <div className="strip" onPointerLeave={() => setHover(null)}>
          {days.map((d, i) => {
            const v = d.applied + d.sent;
            return (
              <button
                key={d.date}
                type="button"
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${fmtDay(d.date)}: ${d.sent} sent, ${d.applied} applied`}
                style={{
                  height: mounted ? `${12 + (v / max) * 88}%` : "6%",
                  background: d.applied ? "var(--accent)" : v ? "var(--accent2)" : "var(--muted-bg)",
                  opacity: hover === null ? (v ? 0.45 + (v / max) * 0.55 : 1) : hover === i ? 1 : 0.25,
                  transition: reduced ? "none" : `height 900ms ${EASE} ${i * 18}ms, opacity 200ms ease`,
                }}
              />
            );
          })}
        </div>
        <div className="strip-x mono xs muted">
          <span>{fmtDay(days[0].date)}</span>
          <span className="fg" aria-live="polite">
            {hover !== null ? `${fmtDay(days[hover].date)} · ${days[hover].sent} sent · ${days[hover].applied} applied` : (
              <><i className="sw" style={{ background: "var(--accent)" }} />applied <i className="sw" style={{ background: "var(--accent2)" }} />sent only</>
            )}
          </span>
          <span>Today</span>
        </div>
      </div>
    </Tile>
  );
}

/* ---------------- today: ring of cards sent vs daily cap ---------------- */

function TodayTile({ s, reduced }: { s: Stats; reduced: boolean }) {
  const mounted = useMounted();
  const cap = s.quota.dailyCap;
  const t = Math.min(1, s.todays.sent / cap);
  const R = 46, C = 2 * Math.PI * R;
  return (
    <Tile area="today" title="Today" action={<span className="mono xs muted">{fmtDay(s.today)}</span>}>
      <div className="center grow">
        <div className="ring">
          <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
            <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" stroke="var(--muted-bg)" />
            <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" stroke="var(--accent)" strokeLinecap="round"
              strokeDasharray={C} transform="rotate(-90 60 60)"
              style={{ strokeDashoffset: mounted ? C * (1 - t) : C, transition: reduced ? "none" : `stroke-dashoffset 1100ms ${EASE}` }} />
          </svg>
          <div className="ring-c">
            <p className="mono lg">{s.todays.sent}<span className="muted sm">/{cap}</span></p>
            <p className="xs muted">cards sent</p>
          </div>
        </div>
      </div>
      <dl className="dl3">
        {[["Applied", s.todays.applied], ["Streak", `${s.streak}d`], ["Waiting", s.totals.waiting]].map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>
        ))}
      </dl>
    </Tile>
  );
}

/* ---------------- API quota gauge ---------------- */

function QuotaTile({ s, reduced }: { s: Stats; reduced: boolean }) {
  const [tier, setTier] = React.useState<"Month" | "Today">("Month");
  const mounted = useMounted();
  const q = s.quota;
  const [used, limit] = tier === "Month" ? [q.usedMonth, q.monthlyLimit] : [q.usedToday, Math.max(1, q.allowanceToday)];
  const t = Math.min(1, used / limit);
  const len = Math.PI * 62;
  return (
    <Tile area="quota" title="JSearch quota" action={<span className={cx("mono xs", q.blocked ? "warn" : "muted")}>{q.blocked ? "paused" : "live"}</span>}>
      <div className="center grow col">
        <svg width="150" height="86" viewBox="0 0 150 86" aria-hidden>
          <path d="M 13 78 A 62 62 0 0 1 137 78" fill="none" strokeWidth="10" strokeLinecap="round" stroke="var(--muted-bg)" />
          <path d="M 13 78 A 62 62 0 0 1 137 78" fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={len} stroke="var(--accent)"
            style={{ strokeDashoffset: len * (1 - (mounted ? t : 0)), transition: reduced ? "none" : `stroke-dashoffset 900ms ${EASE}` }} />
          <g style={{ transform: `rotate(${-90 + (mounted ? t : 0) * 180}deg)`, transformOrigin: "75px 78px", transition: reduced ? "none" : `transform 900ms ${EASE}` }}>
            <line x1="75" y1="78" x2="75" y2="30" strokeWidth="2.5" strokeLinecap="round" stroke="var(--fg)" />
          </g>
          <circle cx="75" cy="78" r="5" fill="var(--fg)" />
        </svg>
        <p className="mono lg" style={{ marginTop: 8 }}>{used} <span className="sm muted">/ {limit}</span></p>
        <p className="mono xs muted">{Math.max(0, limit - used)} requests left {tier === "Month" ? "this month" : "today"}</p>
      </div>
      <div className="center" style={{ marginTop: 16 }}>
        <Pills label="Quota period" value={tier} options={["Month", "Today"]} onChange={setTier} />
      </div>
    </Tile>
  );
}

/* ---------------- activity chart: applied vs sent ---------------- */

type Range = "1W" | "2W" | "1M";

function ChartTile({ s, reduced }: { s: Stats; reduced: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  const [range, setRange] = React.useState<Range>("1M");
  const [hover, setHover] = React.useState<number | null>(null);
  const mounted = useMounted();
  const rows = s.daily.slice(-{ "1W": 7, "2W": 14, "1M": 30 }[range]);
  const a = rows.map((r) => r.applied);
  const b = rows.map((r) => r.sent);
  const W = 640, H = 220;
  const hi = Math.max(1, ...a, ...b);
  const y = (v: number) => H - 16 - (v / hi) * (H - 40);
  const x = (i: number) => (i / (rows.length - 1)) * W;
  const pa = a.map((v, i) => [x(i), y(v)] as const);
  const pb = b.map((v, i) => [x(i), y(v)] as const);
  const la = smooth(pa), lb = smooth(pb);
  const idx = hover ?? rows.length - 1;
  const sumA = a.reduce((t, v) => t + v, 0), sumB = b.reduce((t, v) => t + v, 0);
  const left = `${(pa[idx][0] / W) * 100}%`;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(rows.length - 1, Math.round(((e.clientX - r.left) / r.width) * (rows.length - 1)))));
  };

  return (
    <Tile area="chart" id="activity" title="Daily activity" action={<Pills label="Chart range" value={range} options={["1W", "2W", "1M"]} onChange={setRange} />}>
      <div className="legend-row">
        <div>
          <p className="muted xs key"><span className="line-sw" style={{ background: "var(--accent)" }} />Applied</p>
          <p className="mono md">{a[idx]}</p>
        </div>
        <div>
          <p className="muted xs key"><span className="dash-sw" />Cards sent</p>
          <p className="mono md muted">{b[idx]}</p>
        </div>
        <div className="muted xs mono" style={{ alignSelf: "flex-end" }}>{fmtDay(rows[idx].date)}</div>
        <span className="badge-accent mono">{pct(sumA, sumB)}% applied · {range}</span>
      </div>

      <div className="chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={`Over ${range}: ${sumA} applied out of ${sumB} cards sent`}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={`${uid}-f`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} vectorEffect="non-scaling-stroke" strokeDasharray="1 5" stroke="var(--border)" />
          ))}
          <path d={`${la} L ${W} ${H} L 0 ${H} Z`} fill={`url(#${uid}-f)`} style={{ opacity: mounted ? 1 : 0, transition: "opacity 900ms ease 400ms" }} />
          <path d={lb} fill="none" strokeWidth={1.5} strokeDasharray="4 5" vectorEffect="non-scaling-stroke" stroke="var(--muted-fg)" />
          <path key={range} d={la} fill="none" strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} stroke="var(--accent)"
            style={{ strokeDasharray: 1, strokeDashoffset: mounted || reduced ? 0 : 1, transition: reduced ? "none" : `stroke-dashoffset 1300ms ${EASE}` }} />
        </svg>
        <span aria-hidden className="xhair" style={{ left, opacity: hover !== null ? 1 : 0 }} />
        <span aria-hidden className="dot-a" style={{ left, top: `${(pa[idx][1] / H) * 100}%` }} />
        <span aria-hidden className="dot-b" style={{ left, top: `${(pb[idx][1] / H) * 100}%`, opacity: hover !== null ? 1 : 0 }} />
        <span className="ymax mono xs muted" aria-hidden>{hi}</span>
      </div>
      <div className="x-labels mono xs muted" aria-hidden>
        <span>{fmtDay(rows[0].date)}</span>
        <span>{fmtDay(rows[Math.floor(rows.length / 2)].date)}</span>
        <span>Today</span>
      </div>
      <details className="xs muted">
        <summary>View as table</summary>
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>Matched</th><th>Sent</th><th>Approved</th><th>Applied</th></tr></thead>
            <tbody>
              {rows.slice().reverse().map((d) => (
                <tr key={d.date}><td>{fmtDay(d.date)}</td><td className="mono">{d.matched}</td><td className="mono">{d.sent}</td>
                  <td className="mono">{d.approved}</td><td className="mono">{d.applied}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Tile>
  );
}

/* ---------------- pipeline: segmented bar ---------------- */

function PipelineTile({ s }: { s: Stats }) {
  const mounted = useMounted();
  const t = s.totals;
  const segs = [
    { k: "Applied", v: t.applied, c: "var(--accent)" },
    { k: "In progress", v: t.ready + t.queued, c: "var(--accent2)" },
    { k: "Awaiting you", v: t.waiting, c: "oklch(0.78 0.04 280)" },
    { k: "Saved", v: t.pool, c: "oklch(0.6 0.03 280)" },
    { k: "Passed", v: t.skipped + t.failed, c: "oklch(0.42 0.02 280)" },
  ];
  const total = Math.max(1, segs.reduce((a, x) => a + x.v, 0));
  const [hover, setHover] = React.useState<number | null>(null);
  return (
    <Tile area="pipe" id="pipeline" title="Pipeline">
      <p className="mono md">{t.matched} <span className="sm muted">jobs matched</span></p>
      <div className="segs" onPointerLeave={() => setHover(null)}>
        {segs.map((x, i) => x.v > 0 && (
          <span key={x.k} onPointerEnter={() => setHover(i)} aria-hidden style={{
            flexBasis: mounted ? `${(x.v / total) * 100}%` : `${100 / segs.length}%`, background: x.c,
            opacity: hover === null || hover === i ? 1 : 0.3,
            transition: `flex-basis 1000ms ${EASE} ${200 + i * 60}ms, opacity 200ms ease`,
          }} />
        ))}
      </div>
      <ul className="seg-legend">
        {segs.map((x, i) => (
          <li key={x.k} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <span><i style={{ background: x.c }} />{x.k}</span>
            <span className="mono muted">{x.v}</span>
          </li>
        ))}
      </ul>
    </Tile>
  );
}

/* ---------------- accent tile: apply rate, next run, fit histogram ---------------- */

function RateTile({ s }: { s: Stats }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const mounted = useMounted();
  const [left, setLeft] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setLeft(secsUntil(s.schedule.time, s.schedule.timezone));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [s.schedule.time, s.schedule.timezone]);
  const t = s.totals;
  const fitMax = Math.max(1, ...s.fit.map((f) => f.value));
  const hms = left === null ? "—" : `${Math.floor(left / 3600)}h ${String(Math.floor((left % 3600) / 60)).padStart(2, "0")}m ${String(left % 60).padStart(2, "0")}s`;

  return (
    <section className="tile tile-accent" style={{ gridArea: "accent" }}>
      <header className="tile-h">
        <h3>Apply rate</h3>
        <span className="chip mono"><i />Hunting</span>
      </header>

      <p className="mono huge">{pct(t.applied, t.sent)}<span>%</span></p>
      <p className="xs dim">of {t.sent} cards sent · {pct(t.approved, t.sent)}% approved</p>

      <div className="next">
        <div className="next-row"><span className="dim">Next daily fetch</span><span className="mono">{hms}</span></div>
        <div className="next-bar"><div style={{ width: `${left === null ? 0 : (1 - left / 86400) * 100}%` }} /></div>
      </div>
      <dl className="kv">
        {[["Daily cap", `${s.quota.dailyCap} cards`], ["Resumes tailored", t.tailored], ["Avg fit", `${t.avgFit}/100`]].map(([k, v]) => (
          <div key={k}><dt className="dim">{k}</dt><dd className="mono">{v}</dd></div>
        ))}
      </dl>

      <div className="push">
        <div className="epochs" aria-hidden>
          {s.fit.map((f, i) => (
            <span key={f.label} style={{ height: mounted ? `${8 + (f.value / fitMax) * 92}%` : "8%", opacity: f.value ? 0.25 + (i / 10) * 0.6 : 0.12,
              transition: `height 900ms ${EASE} ${i * 40}ms` }} />
          ))}
        </div>
        <p className="mono xxs dim" style={{ marginTop: 6, display: "flex", justifyContent: "space-between" }}><span>Fit scores 0</span><span>100</span></p>
        <button type="button" className="cta" disabled={pending} onClick={() => start(() => router.refresh())}>
          {pending ? "Refreshing…" : "Refresh stats"}
        </button>
      </div>
    </section>
  );
}

/* ---------------- fit range: avg fit vs min score ---------------- */

function FitTile({ s }: { s: Stats }) {
  const avg = s.totals.avgFit, min = s.minScore;
  const ok = avg >= min;
  return (
    <Tile area="fit" title="Average fit" action={<span className={cx("badge mono", ok ? "good" : "bad")}>{ok ? "Above bar" : "Below bar"}</span>}>
      <p className="mono md">{avg}<span className="sm muted">/100</span></p>
      <p className="mono xs muted">best match {s.totals.maxFit}</p>
      <div className="range" role="img" aria-label={`Average fit ${avg}, minimum ${min}`}>
        <div className="range-line" />
        <div className="range-band" style={{ left: `${min}%`, width: `${100 - min}%` }} />
        <div className="range-mark" style={{ left: `${Math.max(2, Math.min(98, avg))}%` }} />
      </div>
      <div className="x-labels mono xs muted"><span>0</span><span>min {min}</span><span>100</span></div>
    </Tile>
  );
}

/* ---------------- requests stream ---------------- */

function RequestsTile({ s, reduced }: { s: Stats; reduced: boolean }) {
  const mounted = useMounted();
  const r = s.requests;
  const max = Math.max(1, ...r.map((x) => x.value));
  const sum = r.reduce((t, x) => t + x.value, 0);
  const busiest = r.reduce((b, x) => (x.value > b.value ? x : b), r[0]);
  return (
    <Tile area="req" id="requests" title="JSearch requests" action={<span className="mono xs muted">30 days</span>}>
      <div className="row-between">
        <div>
          <p className="mono md">{s.quota.usedMonth} <span className="sm muted">this month</span></p>
          <p className="mono xs muted">{s.quota.usedToday} today · {s.quota.allowanceToday} allowed</p>
        </div>
        <p className="mono xs muted">{s.quota.monthlyLimit}/mo limit</p>
      </div>
      <div className="blocks" aria-hidden>
        {r.map((x, i) => (
          <span key={x.label} style={{
            height: mounted ? `${6 + (x.value / max) * 94}%` : "6%",
            background: i === r.length - 1 ? "var(--accent)" : "var(--muted-fg)",
            opacity: i === r.length - 1 ? 1 : x.value ? 0.25 + (i / r.length) * 0.45 : 0.12,
            transition: reduced ? "none" : `height 800ms ${EASE} ${i * 15}ms`,
          }} />
        ))}
      </div>
      <dl className="dl3 bt">
        {[["Avg / day", (sum / r.length).toFixed(1)], ["Busiest", busiest.value ? `${busiest.value} · ${fmtDay(busiest.label)}` : "—"], ["Left", s.quota.monthlyLimit - s.quota.usedMonth]].map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd className="mono">{v}</dd></div>
        ))}
      </dl>
    </Tile>
  );
}

/* ---------------- recent applications ---------------- */

function StatusIcon({ status }: { status: string }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (status === "applied") return <svg {...p}><path d="m5 12 5 5 9-10" /></svg>;
  if (status === "ready") return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h4" /></svg>;
  if (status === "failed") return <svg {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>;
}

function RecentTile({ s }: { s: Stats }) {
  const mounted = useMounted();
  const color = (st: string) => (st === "applied" ? "var(--accent-fg)" : st === "failed" ? "var(--accent2)" : "var(--muted-fg)");
  return (
    <Tile area="recent" id="applications" title="Recent applications" action={<span className="mono xs muted">{s.recent.length} latest</span>}>
      {s.recent.length ? (
        <ul className="acts">
          {s.recent.slice(0, 5).map((r, i) => (
            <li key={String(r.id)} style={{ opacity: mounted ? 1 : 0, transform: mounted ? "none" : "translateY(6px)",
              transition: `opacity 500ms ease ${300 + i * 70}ms, transform 500ms ${EASE} ${300 + i * 70}ms` }}>
              <a href={String(r.apply_url)} target="_blank" rel="noreferrer">
                <span className="act-ic"><StatusIcon status={String(r.status)} /></span>
                <div className="min0 grow">
                  <p className="trunc sm fw">{r.title}</p>
                  <p className="trunc xs muted">{r.company} · {r.ago}</p>
                </div>
                <div className="right">
                  <p className="mono sm">fit {r.fit_score}</p>
                  <p className="mono xxs fw st" style={{ color: color(String(r.status)) }}>
                    {(r.status === "tailoring" || r.status === "approved") && (
                      <svg width="10" height="10" viewBox="0 0 24 24" className="spin" aria-hidden>
                        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                    {r.status}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="sm muted">Nothing approved yet — tap Yes on a Telegram card to start.</p>}
    </Tile>
  );
}

/* ---------------- breakdowns ---------------- */

type Dim = "Role" | "Mode" | "Source" | "Company" | "Channel";

function BreakdownTile({ s }: { s: Stats }) {
  const [dim, setDim] = React.useState<Dim>("Source");
  const mounted = useMounted();
  const rows = { Role: s.byRole, Mode: s.byMode, Source: s.bySource, Company: s.byCompany, Channel: s.byAts }[dim];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Tile area="brk" id="breakdown" title="Where matches come from"
      action={<Pills label="Breakdown" value={dim} options={["Source", "Company", "Role", "Mode", "Channel"]} onChange={setDim} />}>
      {rows.length ? (
        <ul className="brk">
          {rows.map((r, i) => (
            <li key={dim + r.label}>
              <span className="trunc sm" title={r.label}>{r.label}</span>
              <span className="mono sm muted">{r.value}</span>
              <div className="brk-track"><div style={{ width: mounted ? `${(r.value / max) * 100}%` : 0, transition: `width 900ms ${EASE} ${i * 60}ms`,
                background: i === 0 ? "var(--accent)" : "var(--accent2)" }} /></div>
            </li>
          ))}
        </ul>
      ) : <p className="sm muted">No data yet.</p>}
    </Tile>
  );
}

/* ---------------- page ---------------- */

export function Dashboard({ s }: { s: Stats }) {
  const reduced = useReducedMotion();

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand"><img src="/icon.svg" alt="" width={28} height={28} />Tailr</span>
        <span className="live mono"><i />Live</span>
      </header>

      <main className="bento">
        <HeroTile s={s} reduced={reduced} />
        <TodayTile s={s} reduced={reduced} />
        <QuotaTile s={s} reduced={reduced} />
        <ChartTile s={s} reduced={reduced} />
        <PipelineTile s={s} />
        <RateTile s={s} />
        <FitTile s={s} />
        <RequestsTile s={s} reduced={reduced} />
        <RecentTile s={s} />
        <BreakdownTile s={s} />
      </main>
    </div>
  );
}
