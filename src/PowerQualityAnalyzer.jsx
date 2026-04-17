import { useState, useEffect, useMemo, useCallback } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";

// ══════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0e1117", panel: "#151920", card: "#1a1f28", border: "#242b36", borderLight: "#2e3744",
  green: "#34d399", greenDim: "#34d39933", greenBg: "#34d39912",
  gold: "#f0b429", goldDim: "#f0b42933", goldBg: "#f0b42912",
  red: "#f87171", redDim: "#f8717133", redBg: "#f8717112",
  blue: "#60a5fa", blueDim: "#60a5fa33", blueBg: "#60a5fa12",
  cyan: "#22d3ee", cyanDim: "#22d3ee33", cyanBg: "#22d3ee12",
  purple: "#a78bfa", purpleDim: "#a78bfa33", purpleBg: "#a78bfa12",
  orange: "#fb923c", orangeDim: "#fb923c33", orangeBg: "#fb923c12",
  text: "#e2e8f0", textSoft: "#94a3b8", textDim: "#64748b", textMuted: "#475569", textFaint: "#334155",
};
const mono = "'JetBrains Mono', 'Fira Code', monospace";
const heading = "'Syne', sans-serif";
const body = "'Outfit', sans-serif";

// ══════════════════════════════════════════════════════════════════════
//  SIGNAL PARAMETERS
// ══════════════════════════════════════════════════════════════════════
const F0 = 50;            // fundamental frequency (Hz) — European grid
const FS = 6400;          // sample rate (128 samples per cycle)
const N = 2048;           // FFT size — covers 16 cycles at 50 Hz, gives 3.125 Hz resolution
const TICK_MS = 220;
const V_NOM = 400;        // line-to-line nominal (V RMS)
const V_PHASE = V_NOM / Math.sqrt(3); // 230.9 V phase-to-neutral RMS
const V_PEAK = V_PHASE * Math.sqrt(2);
const I_NOM = 80;         // nominal load current (A RMS)
const MAX_H = 25;         // show up to 25th harmonic

// ══════════════════════════════════════════════════════════════════════
//  PRESETS — real-world waveforms parameterized by harmonic % of fundamental
// ══════════════════════════════════════════════════════════════════════
// harmonics: object mapping h → { mag (% of fundamental), phase (deg) }
// For current: same format. Sag/swell/unbalance applied separately.
const PRESETS = {
  clean: {
    label: "Clean Grid",
    subtitle: "Utility-grade baseline",
    description: "Pristine sinusoid, barely any distortion. What textbooks show you.",
    vHarm: { 3: 0.3, 5: 0.5, 7: 0.3 },
    iHarm: { 3: 0.2, 5: 0.4, 7: 0.2 },
    loadPF: 0.98, imbalance: 0.01, sagDepth: 0,
  },
  vfd_6pulse: {
    label: "6-Pulse VFD",
    subtitle: "ABB ACS880 / uncompensated drive",
    description: "Classic diode-bridge rectifier harmonics. Strong 5th and 7th, this is what my ACS880 installs looked like before filters.",
    vHarm: { 5: 3.0, 7: 1.8, 11: 1.2, 13: 0.9, 17: 0.6, 19: 0.5 },
    iHarm: { 5: 20, 7: 14, 11: 9, 13: 7.7, 17: 5.9, 19: 5.3, 23: 4.3, 25: 4.0 },
    loadPF: 0.85, imbalance: 0.02, sagDepth: 0,
  },
  vfd_12pulse: {
    label: "12-Pulse VFD",
    subtitle: "Phase-shifting transformer",
    description: "12-pulse rectifier with phase-shifting transformer. 5th and 7th are canceled, so the dominant harmonics are 11th and 13th.",
    vHarm: { 5: 0.4, 7: 0.3, 11: 1.2, 13: 0.9, 17: 0.2, 19: 0.15 },
    iHarm: { 5: 2.0, 7: 1.5, 11: 9, 13: 7.7, 17: 0.8, 19: 0.7, 23: 4.3, 25: 4.0 },
    loadPF: 0.95, imbalance: 0.02, sagDepth: 0,
  },
  arc_furnace: {
    label: "Arc Furnace",
    subtitle: "Steel mill arc load",
    description: "Arc furnace load. Broadband distortion, random fluctuations (flicker), and significant 3rd. The hot rolling neighbors I worked next to.",
    vHarm: { 2: 1.5, 3: 3.0, 4: 1.2, 5: 3.5, 6: 0.8, 7: 2.5, 9: 1.0, 11: 1.5 },
    iHarm: { 2: 4, 3: 10, 4: 3, 5: 9, 6: 2, 7: 6, 9: 3, 11: 4 },
    loadPF: 0.72, imbalance: 0.05, sagDepth: 0.08, flicker: true,
  },
  office: {
    label: "Office Building",
    subtitle: "Computers, LED lights, SMPS",
    description: "Switched-mode power supplies everywhere. Dominated by triplen harmonics (3rd, 9th, 15th). These stack up in the neutral conductor.",
    vHarm: { 3: 2.0, 5: 1.2, 7: 0.8, 9: 0.7, 11: 0.3 },
    iHarm: { 3: 75, 5: 55, 7: 35, 9: 15, 11: 10, 13: 6, 15: 4 },
    loadPF: 0.88, imbalance: 0.03, sagDepth: 0,
  },
  induction_motor: {
    label: "Induction Motor",
    subtitle: "Direct-on-line running",
    description: "Plain induction motor across the line. Nearly sinusoidal current, small saturation harmonics. Lagging PF is the main story.",
    vHarm: { 3: 0.4, 5: 0.6, 7: 0.4 },
    iHarm: { 3: 1.5, 5: 2.5, 7: 1.2 },
    loadPF: 0.80, imbalance: 0.01, sagDepth: 0,
  },
  custom: {
    label: "Custom Load",
    subtitle: "Editable harmonics",
    description: "Dial in your own 3rd, 5th, 7th, 11th, 13th content and watch THD and power factor respond.",
    vHarm: { 5: 2.0, 7: 1.2 },
    iHarm: { 3: 5, 5: 15, 7: 10, 11: 7, 13: 5 },
    loadPF: 0.90, imbalance: 0.02, sagDepth: 0,
  },
};

