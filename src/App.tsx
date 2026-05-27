import { useState, useEffect, useRef, useCallback } from "react";

/* ──────────────── TYPES ──────────────── */
type Phase = "idle" | "init" | "ping" | "download" | "upload" | "done";

interface NetInfo {
  ip: string;
  isp: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  org: string;
  lat: number;
  lon: number;
}

interface DeviceNet {
  type: string;
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
  online: boolean;
}

interface Result {
  dl: number;
  ul: number;
  ping: number;
  jitter: number;
  time: string;
}

/* ──────── REAL NETWORK INFO FETCH ──────── */
async function fetchNetInfo(): Promise<NetInfo> {
  const fallback: NetInfo = {
    ip: "—", isp: "—", city: "—", region: "—", country: "—",
    timezone: "—", org: "—", lat: 0, lon: 0,
  };
  try {
    // Try ipwho.is first (free, HTTPS, no key)
    const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.success !== false && d.ip) {
      return {
        ip: d.ip || "—",
        isp: d.connection?.isp || d.connection?.org || "—",
        city: d.city || "—",
        region: d.region || "—",
        country: d.country || "—",
        timezone: d.timezone?.id || "—",
        org: d.connection?.org || d.connection?.isp || "—",
        lat: d.latitude || 0,
        lon: d.longitude || 0,
      };
    }
  } catch { /* ignore */ }
  try {
    // Fallback: ipapi.co
    const r = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    if (d.ip) {
      return {
        ip: d.ip, isp: d.org || "—", city: d.city || "—",
        region: d.region || "—", country: d.country_name || "—",
        timezone: d.timezone || "—", org: d.org || "—",
        lat: d.latitude || 0, lon: d.longitude || 0,
      };
    }
  } catch { /* ignore */ }
  return fallback;
}

/* ──────── DEVICE NETWORK (Navigator API) ──────── */
function getDeviceNet(): DeviceNet {
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  return {
    type: conn?.type || "unknown",
    effectiveType: conn?.effectiveType || "unknown",
    downlink: conn?.downlink ?? -1,
    rtt: conn?.rtt ?? -1,
    saveData: conn?.saveData ?? false,
    online: navigator.onLine,
  };
}

/* (Ping is measured inline in startTest) */

/* ──────── REAL DOWNLOAD SPEED TEST ──────── */
async function measureDownload(
  onProgress: (speedMbps: number, progress: number) => void,
  signal: AbortSignal,
): Promise<number> {
  const sizes = [
    100000,     // 100 KB warmup
    500000,     // 500 KB
    1000000,    // 1 MB
    2000000,    // 2 MB
    5000000,    // 5 MB
    10000000,   // 10 MB
    25000000,   // 25 MB
  ];
  const speeds: number[] = [];
  let progress = 0;

  for (let i = 0; i < sizes.length; i++) {
    if (signal.aborted) break;
    const bytes = sizes[i];
    const url = `https://speed.cloudflare.com/__down?bytes=${bytes}&_=${Date.now()}`;
    try {
      const t0 = performance.now();
      const resp = await fetch(url, { cache: "no-store", mode: "cors", signal });
      if (!resp.body) {
        // fallback: just await the blob
        await resp.blob();
      } else {
        // Stream read to get progress
        const reader = resp.body.getReader();
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.length;
        }
      }
      const t1 = performance.now();
      const durationSec = (t1 - t0) / 1000;
      const bitsLoaded = bytes * 8;
      const speedMbps = bitsLoaded / durationSec / 1_000_000;
      // Only count non-warmup measurements (skip first if tiny)
      if (i > 0 || durationSec > 0.05) {
        speeds.push(speedMbps);
      }
      progress = (i + 1) / sizes.length;
      const currentAvg = speeds.length > 0
        ? speeds.reduce((a, b) => a + b, 0) / speeds.length
        : speedMbps;
      onProgress(currentAvg, progress);

      // If a single request took >3s, we have enough data
      if (durationSec > 3) break;
    } catch (e: any) {
      if (e.name === "AbortError") break;
      // skip failed request
    }
  }
  if (speeds.length === 0) return 0;
  // Use 90th percentile
  const sorted = [...speeds].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/* ──────── REAL UPLOAD SPEED TEST ──────── */