// IEEE 519-2014 current distortion limits (TDD %) vs Isc/IL ratio
// For voltage < 69 kV (which covers industrial MV busses most of us work with)
const IEEE519_ROWS = [
  { ratio: "< 20",    tdd: 5.0,  h11: 4.0, h17: 2.0, h23: 1.5, h35: 0.6 },
  { ratio: "20–50",   tdd: 8.0,  h11: 7.0, h17: 3.5, h23: 2.5, h35: 1.0 },
  { ratio: "50–100",  tdd: 12.0, h11: 10.0, h17: 4.5, h23: 4.0, h35: 1.5 },
  { ratio: "100–1000",tdd: 15.0, h11: 12.0, h17: 5.5, h23: 5.0, h35: 2.0 },
  { ratio: "> 1000",  tdd: 20.0, h11: 15.0, h17: 7.0, h23: 6.0, h35: 2.5 },
];

// ══════════════════════════════════════════════════════════════════════
//  FFT — radix-2 Cooley-Tukey, in-place
// ══════════════════════════════════════════════════════════════════════
function fft(re, im) {
  const n = re.length;
  // bit-reverse
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  // butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wlre = Math.cos(ang), wlim = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wre = 1, wim = 0;
      for (let k = 0; k < len / 2; k++) {
        const ure = re[i + k], uim = im[i + k];
        const vre = re[i + k + len / 2] * wre - im[i + k + len / 2] * wim;
        const vim = re[i + k + len / 2] * wim + im[i + k + len / 2] * wre;
        re[i + k] = ure + vre; im[i + k] = uim + vim;
        re[i + k + len / 2] = ure - vre; im[i + k + len / 2] = uim - vim;
        const nwre = wre * wlre - wim * wlim;
        wim = wre * wlim + wim * wlre; wre = nwre;
      }
    }
  }
}

function applyHann(x) {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  return out;
}

// ══════════════════════════════════════════════════════════════════════
//  SIGNAL SYNTHESIS
// ══════════════════════════════════════════════════════════════════════
// Build one phase of a distorted signal.
// t0: time offset (sec), phaseOffset: rad (0, -2pi/3, 2pi/3 for a/b/c)
// amp: peak amplitude of fundamental. harm: { h: %ofFundamental } (optional phases ignored here for simplicity)
// extras: { sagDepth, sagCycleFrac, imbalance, flicker, noise }
function synthesizePhase(t0, phaseOffset, amp, harm, extras) {
  const x = new Float64Array(N);
  const { sagDepth = 0, flicker = false, noise = 0 } = extras;
  for (let k = 0; k < N; k++) {
    const t = t0 + k / FS;
    const theta = 2 * Math.PI * F0 * t + phaseOffset;
    // fundamental + harmonics
    let s = Math.sin(theta);
    for (const h in harm) {
      const pct = harm[h] / 100;
      if (pct === 0) continue;
      s += pct * Math.sin(parseInt(h) * theta);
    }
    // sag: 20% of the window dips to (1 - sagDepth)
    let env = 1;
    if (sagDepth > 0) {
      const cyc = ((t * F0) % 16) / 16; // which part of 16-cycle window
      if (cyc > 0.35 && cyc < 0.55) env = 1 - sagDepth;
    }
    // flicker: slow 5-10 Hz amplitude modulation
    if (flicker) env *= 1 + 0.04 * Math.sin(2 * Math.PI * 7 * t);
    // additive white noise
    const nz = noise > 0 ? noise * (Math.random() * 2 - 1) : 0;
    x[k] = amp * env * s + nz * amp;
  }
  return x;
}

// Build 3-phase voltage + current as Float64Arrays
function synthesize(t0, preset, customHarm) {
  const harm = preset === PRESETS.custom && customHarm ? customHarm : preset;
  const vHarmActive = preset === PRESETS.custom && customHarm ? customHarm.vHarm : preset.vHarm;
  const iHarmActive = preset === PRESETS.custom && customHarm ? customHarm.iHarm : preset.iHarm;

  const imb = preset.imbalance || 0;
  const ampA = V_PEAK * (1 + imb);
  const ampB = V_PEAK * (1 - imb * 0.5);
  const ampC = V_PEAK * (1 - imb * 0.5);

  const iPeak = I_NOM * Math.sqrt(2);
  const phiLoad = Math.acos(preset.loadPF);   // current lags voltage

  const extrasV = { sagDepth: preset.sagDepth || 0, flicker: preset.flicker, noise: 0.003 };
  const extrasI = { sagDepth: 0, flicker: preset.flicker, noise: 0.01 };

  const vA = synthesizePhase(t0, 0, ampA, vHarmActive, extrasV);
  const vB = synthesizePhase(t0, -2 * Math.PI / 3, ampB, vHarmActive, extrasV);
  const vC = synthesizePhase(t0,  2 * Math.PI / 3, ampC, vHarmActive, extrasV);

  // current phase-shifted by phiLoad (lagging)
  const iA = synthesizePhaseWithShift(t0, 0 - phiLoad, iPeak, iHarmActive, extrasI);
  const iB = synthesizePhaseWithShift(t0, -2 * Math.PI / 3 - phiLoad, iPeak, iHarmActive, extrasI);
  const iC = synthesizePhaseWithShift(t0,  2 * Math.PI / 3 - phiLoad, iPeak, iHarmActive, extrasI);

  return { vA, vB, vC, iA, iB, iC };
}

function synthesizePhaseWithShift(t0, phaseOffset, amp, harm, extras) {
  return synthesizePhase(t0, phaseOffset, amp, harm, extras);
}

// ══════════════════════════════════════════════════════════════════════
//  ANALYSIS
// ══════════════════════════════════════════════════════════════════════
function harmonicSpectrum(signal) {
  // Returns array of { h, mag (normalized to fundamental), magAbs (engineering unit), pct }
  const windowed = applyHann(signal);
  const re = Array.from(windowed);
  const im = new Array(N).fill(0);
  fft(re, im);
  // Bin width = FS / N = 3.125 Hz. Fundamental bin = F0 / binWidth = 16.
  const binWidth = FS / N;
  // correction factor for Hann window amplitude (~0.5)
  const hannGain = 0.5;
  const mag = (h) => {
    const bin = Math.round(h * F0 / binWidth);
    if (bin <= 0 || bin >= N / 2) return 0;
    // use peak + neighbors for a small smooth
    const r = re[bin], i = im[bin];
    const m = Math.sqrt(r * r + i * i) / (N * hannGain) * 2;
    return m;
  };
  const fund = mag(1);
  const out = [];
  for (let h = 1; h <= MAX_H; h++) {
    const m = mag(h);
    out.push({ h, magAbs: m, pct: fund > 0 ? (m / fund) * 100 : 0 });
  }
  return { fund, harmonics: out };
}

function rms(signal) {
  let s = 0;
  for (let i = 0; i < signal.length; i++) s += signal[i] * signal[i];
  return Math.sqrt(s / signal.length);
}