async function measureUpload(
  onProgress: (speedMbps: number, progress: number) => void,
  signal: AbortSignal,
): Promise<number> {
  const sizes = [
    100000,   // 100 KB warmup
    500000,   // 500 KB
    1000000,  // 1 MB
    2000000,  // 2 MB
    5000000,  // 5 MB
  ];
  const speeds: number[] = [];
  let progress = 0;

  for (let i = 0; i < sizes.length; i++) {
    if (signal.aborted) break;
    const bytes = sizes[i];
    const payload = new Uint8Array(bytes);
    // Fill with random-ish data to avoid compression
    for (let j = 0; j < Math.min(bytes, 1024); j++) {
      payload[j] = Math.floor(Math.random() * 256);
    }
    const url = `https://speed.cloudflare.com/__up`;
    try {
      const t0 = performance.now();
      await fetch(url, {
        method: "POST",
        cache: "no-store",
        mode: "cors",
        body: payload.buffer,
        signal,
      });
      const t1 = performance.now();
      const durationSec = (t1 - t0) / 1000;
      const bitsLoaded = bytes * 8;
      const speedMbps = bitsLoaded / durationSec / 1_000_000;
      if (i > 0 || durationSec > 0.05) {
        speeds.push(speedMbps);
      }
      progress = (i + 1) / sizes.length;
      const currentAvg = speeds.length > 0
        ? speeds.reduce((a, b) => a + b, 0) / speeds.length
        : speedMbps;
      onProgress(currentAvg, progress);
      if (durationSec > 3) break;
    } catch (e: any) {
      if (e.name === "AbortError") break;
    }
  }
  if (speeds.length === 0) return 0;
  const sorted = [...speeds].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.9);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/* ═══════════ UI COMPONENTS ═══════════ */

/* ─── Particle BG ─── */
function ParticleBG() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let id = 0;
    const ps: { x: number; y: number; vx: number; vy: number; s: number; c: string }[] = [];
    const colors = ["#00e5ff", "#ab47bc", "#ff4081", "#00e676"];
    const resize = () => { c.width = innerWidth; c.height = innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    for (let i = 0; i < 50; i++) {
      ps.push({
        x: Math.random() * c.width, y: Math.random() * c.height,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        s: Math.random() * 2 + 0.5, c: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    const draw = () => {
      ctx.fillStyle = "rgba(6,6,15,0.18)"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = "rgba(0,229,255,0.025)"; ctx.lineWidth = 0.5;
      for (let x = 0; x < c.width; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke(); }
      for (let y = 0; y < c.height; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); }
      ps.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = c.width; if (p.x > c.width) p.x = 0;
        if (p.y < 0) p.y = c.height; if (p.y > c.height) p.y = 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fillStyle = p.c + "90"; ctx.fill();
        for (let j = i + 1; j < ps.length; j++) {
          const dx = p.x - ps[j].x, dy = p.y - ps[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 120) {
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ps[j].x, ps[j].y);
            ctx.strokeStyle = p.c + Math.floor((1 - d / 120) * 25).toString(16).padStart(2, "0");
            ctx.lineWidth = 0.4; ctx.stroke();
          }
        }
      });
      id = requestAnimationFrame(draw);
    };
    ctx.fillStyle = "#06060f"; ctx.fillRect(0, 0, c.width, c.height);
    draw();
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, zIndex: 0, opacity: 0.6, pointerEvents: "none" }} />;
}

/* ─── Arc Gauge ─── */
function Gauge({ value, max, color, label, active }: { value: number; max: number; color: string; label: string; active: boolean }) {
  const size = 260, sw = 10;
  const r = (size - sw * 2) / 2 - 18;
  const circ = 2 * Math.PI * r;
  const startA = 135, arcA = 270;
  const pct = Math.min(value / max, 1);
  const dash = circ * (arcA / 360);
  const off = dash * (1 - pct);
  const cx = size / 2, cy = size / 2;
  const startRad = (startA * Math.PI) / 180;
  const endRad = ((startA + arcA) * Math.PI) / 180;
  const x1 = cx + Math.cos(startRad) * r, y1 = cy + Math.sin(startRad) * r;
  const x2 = cx + Math.cos(endRad) * r, y2 = cy + Math.sin(endRad) * r;
  const arc = `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;

  const ticks = [];
  for (let i = 0; i <= 30; i++) {
    const a = startA + (i / 30) * arcA;
    const rad = (a * Math.PI) / 180;
    const major = i % 5 === 0;
    const ir = r - (major ? 16 : 10), or = r - 3;
    const on = i / 30 <= pct;
    ticks.push(<line key={i} x1={cx + Math.cos(rad) * ir} y1={cy + Math.sin(rad) * ir} x2={cx + Math.cos(rad) * or} y2={cy + Math.sin(rad) * or} stroke={on ? color : "rgba(255,255,255,0.12)"} strokeWidth={major ? 2.5 : 1} style={on ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined} />);
  }
  const labs = [];
  for (let i = 0; i <= 5; i++) {
    const a = startA + (i / 5) * arcA;
    const rad = (a * Math.PI) / 180;
    const lr = r - 30;
    labs.push(<text key={i} x={cx + Math.cos(rad) * lr} y={cy + Math.sin(rad) * lr} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">{Math.round((i / 5) * max)}</text>);
  }
  return (
    <div style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      <svg width={size} height={size} style={{ filter: `drop-shadow(0 0 12px ${color}30)` }}>
        <defs><linearGradient id={`g-${color.replace('#', '')}`} x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={color + "80"} /></linearGradient></defs>
        <path d={arc} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} strokeLinecap="round" />
        <path d={arc} fill="none" stroke={`url(#g-${color.replace('#', '')})`} strokeWidth={sw} strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={off} style={{ transition: "stroke-dashoffset 0.4s ease-out", filter: `drop-shadow(0 0 8px ${color})` }} />
        {ticks}{labs}
        <circle cx={cx} cy={cy} r={48} fill="rgba(6,6,15,0.85)" stroke={color + "30"} strokeWidth={1} />
        {active && <circle cx={cx} cy={cy} r={42} fill="none" stroke={color + "25"} strokeWidth={1} strokeDasharray="6 10" style={{ animation: "spin-reverse 10s linear infinite", transformOrigin: `${cx}px ${cy}px` }} />}
        <circle cx={cx} cy={cy} r={r + 14} fill="none" stroke={color + "12"} strokeWidth={0.5} strokeDasharray="4 8" style={{ animation: "spin-slow 25s linear infinite", transformOrigin: `${cx}px ${cy}px` }} />
      </svg>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", paddingTop: 4 }}>
        <div style={{ fontSize: 36, fontWeight: 800, color, letterSpacing: 2, textShadow: `0 0 20px ${color}90`, fontFamily: "monospace", transition: "all 0.15s" }}>{value.toFixed(1)}</div>
        <div style={{ fontSize: 10, letterSpacing: 4, color: color + "80", textTransform: "uppercase" }}>Mbps</div>
      </div>
      <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, letterSpacing: 6, textTransform: "uppercase", color, textShadow: `0 0 10px ${color}60`, fontFamily: "monospace" }}>{label}</div>
    </div>
  );
}