function thd(harmonics) {
  // Traditional THD: sqrt(sum h>=2 mag^2) / mag_1
  const fund = harmonics[0].magAbs;
  if (fund === 0) return 0;
  let sum = 0;
  for (let i = 1; i < harmonics.length; i++) sum += harmonics[i].magAbs * harmonics[i].magAbs;
  return (Math.sqrt(sum) / fund) * 100;
}

function kFactor(harmonics) {
  // K-factor = sum_h (I_h / I_1)^2 * h^2
  const fund = harmonics[0].magAbs;
  if (fund === 0) return 1;
  let k = 0;
  for (let i = 0; i < harmonics.length; i++) {
    const h = harmonics[i].h;
    const rel = harmonics[i].magAbs / fund;
    k += rel * rel * h * h;
  }
  return k;
}

function crestFactor(signal) {
  const r = rms(signal);
  let peak = 0;
  for (let i = 0; i < signal.length; i++) { const a = Math.abs(signal[i]); if (a > peak) peak = a; }
  return r > 0 ? peak / r : 0;
}

function ieee519Verdict(thdI, iscIL) {
  // Pick row based on Isc/IL ratio
  let rowIdx = 0;
  if (iscIL < 20) rowIdx = 0;
  else if (iscIL < 50) rowIdx = 1;
  else if (iscIL < 100) rowIdx = 2;
  else if (iscIL < 1000) rowIdx = 3;
  else rowIdx = 4;
  const row = IEEE519_ROWS[rowIdx];
  const pass = thdI <= row.tdd;
  return { rowIdx, row, pass };
}

// Compute active power P = (1/N) sum v*i per phase, then sum phases.
function activePower(v, i) {
  let s = 0;
  for (let k = 0; k < v.length; k++) s += v[k] * i[k];
  return s / v.length;
}

// ══════════════════════════════════════════════════════════════════════
//  CHART COMPONENTS
// ══════════════════════════════════════════════════════════════════════
function TimeChart({ data, yLabel, colors, yMax, yMin }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 18, bottom: 22, left: 40 }}>
        <CartesianGrid stroke={C.borderLight} strokeDasharray="2 4" />
        <XAxis dataKey="ms" stroke={C.textDim} style={{ fontFamily: mono, fontSize: 10 }}
          label={{ value: "Time (ms)", position: "insideBottom", offset: -8, fill: C.textDim, style: { fontFamily: mono, fontSize: 10 } }} />
        <YAxis stroke={C.textDim} style={{ fontFamily: mono, fontSize: 10 }}
          domain={[yMin, yMax]}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fill: C.textDim, style: { fontFamily: mono, fontSize: 10 } }} />
        <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: mono, fontSize: 11 }}
          formatter={(v) => v.toFixed(1)} labelFormatter={(v) => `t = ${v.toFixed(2)} ms`} />
        <ReferenceLine y={0} stroke={C.textMuted} strokeDasharray="2 2" />
        <Line type="monotone" dataKey="a" stroke={colors[0]} dot={false} strokeWidth={1.6} isAnimationActive={false} name="A" />
        <Line type="monotone" dataKey="b" stroke={colors[1]} dot={false} strokeWidth={1.6} isAnimationActive={false} name="B" />
        <Line type="monotone" dataKey="c" stroke={colors[2]} dot={false} strokeWidth={1.6} isAnimationActive={false} name="C" />
      </LineChart>
    </ResponsiveContainer>
  );
}

function HarmonicBarChart({ data, color, limitPct }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 18, bottom: 22, left: 40 }}>
        <CartesianGrid stroke={C.borderLight} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="h" stroke={C.textDim} style={{ fontFamily: mono, fontSize: 10 }}
          label={{ value: "Harmonic order", position: "insideBottom", offset: -8, fill: C.textDim, style: { fontFamily: mono, fontSize: 10 } }} />
        <YAxis stroke={C.textDim} style={{ fontFamily: mono, fontSize: 10 }}
          label={{ value: "% of fundamental", angle: -90, position: "insideLeft", fill: C.textDim, style: { fontFamily: mono, fontSize: 10 } }} />
        <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: mono, fontSize: 11 }}
          formatter={(v) => `${v.toFixed(2)} %`} labelFormatter={(v) => `h = ${v}`} />
        {limitPct && <ReferenceLine y={limitPct} stroke={C.red} strokeDasharray="4 4" label={{ value: `IEEE limit ${limitPct}%`, fill: C.red, fontSize: 10, fontFamily: mono, position: "right" }} />}
        <Bar dataKey="pct" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.h === 1 ? C.cyan : color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  METRIC CARDS
// ══════════════════════════════════════════════════════════════════════
function MetricCard({ label, value, unit, tone = "text", sublabel }) {
  const toneColor = {
    text: C.text, gold: C.gold, green: C.green, red: C.red, blue: C.blue, cyan: C.cyan, purple: C.purple, orange: C.orange,
  }[tone] || C.text;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "12px 14px", minWidth: 120,
    }}>
      <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: heading, fontSize: 22, fontWeight: 700, color: toneColor, letterSpacing: "-0.02em", lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 12, color: C.textDim, marginLeft: 4, fontFamily: mono, fontWeight: 500 }}>{unit}</span>}
      </div>
      {sublabel && <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, marginTop: 3 }}>{sublabel}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function PowerQualityAnalyzer() {
  const [presetKey, setPresetKey] = useState("vfd_6pulse");
  const [customHarm, setCustomHarm] = useState({
    vHarm: { 3: 0.5, 5: 2.0, 7: 1.2 },
    iHarm: { 3: 5, 5: 15, 7: 10, 11: 7, 13: 5 },
    loadPF: 0.90, imbalance: 0.02, sagDepth: 0,
  });
  const [iscIL, setIscIL] = useState(50);  // Isc/IL ratio for IEEE 519
  const [tick, setTick] = useState(0);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const preset = useMemo(() => {
    if (presetKey === "custom") return { ...PRESETS.custom, ...customHarm };
    return PRESETS[presetKey];
  }, [presetKey, customHarm]);

  const sig = useMemo(() => synthesize(tick * TICK_MS / 1000, preset), [tick, preset]);

  const vSpec = useMemo(() => harmonicSpectrum(sig.vA), [sig]);
  const iSpec = useMemo(() => harmonicSpectrum(sig.iA), [sig]);

  const thdV = useMemo(() => thd(vSpec.harmonics), [vSpec]);
  const thdI = useMemo(() => thd(iSpec.harmonics), [iSpec]);
  const kFac = useMemo(() => kFactor(iSpec.harmonics), [iSpec]);
  const crestV = useMemo(() => crestFactor(sig.vA), [sig]);
  const crestI = useMemo(() => crestFactor(sig.iA), [sig]);

  const vRms = useMemo(() => rms(sig.vA), [sig]);
  const iRms = useMemo(() => rms(sig.iA), [sig]);

  // Power calculations (per phase, averaged)
  const P = useMemo(() => activePower(sig.vA, sig.iA) + activePower(sig.vB, sig.iB) + activePower(sig.vC, sig.iC), [sig]);
  const S = 3 * vRms * iRms;                           // apparent power (3-phase approx)
  const dispPF = preset.loadPF;                         // displacement PF (drives the current phase lag)
  const truePF = S > 0 ? P / S : 0;                     // true PF includes distortion
  const Q = Math.sqrt(Math.max(0, S * S * dispPF * dispPF - P * P));   // reactive (approx from displacement)
  const D = Math.sqrt(Math.max(0, S * S - P * P - Q * Q));             // distortion power

  const verdict = useMemo(() => ieee519Verdict(thdI, iscIL), [thdI, iscIL]);

  // time-domain data (downsample — show first ~40 ms = 2 cycles, ~256 samples)
  const displayPts = 256;
  const stride = Math.max(1, Math.floor(N / displayPts));
  const timeVoltage = useMemo(() => {
    const arr = [];
    for (let k = 0; k < N; k += stride) {
      arr.push({ ms: (k / FS) * 1000, a: sig.vA[k], b: sig.vB[k], c: sig.vC[k] });
    }
    return arr;
  }, [sig, stride]);
  const timeCurrent = useMemo(() => {
    const arr = [];
    for (let k = 0; k < N; k += stride) {
      arr.push({ ms: (k / FS) * 1000, a: sig.iA[k], b: sig.iB[k], c: sig.iC[k] });
    }
    return arr;
  }, [sig, stride]);

  // harmonic bar data (skip DC, show h=1..25)
  const vHarmBars = useMemo(() => vSpec.harmonics.filter(h => h.h >= 1 && h.h <= MAX_H && h.pct > 0.05).map(h => ({ h: h.h, pct: h.pct })), [vSpec]);
  const iHarmBars = useMemo(() => iSpec.harmonics.filter(h => h.h >= 1 && h.h <= MAX_H && h.pct > 0.05).map(h => ({ h: h.h, pct: h.pct })), [iSpec]);

  const updateCustomHarm = useCallback((kind, h, val) => {
    setCustomHarm(prev => ({ ...prev, [kind]: { ...prev[kind], [h]: val } }));
  }, []);

  const updateCustomScalar = useCallback((key, val) => {
    setCustomHarm(prev => ({ ...prev, [key]: val }));
  }, []);

  const isCustom = presetKey === "custom";

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", padding: "28px 32px 60px", fontFamily: body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
      `}</style>

      {/* ═══ HEADER ════════════════════════════════════════════ */}
      <div style={{ maxWidth: 1400, margin: "0 auto", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>
              ◆ Live Demo · Power Quality
            </div>
            <h1 style={{ fontFamily: heading, fontSize: 32, fontWeight: 800, color: C.text, letterSpacing: "-0.03em", margin: 0 }}>
              Harmonics & Power Quality Analyzer
            </h1>
            <p style={{ fontFamily: body, fontSize: 14, color: C.textSoft, maxWidth: 720, lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>
              Three-phase voltage and current with injectable harmonic distortion. Hand-rolled FFT, THD/K-factor/power computation, IEEE 519 compliance check.
            </p>
          </div>
          <button onClick={() => setShowInfo(true)} style={{
            background: C.goldBg, border: `1px solid ${C.goldDim}`, borderRadius: 8,
            padding: "8px 14px", fontFamily: mono, fontSize: 11, color: C.gold, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontSize: 14 }}>ⓘ</span> How does this work?
          </button>
        </div>
      </div>


      {/* ═══ PRESET BAR ════════════════════════════════════════ */}
      <div style={{ maxWidth: 1400, margin: "0 auto", marginBottom: 20 }}>
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: "16px 18px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center",
        }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Load Preset</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} onClick={() => setPresetKey(k)} style={{
                background: presetKey === k ? C.goldBg : C.panel,
                border: `1px solid ${presetKey === k ? C.goldDim : C.border}`,
                borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                fontFamily: mono, fontSize: 11,
                color: presetKey === k ? C.gold : C.textSoft,
                transition: "all 0.15s",
              }}>{p.label}</button>
            ))}
          </div>
        </div>
        <div style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.6, padding: "10px 6px 0", maxWidth: 900 }}>
          <span style={{ color: C.gold, fontFamily: mono, fontSize: 11, marginRight: 8 }}>{preset.subtitle}</span>
          {preset.description}
        </div>
      </div>

      {/* ═══ CUSTOM CONTROLS ═════════════════════════════════════ */}
      {isCustom && (
        <div style={{ maxWidth: 1400, margin: "0 auto", marginBottom: 20 }}>
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: "18px 20px",
          }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
              Tune Current Harmonics (% of fundamental)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
              {[3, 5, 7, 11, 13].map(h => (
                <div key={h}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 10, color: C.textDim, marginBottom: 4 }}>
                    <span>h = {h}</span>
                    <span style={{ color: C.cyan }}>{(customHarm.iHarm[h] || 0).toFixed(1)} %</span>
                  </div>
                  <input type="range" min="0" max="50" step="0.5"
                    value={customHarm.iHarm[h] || 0}
                    onChange={e => updateCustomHarm("iHarm", h, parseFloat(e.target.value))}
                    style={{ width: "100%", accentColor: C.gold }} />
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginTop: 14 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 10, color: C.textDim, marginBottom: 4 }}>
                  <span>Displacement PF</span>
                  <span style={{ color: C.cyan }}>{customHarm.loadPF.toFixed(2)}</span>
                </div>
                <input type="range" min="0.5" max="1.0" step="0.01"
                  value={customHarm.loadPF}
                  onChange={e => updateCustomScalar("loadPF", parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: C.gold }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: mono, fontSize: 10, color: C.textDim, marginBottom: 4 }}>
                  <span>Voltage Imbalance</span>
                  <span style={{ color: C.cyan }}>{(customHarm.imbalance * 100).toFixed(1)} %</span>
                </div>
                <input type="range" min="0" max="0.1" step="0.005"
                  value={customHarm.imbalance}
                  onChange={e => updateCustomScalar("imbalance", parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: C.gold }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ METRICS ROW ═════════════════════════════════════════ */}
      <div style={{ maxWidth: 1400, margin: "0 auto", marginBottom: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <MetricCard label="Vrms (phase)" value={vRms.toFixed(1)} unit="V" tone="cyan" />
        <MetricCard label="Irms" value={iRms.toFixed(1)} unit="A" tone="cyan" />
        <MetricCard label="THDv" value={thdV.toFixed(2)} unit="%" tone={thdV > 8 ? "red" : thdV > 5 ? "orange" : "green"} sublabel={thdV > 8 ? "Above IEEE 8%" : thdV > 5 ? "Watchlist" : "Healthy"} />
        <MetricCard label="THDi" value={thdI.toFixed(1)} unit="%" tone={thdI > verdict.row.tdd ? "red" : thdI > verdict.row.tdd * 0.7 ? "orange" : "green"} sublabel={verdict.pass ? "IEEE 519 PASS" : "IEEE 519 FAIL"} />
        <MetricCard label="Displacement PF" value={dispPF.toFixed(3)} tone="blue" />
        <MetricCard label="True PF" value={truePF.toFixed(3)} tone={truePF < 0.85 ? "orange" : "green"} />
        <MetricCard label="P (active)" value={(P / 1000).toFixed(1)} unit="kW" tone="green" />
        <MetricCard label="Q (reactive)" value={(Q / 1000).toFixed(1)} unit="kVAR" tone="purple" />
        <MetricCard label="S (apparent)" value={(S / 1000).toFixed(1)} unit="kVA" tone="gold" />
        <MetricCard label="D (distortion)" value={(D / 1000).toFixed(2)} unit="kVAR" tone="red" />
        <MetricCard label="K-factor" value={kFac.toFixed(2)} tone={kFac > 7 ? "red" : kFac > 4 ? "orange" : "green"} sublabel="Xfmr derating" />
        <MetricCard label="Crest (I)" value={crestI.toFixed(2)} tone="cyan" sublabel="1.414 = pure sine" />
      </div>

      {/* ═══ CHARTS ═════════════════════════════════════════════ */}
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 14px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 6px 10px" }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Time Domain</div>
              <div style={{ fontFamily: heading, fontSize: 14, color: C.text, fontWeight: 600, marginTop: 2 }}>3-Phase Voltage</div>
            </div>
            <div style={{ display: "flex", gap: 12, fontFamily: mono, fontSize: 10 }}>
              <span style={{ color: C.red }}>● A</span>
              <span style={{ color: C.green }}>● B</span>
              <span style={{ color: C.blue }}>● C</span>
            </div>
          </div>
          <TimeChart data={timeVoltage} yLabel="V" colors={[C.red, C.green, C.blue]} yMin={-V_PEAK * 1.4} yMax={V_PEAK * 1.4} />
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 14px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 6px 10px" }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Time Domain</div>
              <div style={{ fontFamily: heading, fontSize: 14, color: C.text, fontWeight: 600, marginTop: 2 }}>3-Phase Current</div>
            </div>
            <div style={{ display: "flex", gap: 12, fontFamily: mono, fontSize: 10 }}>
              <span style={{ color: C.red }}>● A</span>
              <span style={{ color: C.green }}>● B</span>
              <span style={{ color: C.blue }}>● C</span>
            </div>
          </div>
          <TimeChart data={timeCurrent} yLabel="A" colors={[C.red, C.green, C.blue]} yMin={-I_NOM * Math.sqrt(2) * 2} yMax={I_NOM * Math.sqrt(2) * 2} />
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 14px 14px" }}>
          <div style={{ padding: "0 6px 10px" }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Frequency Domain</div>
            <div style={{ fontFamily: heading, fontSize: 14, color: C.text, fontWeight: 600, marginTop: 2 }}>Voltage Harmonic Spectrum</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, marginTop: 4 }}>THDv = {thdV.toFixed(2)}%</div>
          </div>
          <HarmonicBarChart data={vHarmBars} color={C.gold} />
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 14px 14px" }}>
          <div style={{ padding: "0 6px 10px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Frequency Domain</div>
              <div style={{ fontFamily: heading, fontSize: 14, color: C.text, fontWeight: 600, marginTop: 2 }}>Current Harmonic Spectrum</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, marginTop: 4 }}>THDi = {thdI.toFixed(1)}% · limit @ Isc/IL={iscIL}: {verdict.row.tdd}%</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.textDim }}>Isc/IL</span>
              <input type="range" min="10" max="1500" step="10" value={iscIL} onChange={e => setIscIL(parseInt(e.target.value))} style={{ width: 80, accentColor: C.gold }} />
              <span style={{ fontFamily: mono, fontSize: 10, color: C.cyan, minWidth: 32, textAlign: "right" }}>{iscIL}</span>
            </div>
          </div>
          <HarmonicBarChart data={iHarmBars} color={verdict.pass ? C.green : C.red} limitPct={verdict.row.tdd} />
        </div>
      </div>

      {/* ═══ IEEE 519 VERDICT ════════════════════════════════════ */}
      <div style={{ maxWidth: 1400, margin: "24px auto 0" }}>
        <div style={{
          background: verdict.pass ? C.greenBg : C.redBg,
          border: `1px solid ${verdict.pass ? C.greenDim : C.redDim}`,
          borderRadius: 12, padding: "18px 22px",
          display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: verdict.pass ? C.greenBg : C.redBg,
            border: `2px solid ${verdict.pass ? C.green : C.red}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, color: verdict.pass ? C.green : C.red, fontWeight: 700,
          }}>{verdict.pass ? "✓" : "✗"}</div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontFamily: heading, fontSize: 16, fontWeight: 700, color: verdict.pass ? C.green : C.red, marginBottom: 4 }}>
              IEEE 519-2014 · Current Distortion {verdict.pass ? "PASS" : "FAIL"}
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: C.textSoft, lineHeight: 1.5 }}>
              Bucket: Isc/IL = {verdict.row.ratio} → TDD limit {verdict.row.tdd}% · measured THDi = {thdI.toFixed(1)}%
              {" · "}
              <span style={{ color: verdict.pass ? C.green : C.red }}>
                {verdict.pass
                  ? `${(verdict.row.tdd - thdI).toFixed(1)}% headroom`
                  : `${(thdI - verdict.row.tdd).toFixed(1)}% over limit — needs mitigation`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ INFO MODAL ══════════════════════════════════════════ */}
      {showInfo && (
        <div onClick={() => setShowInfo(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
            maxWidth: 680, padding: "28px 32px", maxHeight: "85vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ fontFamily: heading, fontSize: 22, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.02em" }}>How this works</h2>
              <button onClick={() => setShowInfo(false)} style={{
                background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6,
                padding: "4px 10px", cursor: "pointer", fontFamily: mono, fontSize: 11, color: C.textSoft,
              }}>close</button>
            </div>
            <div style={{ fontFamily: body, fontSize: 14, color: C.textSoft, lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 14px" }}>
                Pick a preset and I synthesize a real-looking 3-phase voltage + current waveform in the browser. Fundamental at 50 Hz, harmonics layered on top at the percentages you'd actually measure on that kind of load.
              </p>
              <p style={{ margin: "0 0 14px" }}>
                The FFT is a hand-rolled radix-2 Cooley-Tukey, no libraries. I apply a Hann window first to avoid spectral leakage, then pull magnitude at each harmonic bin (h × 50 Hz / bin width). Window gain is corrected so the numbers match what a real power analyzer would report.
              </p>
              <p style={{ margin: "0 0 14px" }}>
                <b style={{ color: C.gold, fontFamily: mono, fontSize: 12 }}>THD</b> — RMS of harmonics 2+ relative to the fundamental. The classic "how clean is this waveform" number.
              </p>
              <p style={{ margin: "0 0 14px" }}>
                <b style={{ color: C.gold, fontFamily: mono, fontSize: 12 }}>True PF vs Displacement PF</b> — Displacement is just cos(phi) between V and I fundamentals. True PF = P / S also accounts for the distortion power D. A 6-pulse VFD can have a displacement PF of 0.95 but a true PF of 0.75 because of all those 5th/7th harmonics chewing up apparent power.
              </p>
              <p style={{ margin: "0 0 14px" }}>
                <b style={{ color: C.gold, fontFamily: mono, fontSize: 12 }}>K-factor</b> — Weighting for transformer derating. Harmonics heat the transformer core and windings more than the fundamental, scaled by h². A K-factor of 4 means the transformer should be derated roughly 20%.
              </p>
              <p style={{ margin: "0 0 14px" }}>
                <b style={{ color: C.gold, fontFamily: mono, fontSize: 12 }}>IEEE 519-2014</b> — The standard for harmonic limits at the point of common coupling. The limit depends on how "stiff" the grid is (Isc/IL ratio). Stiffer grids tolerate more distortion because they absorb it better. Slide the Isc/IL knob and watch the PASS/FAIL flip.
              </p>
              <p style={{ margin: "0 0 0" }}>
                Where I saw this in real life: every ABB ACS880 I commissioned at ArcelorMittal was a 6-pulse-ish rectifier pulling distorted current. The mill's medium-voltage bus was stiff enough to absorb it, but we still had to check IEEE 519 compliance. Arc furnaces across the fence were a whole different beast.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