/* ─── Wave ─── */
function Wave({ active, speed, color }: { active: boolean; speed: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useRef<number[]>(new Array(100).fill(0));
  const t = useRef(0);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    let id = 0;
    const draw = () => {
      const w = c.width, h = c.height; t.current += 0.05;
      ctx.clearRect(0, 0, w, h);
      if (active) {
        const n = (speed / 400) + Math.sin(t.current * 3) * 0.1 + Math.sin(t.current * 11) * 0.05;
        data.current.push(Math.max(0, Math.min(1, n)));
      } else {
        data.current.push((data.current[data.current.length - 1] || 0) * 0.93);
      }
      if (data.current.length > 100) data.current.shift();
      const gr = ctx.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, color + "35"); gr.addColorStop(1, color + "00");
      ctx.beginPath(); ctx.moveTo(0, h);
      data.current.forEach((v, i) => { const x = (i / 99) * w, y = h - v * h * 0.85; i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y); });
      ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = gr; ctx.fill();
      ctx.beginPath();
      data.current.forEach((v, i) => { const x = (i / 99) * w, y = h - v * h * 0.85; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      if (active && data.current.length > 0) {
        const lv = data.current[data.current.length - 1];
        ctx.beginPath(); ctx.arc(w - 1, h - lv * h * 0.85, 3, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
      }
      id = requestAnimationFrame(draw);
    };
    c.width = 600; c.height = 100;
    draw();
    return () => cancelAnimationFrame(id);
  }, [active, speed, color]);
  return <canvas ref={ref} style={{ width: "100%", height: 50, borderRadius: 8 }} />;
}

/* ─── Stat box ─── */
function Stat({ label, value, unit, color, icon }: { label: string; value: string; unit: string; color: string; icon: string }) {
  return (
    <div style={{ background: "rgba(12,12,30,0.7)", border: `1px solid ${color}22`, borderRadius: 12, padding: "12px 14px", position: "relative", overflow: "hidden", transition: "border-color 0.3s" }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = color + "55")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = color + "22")}>
      <div style={{ position: "absolute", top: 0, left: 0, width: 8, height: 8, borderTop: `1px solid ${color}50`, borderLeft: `1px solid ${color}50` }} />
      <div style={{ position: "absolute", top: 0, right: 0, width: 8, height: 8, borderTop: `1px solid ${color}50`, borderRight: `1px solid ${color}50` }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, width: 8, height: 8, borderBottom: `1px solid ${color}50`, borderLeft: `1px solid ${color}50` }} />
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 8, borderBottom: `1px solid ${color}50`, borderRight: `1px solid ${color}50` }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: color + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: `0 0 12px ${color}20` }}>{icon}</div>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 3, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color, textShadow: `0 0 12px ${color}70`, fontFamily: "monospace" }}>{value}</span>
            <span style={{ fontSize: 9, letterSpacing: 2, color: color + "70", textTransform: "uppercase" }}>{unit}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Info Row ─── */
function InfoRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: "monospace", color, textShadow: `0 0 6px ${color}30`, maxWidth: 160, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

/* ─── Phase Steps ─── */
function PhaseSteps({ phase }: { phase: Phase }) {
  const steps = ["init", "ping", "download", "upload", "done"];
  const labels = ["Init", "Ping", "Download", "Upload", "Done"];
  const ci = steps.indexOf(phase);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 18, flexWrap: "wrap" }}>
      {steps.map((s, i) => {
        const active = i <= ci;
        const current = i === ci && phase !== "idle" && phase !== "done";
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", border: `1.5px solid ${active ? "#00e5ff" : "rgba(255,255,255,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: active ? "#00e5ff" : "rgba(255,255,255,0.2)", background: active ? "rgba(0,229,255,0.08)" : "transparent", boxShadow: current ? "0 0 12px #00e5ff40" : "none", transition: "all 0.3s", animation: current ? "pulse-glow 1s ease-in-out infinite" : "none" }}>
              {i < ci ? "✓" : i + 1}
            </div>
            <span style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: active ? "#00e5ff80" : "rgba(255,255,255,0.12)" }}>{labels[i]}</span>
            {i < steps.length - 1 && <div style={{ width: 20, height: 1, background: i < ci ? "#00e5ff50" : "rgba(255,255,255,0.08)" }} />}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Quality Badge ─── */
function QualityBadge({ dl }: { dl: number }) {
  const grade = dl > 100 ? "EXCELLENT" : dl > 50 ? "GREAT" : dl > 20 ? "GOOD" : dl > 5 ? "FAIR" : "SLOW";
  const c = dl > 100 ? "#00e676" : dl > 50 ? "#00e5ff" : dl > 20 ? "#ff9100" : "#ff5252";
  const bars = dl > 100 ? 5 : dl > 50 ? 4 : dl > 20 ? 3 : dl > 5 ? 2 : 1;
  return (
    <div style={{ background: "rgba(12,12,30,0.7)", border: `1px solid ${c}22`, borderRadius: 14, padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 9, letterSpacing: 3, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 8 }}>Connection Quality</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: c, fontFamily: "monospace", textShadow: `0 0 18px ${c}70` }}>{grade}</div>
      <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 8 }}>
        {[1, 2, 3, 4, 5].map(i => (<div key={i} style={{ width: 22, height: 5, borderRadius: 3, background: i <= bars ? c : "rgba(255,255,255,0.08)", boxShadow: i <= bars ? `0 0 8px ${c}50` : "none" }} />))}
      </div>
    </div>
  );
}

/* ─── History ─── */
function History({ data, onClear }: { data: Result[]; onClear: () => void }) {
  if (!data.length) return null;
  const mx = Math.max(...data.map(d => Math.max(d.dl, d.ul)), 10);
  return (
    <div style={{ background: "rgba(12,12,30,0.7)", border: "1px solid rgba(171,71,188,0.15)", borderRadius: 14, padding: 18, marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>📊 Test History ({data.length} saved)</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#00e5ff", marginRight: 4 }} />Download</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#ff4081", marginRight: 4 }} />Upload</span>
          <button onClick={onClear} style={{ fontSize: 8, letterSpacing: 2, color: "#ff525290", background: "rgba(255,82,82,0.08)", border: "1px solid rgba(255,82,82,0.2)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", textTransform: "uppercase", transition: "all 0.3s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,82,82,0.2)"; e.currentTarget.style.color = "#ff5252"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,82,82,0.08)"; e.currentTarget.style.color = "#ff525290"; }}>
            ✕ Clear
          </button>
        </div>
      </div>
      {/* Detail table */}
      <div style={{ overflowX: "auto", marginBottom: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "monospace" }}>
          <thead>
            <tr>
              {["#", "Time", "Download", "Upload", "Ping", "Jitter"].map(h => (
                <th key={h} style={{ padding: "4px 6px", textAlign: "left", fontSize: 8, letterSpacing: 2, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "4px 6px", color: "rgba(255,255,255,0.2)" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px", color: "rgba(255,255,255,0.4)" }}>{r.time}</td>
                <td style={{ padding: "4px 6px", color: "#00e5ff" }}>{r.dl.toFixed(2)} <span style={{ fontSize: 8, color: "#00e5ff60" }}>Mbps</span></td>
                <td style={{ padding: "4px 6px", color: "#ff4081" }}>{r.ul.toFixed(2)} <span style={{ fontSize: 8, color: "#ff408160" }}>Mbps</span></td>
                <td style={{ padding: "4px 6px", color: "#00e676" }}>{r.ping.toFixed(1)} <span style={{ fontSize: 8, color: "#00e67660" }}>ms</span></td>
                <td style={{ padding: "4px 6px", color: "#ab47bc" }}>{r.jitter.toFixed(1)} <span style={{ fontSize: 8, color: "#ab47bc60" }}>ms</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Chart */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
        {data.map((r, i) => (
          <div key={i} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 2 }}>
            <div title={`${r.dl.toFixed(1)} Mbps`} style={{ flex: 1, borderRadius: "3px 3px 0 0", minHeight: 4, height: `${(r.dl / mx) * 100}%`, background: "linear-gradient(to top, #00e5ff40, #00e5ff)", boxShadow: "0 0 6px #00e5ff40", transition: "height 0.5s ease" }} />
            <div title={`${r.ul.toFixed(1)} Mbps`} style={{ flex: 1, borderRadius: "3px 3px 0 0", minHeight: 4, height: `${(r.ul / mx) * 100}%`, background: "linear-gradient(to top, #ff408140, #ff4081)", boxShadow: "0 0 6px #ff408140", transition: "height 0.5s ease" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {data.map((r, i) => (<div key={i} style={{ flex: 1, textAlign: "center", fontSize: 8, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{r.time}</div>))}
      </div>
    </div>
  );
}

/* ─── Ping Radar ─── */
function PingRadar({ currentPing, pings }: { currentPing: number; pings: number[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0" }}>
      <div style={{ position: "relative", width: 200, height: 200 }}>
        {[1, 2, 3].map(i => (<div key={i} style={{ position: "absolute", borderRadius: "50%", border: "1px solid rgba(0,229,255,0.15)", inset: `${(3 - i) * 22}px`, animation: `pulse-glow ${1.5 + i * 0.2}s ease-in-out infinite ${i * 0.3}s` }} />))}
        <div style={{ position: "absolute", inset: 0, animation: "spin-slow 2s linear infinite" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", width: "50%", height: 2, background: "linear-gradient(90deg, #00e5ff, transparent)", transformOrigin: "left center" }} />
        </div>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: "#00e5ff", fontFamily: "monospace", textShadow: "0 0 20px #00e5ff90" }}>{currentPing.toFixed(0)}</div>
          <div style={{ fontSize: 10, letterSpacing: 5, color: "#00e5ff70" }}>MS</div>
        </div>
      </div>
      {/* Mini ping dots */}
      <div style={{ display: "flex", gap: 3, marginTop: 12, alignItems: "flex-end", height: 30 }}>
        {pings.map((p, i) => (
          <div key={i} style={{ width: 4, borderRadius: 2, background: p < 30 ? "#00e676" : p < 80 ? "#00e5ff" : "#ff9100", height: Math.max(4, Math.min(30, p / 3)), transition: "height 0.3s", boxShadow: `0 0 4px ${p < 30 ? "#00e67640" : p < 80 ? "#00e5ff40" : "#ff910040"}` }} />
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, letterSpacing: 4, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", fontFamily: "monospace" }}>Measuring Latency ({pings.length}/10)</div>
    </div>
  );
}

/* ─── Init Loader ─── */
function InitLoader({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "30px 0" }}>
      <div style={{ position: "relative", width: 140, height: 140 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ position: "absolute", inset: 0, animation: `${i % 2 === 0 ? "spin-slow" : "spin-reverse"} ${8 - i * 2}s linear infinite` }}>
            <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>
              <polygon points="50,5 93,27 93,73 50,95 7,73 7,27" fill="none" stroke={`rgba(0,229,255,${0.12 + i * 0.08})`} strokeWidth="0.7" strokeDasharray={`${10 + i * 5} ${6 + i * 3}`} />
            </svg>
          </div>
        ))}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid rgba(0,229,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 30px rgba(0,229,255,0.15)", animation: "pulse-glow 1.5s ease-in-out infinite" }}>
            <span style={{ fontSize: 22, animation: "spin-slow 3s linear infinite" }}>🌐</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16, fontSize: 10, letterSpacing: 3, color: "#00e5ff60", textTransform: "uppercase", fontFamily: "monospace", animation: "pulse-glow 2s ease-in-out infinite", textAlign: "center", maxWidth: 260 }}>{label}</div>
    </div>
  );
}

/* ═══════════════════ MAIN APP ═══════════════════ */
export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [curSpeed, setCurSpeed] = useState(0);
  const [dlProgress, setDlProgress] = useState(0);
  const [ulProgress, setUlProgress] = useState(0);
  const [dl, setDl] = useState(0);
  const [ul, setUl] = useState(0);
  const [pingVal, setPingVal] = useState(0);
  const [jitterVal, setJitterVal] = useState(0);
  const [pingList, setPingList] = useState<number[]>([]);
  const [history, setHistory] = useState<Result[]>(() => {
    try {
      const saved = localStorage.getItem("unknown_speedtest_history");
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [];
  });
  const [netInfo, setNetInfo] = useState<NetInfo | null>(null);
  const [deviceNet, setDeviceNet] = useState<DeviceNet>(getDeviceNet());
  const [loadingInfo, setLoadingInfo] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const running = useRef(false);

  const isActive = phase !== "idle" && phase !== "done";

  // Save history to localStorage whenever it changes
  useEffect(() => {
    try { localStorage.setItem("unknown_speedtest_history", JSON.stringify(history)); } catch { /* ignore */ }
  }, [history]);

  // Fetch real network info on mount
  useEffect(() => {
    fetchNetInfo().then(info => { setNetInfo(info); setLoadingInfo(false); });
  }, []);

  // Listen for device network changes
  useEffect(() => {
    const update = () => setDeviceNet(getDeviceNet());
    const nav = navigator as any;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn) conn.addEventListener("change", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const interval = setInterval(update, 2000);
    return () => {
      if (conn) conn.removeEventListener("change", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(interval);
    };
  }, []);

  const startTest = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setDl(0); setUl(0); setPingVal(0); setJitterVal(0); setCurSpeed(0);
    setDlProgress(0); setUlProgress(0); setPingList([]);

    // 1. Init - fetch fresh network info
    setPhase("init");
    try {
      const info = await fetchNetInfo();
      setNetInfo(info);
    } catch { /* keep existing */ }
    setDeviceNet(getDeviceNet());
    if (!running.current) return;

    // 2. Ping test
    setPhase("ping");
    const pingResults: number[] = [];
    const pingUrl = "https://speed.cloudflare.com/__down?bytes=0";
    for (let i = 0; i < 10; i++) {
      if (!running.current) return;
      try {
        const t0 = performance.now();
        await fetch(pingUrl + "&_=" + Date.now() + Math.random(), { cache: "no-store", mode: "cors", signal });
        const t1 = performance.now();
        const p = t1 - t0;
        pingResults.push(p);
        setPingList([...pingResults]);
        // Running average
        const sorted = [...pingResults].sort((a, b) => a - b);
        const trimmed = sorted.length > 3 ? sorted.slice(1, -1) : sorted;
        const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
        setPingVal(avg);
        let j = 0;
        for (let k = 1; k < trimmed.length; k++) j += Math.abs(trimmed[k] - trimmed[k - 1]);
        setJitterVal(trimmed.length > 1 ? j / (trimmed.length - 1) : 0);
      } catch { /* skip */ }
      await new Promise(r => setTimeout(r, 150));
    }
    if (!running.current) return;

    // 3. Download test
    setPhase("download");
    const dlResult = await measureDownload((speed, prog) => {
      setCurSpeed(speed); setDl(speed); setDlProgress(prog);
    }, signal);
    setDl(dlResult); setCurSpeed(0);
    if (!running.current) return;

    // 4. Upload test
    setPhase("upload");
    const ulResult = await measureUpload((speed, prog) => {
      setCurSpeed(speed); setUl(speed); setUlProgress(prog);
    }, signal);
    setUl(ulResult); setCurSpeed(0);
    if (!running.current) return;

    // Done
    setPhase("done");
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    setHistory(h => [...h.slice(-9), { dl: dlResult, ul: ulResult, ping: pingVal, jitter: jitterVal, time: ts }]);
    running.current = false;
  }, []);

  const cancel = useCallback(() => {
    running.current = false;
    abortRef.current?.abort();
    setPhase("idle"); setCurSpeed(0);
  }, []);

  // Scanline
  const [scanY, setScanY] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    let id = 0;
    const go = () => { setScanY(p => (p + 1.5) % (window.innerHeight + 4)); id = requestAnimationFrame(go); };
    id = requestAnimationFrame(go);
    return () => cancelAnimationFrame(id);
  }, [isActive]);

  const progressText = phase === "download" ? `Downloading... ${Math.round(dlProgress * 100)}%` : phase === "upload" ? `Uploading... ${Math.round(ulProgress * 100)}%` : phase === "ping" ? `Pinging... ${pingList.length}/10` : phase === "init" ? "Detecting Network..." : phase === "done" ? "✦ Test Complete" : "⟐ Ready to Test";

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden", background: "#06060f" }}>
      <ParticleBG />
      {isActive && <div style={{ position: "fixed", left: 0, right: 0, top: scanY, height: 2, zIndex: 10, background: "linear-gradient(90deg, transparent, rgba(0,229,255,0.25), transparent)", pointerEvents: "none" }} />}

      {/* ─── Header ─── */}
      <header style={{ position: "relative", zIndex: 20, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/Logo.png" alt="Logo" style={{ width: 42, height: 42, borderRadius: 10, border: "1px solid rgba(0,229,255,0.25)", boxShadow: "0 0 18px rgba(0,229,255,0.15)", objectFit: "cover" }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", letterSpacing: 2 }}><span style={{ color: "#00e5ff", textShadow: "0 0 12px #00e5ff80" }}>UNKNOWN</span> <span style={{ color: "#ff4081", textShadow: "0 0 12px #ff408180" }}>SPEED TEST</span></div>
            <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(255,255,255,0.2)", textTransform: "uppercase" }}>Real-Time Network Analysis</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(12,12,30,0.6)", borderRadius: 20, padding: "5px 12px", border: "1px solid rgba(0,229,255,0.1)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: deviceNet.online ? "#00e676" : "#ff5252", boxShadow: `0 0 8px ${deviceNet.online ? "#00e676" : "#ff5252"}`, animation: "pulse-glow 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>{deviceNet.online ? "Online" : "Offline"}</span>
          {deviceNet.effectiveType !== "unknown" && <span style={{ fontSize: 9, letterSpacing: 1, color: "#00e5ff80", fontFamily: "monospace", marginLeft: 4 }}>{deviceNet.effectiveType.toUpperCase()}</span>}
        </div>
      </header>

      {/* ─── Main ─── */}
      <main style={{ position: "relative", zIndex: 20, padding: "0 12px 30px", maxWidth: 1200, margin: "0 auto" }}>
        <PhaseSteps phase={phase} />

        {/* Status */}
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontFamily: "monospace", letterSpacing: 3, color: "rgba(255,255,255,0.45)", textShadow: isActive ? "0 0 8px #00e5ff40" : "none" }}>{progressText}</div>
          {(phase === "download" || phase === "upload") && (
            <div style={{ width: 200, height: 3, margin: "8px auto 0", borderRadius: 2, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 2, width: `${(phase === "download" ? dlProgress : ulProgress) * 100}%`, background: phase === "upload" ? "linear-gradient(90deg, #ff4081, #ab47bc)" : "linear-gradient(90deg, #00e5ff, #ab47bc)", boxShadow: "0 0 8px #00e5ff60", transition: "width 0.3s" }} />
            </div>
          )}
        </div>

        {/* ─── 3-col Grid ─── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>

          {/* LEFT: Real network info */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Connection info panel */}
            <div style={{ background: "rgba(12,12,30,0.7)", border: "1px solid rgba(0,229,255,0.12)", borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 16 }}>🌐</span>
                <span style={{ fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", fontWeight: 600 }}>Your Connection</span>
                {loadingInfo && <span style={{ fontSize: 9, color: "#00e5ff60", animation: "blink 1s infinite" }}>detecting...</span>}
              </div>
              <InfoRow label="IP ADDRESS" value={netInfo?.ip || "detecting..."} color="#00e5ff" />
              <InfoRow label="ISP" value={netInfo?.isp || "detecting..."} color="#ff4081" />
              <InfoRow label="LOCATION" value={netInfo ? `${netInfo.city}, ${netInfo.country}` : "detecting..."} color="#00e676" />
              <InfoRow label="REGION" value={netInfo?.region || "detecting..."} color="#ab47bc" />
              <InfoRow label="TIMEZONE" value={netInfo?.timezone || "detecting..."} color="#00e5ff" />
              <InfoRow label="ORG" value={netInfo?.org || "detecting..."} color="#ff9100" />
            </div>

            {/* Device network panel */}
            <div style={{ background: "rgba(12,12,30,0.7)", border: "1px solid rgba(0,229,255,0.12)", borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 16 }}>📡</span>
                <span style={{ fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", fontWeight: 600 }}>Device Network</span>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: deviceNet.online ? "#00e676" : "#ff5252", marginLeft: "auto", animation: "pulse-glow 2s ease-in-out infinite" }} />
              </div>
              <InfoRow label="STATUS" value={deviceNet.online ? "ONLINE ✓" : "OFFLINE ✗"} color={deviceNet.online ? "#00e676" : "#ff5252"} />
              <InfoRow label="TYPE" value={deviceNet.type !== "unknown" ? deviceNet.type.toUpperCase() : "N/A"} color="#00e5ff" />
              <InfoRow label="EFFECTIVE TYPE" value={deviceNet.effectiveType !== "unknown" ? deviceNet.effectiveType.toUpperCase() : "N/A"} color="#ab47bc" />
              <InfoRow label="EST. DOWNLINK" value={deviceNet.downlink >= 0 ? `${deviceNet.downlink} Mbps` : "N/A"} color="#00e5ff" />
              <InfoRow label="EST. RTT" value={deviceNet.rtt >= 0 ? `${deviceNet.rtt} ms` : "N/A"} color="#ff4081" />
              <InfoRow label="DATA SAVER" value={deviceNet.saveData ? "ON" : "OFF"} color={deviceNet.saveData ? "#ff9100" : "#00e676"} />
              <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(0,229,255,0.04)", borderRadius: 6, fontSize: 8, color: "rgba(255,255,255,0.25)", lineHeight: 1.5 }}>
                ℹ️ Device network details use the Navigator API. Some values may show N/A on Firefox/Safari.
              </div>
            </div>
          </div>

          {/* CENTER: Gauge + Wave + Button */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            {phase === "init" ? (
              <InitLoader label="Detecting your network & server..." />
            ) : phase === "ping" ? (
              <PingRadar currentPing={pingVal} pings={pingList} />
            ) : (
              <Gauge
                value={phase === "download" || phase === "upload" ? curSpeed : 0}
                max={phase === "upload" ? Math.max(100, ul * 2 || 100) : Math.max(100, dl * 2 || 500)}
                color={phase === "upload" ? "#ff4081" : phase === "done" ? "#00e676" : "#00e5ff"}
                label={phase === "download" ? "DOWNLOAD" : phase === "upload" ? "UPLOAD" : phase === "done" ? "COMPLETE" : "READY"}
                active={isActive}
              />
            )}

            {/* Wave */}
            <div style={{ width: "100%", background: "rgba(12,12,30,0.7)", border: "1px solid rgba(0,229,255,0.1)", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? "#00e5ff" : "#555", animation: isActive ? "pulse-glow 1s ease-in-out infinite" : "none" }} />
                <span style={{ fontSize: 8, letterSpacing: 3, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>Live Throughput</span>
              </div>
              <Wave active={phase === "download" || phase === "upload"} speed={curSpeed} color={phase === "upload" ? "#ff4081" : "#00e5ff"} />
            </div>

            {/* Server info */}
            <div style={{ width: "100%", background: "rgba(12,12,30,0.5)", border: "1px solid rgba(0,229,255,0.08)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12 }}>🏢</span>
              <span style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>Test Server:</span>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "#00e5ff90" }}>Cloudflare Edge (Nearest Node)</span>
            </div>

            {/* Button */}
            <div style={{ marginTop: 2 }}>
              {phase === "idle" || phase === "done" ? (
                <button onClick={() => { if (phase === "done") { setPhase("idle"); setCurSpeed(0); } setTimeout(startTest, 50); }}
                  style={{ position: "relative", padding: "14px 40px", borderRadius: 12, border: "1px solid rgba(0,229,255,0.3)", background: "linear-gradient(135deg, rgba(0,229,255,0.12), rgba(171,71,188,0.12), rgba(255,64,129,0.12))", color: "#00e5ff", fontSize: 14, fontWeight: 700, fontFamily: "monospace", letterSpacing: 4, textTransform: "uppercase", cursor: "pointer", textShadow: "0 0 12px #00e5ff80", boxShadow: "0 0 25px rgba(0,229,255,0.1)", transition: "all 0.3s", overflow: "hidden" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,229,255,0.6)"; e.currentTarget.style.boxShadow = "0 0 40px rgba(0,229,255,0.25)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(0,229,255,0.3)"; e.currentTarget.style.boxShadow = "0 0 25px rgba(0,229,255,0.1)"; }}>
                  {phase === "done" ? "⟳ TEST AGAIN" : "▶ START TEST"}
                </button>
              ) : (
                <button onClick={cancel}
                  style={{ padding: "12px 30px", borderRadius: 12, border: "1px solid rgba(255,82,82,0.3)", background: "rgba(255,82,82,0.08)", color: "#ff5252", fontSize: 12, fontWeight: 700, fontFamily: "monospace", letterSpacing: 3, cursor: "pointer", textTransform: "uppercase", transition: "all 0.3s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,82,82,0.6)"; e.currentTarget.style.background = "rgba(255,82,82,0.15)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,82,82,0.3)"; e.currentTarget.style.background = "rgba(255,82,82,0.08)"; }}>
                  ■ CANCEL
                </button>
              )}
            </div>
          </div>

          {/* RIGHT: Stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Stat label="Download" value={dl > 0 ? dl.toFixed(2) : "—"} unit="Mbps" color="#00e5ff" icon="⬇" />
            <Stat label="Upload" value={ul > 0 ? ul.toFixed(2) : "—"} unit="Mbps" color="#ff4081" icon="⬆" />
            <Stat label="Ping" value={pingVal > 0 ? pingVal.toFixed(1) : "—"} unit="ms" color="#00e676" icon="⚡" />
            <Stat label="Jitter" value={jitterVal > 0 ? jitterVal.toFixed(1) : "—"} unit="ms" color="#ab47bc" icon="〰" />
            {phase === "done" && <QualityBadge dl={dl} />}

            {/* Realtime device info card */}
            <div style={{ background: "rgba(12,12,30,0.7)", border: "1px solid rgba(0,229,255,0.12)", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 8 }}>📶 Live Network Status</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <MiniTag label="Online" value={deviceNet.online ? "Yes" : "No"} color={deviceNet.online ? "#00e676" : "#ff5252"} />
                <MiniTag label="Type" value={deviceNet.type !== "unknown" ? deviceNet.type : "—"} color="#00e5ff" />
                <MiniTag label="Eff." value={deviceNet.effectiveType !== "unknown" ? deviceNet.effectiveType : "—"} color="#ab47bc" />
                {deviceNet.downlink >= 0 && <MiniTag label="DL" value={`${deviceNet.downlink}M`} color="#00e5ff" />}
                {deviceNet.rtt >= 0 && <MiniTag label="RTT" value={`${deviceNet.rtt}ms`} color="#ff4081" />}
              </div>
            </div>
          </div>
        </div>

        {/* History */}
        <History data={history} onClear={() => setHistory([])} />

        {/* Footer */}
        <div style={{ marginTop: 18, background: "rgba(12,12,30,0.5)", border: "1px solid rgba(0,229,255,0.08)", borderRadius: 12, padding: "10px 14px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00e676", boxShadow: "0 0 6px #00e676" }} />
              <span style={{ fontSize: 8, letterSpacing: 2, color: "rgba(255,255,255,0.18)", textTransform: "uppercase" }}>Real Measurements</span>
            </div>
            <div style={{ width: 1, height: 10, background: "rgba(255,255,255,0.06)" }} />
            <span style={{ fontSize: 8, letterSpacing: 2, color: "rgba(255,255,255,0.15)" }}>Cloudflare Edge Network</span>
          </div>
          <span style={{ fontSize: 8, letterSpacing: 2, fontFamily: "monospace", color: "#00e5ff25" }}>UNKNOWN SPEED TEST™ // Real-Time Analysis</span>
        </div>
      </main>
    </div>
  );
}

/* ─── Mini tag ─── */
function MiniTag({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, background: color + "10", border: `1px solid ${color}20`, borderRadius: 6, padding: "3px 8px" }}>
      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{label}</span>
      <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "monospace", color }}>{value}</span>
    </div>
  );
}
