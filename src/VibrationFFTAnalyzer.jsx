import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

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
const FS = 8192;          // sample rate (Hz)
const N = 4096;           // FFT size (samples), gives ~2 Hz resolution, Nyquist 4096 Hz
const TICK_MS = 180;      // ui refresh interval
const RESONANCE_HZ = 2800;  // bearing/housing resonance excited by impulses
const DECAY_TAU = 0.004;    // 4 ms exponential decay of impulse response
const ENV_BAND_LOW = 1800;  // envelope demodulation band (Hz)
const ENV_BAND_HIGH = 3800;

// ══════════════════════════════════════════════════════════════════════
//  PRESETS
// ══════════════════════════════════════════════════════════════════════
const PRESETS = {
  acs480_conveyor: {
    label: "Conveyor Drive",
    subtitle: "ABB ACS480 · 45 kW",
    rpm: 1450,
    bearing: {
      model: "SKF 6308 (DE)",
      nBalls: 8,
      ballDia: 15,     // mm
      pitchDia: 65,    // mm
      contactAngle: 0, // deg
    },
  },
  custom: {
    label: "Custom Motor",
    subtitle: "Editable parameters",
    rpm: 1780,
    bearing: {
      model: "Custom Bearing",
      nBalls: 9,
      ballDia: 12,
      pitchDia: 55,
      contactAngle: 0,
    },
  },
};

const FAULT_MODES = {
  healthy:         { label: "Healthy",           color: C.green,  description: "Normal baseline vibration, just 1x running speed with some noise." },
  imbalance:       { label: "Rotor Imbalance",   color: C.gold,   description: "Strong 1x running speed peak. Simple, shows up clearly in raw FFT." },
  misalignment:    { label: "Misalignment",      color: C.purple, description: "Strong 2x (and 3x) peaks. Classic coupling misalignment signature." },
  looseness:       { label: "Mechanical Looseness", color: C.orange, description: "1x plus half-integer harmonics (0.5x, 1.5x, 2.5x). Looseness fingerprint." },
  outer_race:      { label: "Bearing Outer Race", color: C.red,   description: "Impulses at BPFO modulating the resonance band. Envelope spectrum is where you see it." },
  inner_race:      { label: "Bearing Inner Race", color: C.red,   description: "Impulses at BPFI modulated by running speed (sidebands at BPFI ± fr in envelope)." },
  rolling_element: { label: "Rolling Element",   color: C.red,   description: "Impulses at 2×BSF modulated by cage frequency FTF." },
  cage:            { label: "Cage Defect",       color: C.red,   description: "Low-frequency modulation at FTF. Rare but distinctive." },
};

// ══════════════════════════════════════════════════════════════════════
//  BEARING MATH
// ══════════════════════════════════════════════════════════════════════
function computeFaultFrequencies(rpm, bearing) {
  const fr = rpm / 60; // shaft freq (Hz)
  const ratio = (bearing.ballDia / bearing.pitchDia) * Math.cos(bearing.contactAngle * Math.PI / 180);
  return {
    fr,
    bpfo: (bearing.nBalls / 2) * fr * (1 - ratio),
    bpfi: (bearing.nBalls / 2) * fr * (1 + ratio),
    bsf:  (bearing.pitchDia / (2 * bearing.ballDia)) * fr * (1 - ratio * ratio),
    ftf:  (fr / 2) * (1 - ratio),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  SYNTHETIC SIGNAL
// ══════════════════════════════════════════════════════════════════════
function gaussian(sigma = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

// Synthesize N samples starting at global time t0 (seconds)
function synthesize(t0, params) {
  const { rpm, bearing, faultMode, severity, noiseLevel } = params;
  const freqs = computeFaultFrequencies(rpm, bearing);
  const fr = freqs.fr;
  const samples = new Float32Array(N);

  // Baseline: 1x running + minor 2x + broadband noise
  for (let i = 0; i < N; i++) {
    const t = t0 + i / FS;
    samples[i] =
      0.4 * Math.sin(2 * Math.PI * fr * t) +
      0.08 * Math.sin(2 * Math.PI * 2 * fr * t + 0.3) +
      gaussian(noiseLevel);
  }

  const sev = severity / 100;

  // Helper: add impulse train that excites resonance
  function addImpulseTrain(faultFreq, amplitude, modFn) {
    if (faultFreq <= 0) return;
    const period = 1 / faultFreq;
    const firstImpulse = Math.floor(t0 / period) * period;
    const endT = t0 + N / FS;
    for (let tImp = firstImpulse; tImp < endT + period; tImp += period) {
      const jitter = gaussian(period * 0.02);
      const tHit = tImp + jitter;
      const modAmp = amplitude * (modFn ? modFn(tHit) : 1);
      // Damped sinusoid from tHit
      const iStart = Math.max(0, Math.ceil((tHit - t0) * FS));
      const iEnd = Math.min(N, iStart + Math.ceil(6 * DECAY_TAU * FS));
      for (let i = iStart; i < iEnd; i++) {
        const dt = (t0 + i / FS) - tHit;
        if (dt < 0) continue;
        samples[i] += modAmp * Math.exp(-dt / DECAY_TAU) * Math.sin(2 * Math.PI * RESONANCE_HZ * dt);
      }
    }
  }

  switch (faultMode) {
    case "imbalance": {
      // Pure 1x dominant
      const a = sev * 2.5;
      for (let i = 0; i < N; i++) {
        const t = t0 + i / FS;
        samples[i] += a * Math.sin(2 * Math.PI * fr * t + 0.7);
      }
      break;
    }
    case "misalignment": {
      const a = sev * 1.8;
      for (let i = 0; i < N; i++) {
        const t = t0 + i / FS;
        samples[i] += a * Math.sin(2 * Math.PI * 2 * fr * t + 0.4);
        samples[i] += a * 0.7 * Math.sin(2 * Math.PI * 3 * fr * t + 0.9);
      }
      break;
    }
    case "looseness": {
      const a = sev * 1.3;
      for (let i = 0; i < N; i++) {
        const t = t0 + i / FS;
        samples[i] += a * 0.9 * Math.sin(2 * Math.PI * fr * t);
        samples[i] += a * 0.55 * Math.sin(2 * Math.PI * 1.5 * fr * t + 0.2);
        samples[i] += a * 0.4 * Math.sin(2 * Math.PI * 2.5 * fr * t + 0.5);
      }
      break;
    }
    case "outer_race": {
      addImpulseTrain(freqs.bpfo, sev * 3.0, null);
      break;
    }
    case "inner_race": {
      // Amplitude modulation by shaft rotation (inner race passes load zone 1x/rev)
      addImpulseTrain(freqs.bpfi, sev * 2.8, (tHit) => 0.4 + 0.6 * Math.pow(Math.max(0, Math.sin(2 * Math.PI * fr * tHit)), 2));
      break;
    }
    case "rolling_element": {
      // Impulses at 2*BSF, modulated by cage frequency
      addImpulseTrain(2 * freqs.bsf, sev * 2.2, (tHit) => 0.5 + 0.5 * Math.sin(2 * Math.PI * freqs.ftf * tHit));
      break;
    }
    case "cage": {
      // Low-frequency cage rumble at FTF, weak impulses
      addImpulseTrain(freqs.ftf, sev * 1.5, null);
      const a = sev * 0.8;
      for (let i = 0; i < N; i++) {
        const t = t0 + i / FS;
        samples[i] += a * Math.sin(2 * Math.PI * freqs.ftf * t);
      }
      break;
    }
    default:
      break;
  }

  return samples;
}

// ══════════════════════════════════════════════════════════════════════
//  FFT (Radix-2 Cooley-Tukey, in-place)
// ══════════════════════════════════════════════════════════════════════
function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const phaseStep = -2 * Math.PI / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const phase = phaseStep * k;
        const cos = Math.cos(phase);
        const sin = Math.sin(phase);
        const a = i + k;
        const b = a + half;
        const tre = re[b] * cos - im[b] * sin;
        const tim = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
      }
    }
  }
}

function ifft(re, im) {
  // conjugate, forward fft, conjugate, scale
  for (let i = 0; i < re.length; i++) im[i] = -im[i];
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

function applyHann(samples) {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    out[i] = samples[i] * w;
  }
  return out;
}

function magnitudeSpectrum(samples) {
  const windowed = applyHann(samples);
  const re = Array.from(windowed);
  const im = new Array(N).fill(0);
  fft(re, im);
  const half = N >> 1;
  const mag = new Float32Array(half);
  // Hann window amplitude correction factor ~2 (for real signals, single-sided)
  for (let i = 0; i < half; i++) {
    mag[i] = 2 * Math.sqrt(re[i] * re[i] + im[i] * im[i]) / N;
  }
  return mag;
}

// Envelope spectrum via FFT bandpass + rectify + FFT
function envelopeSpectrum(samples, bandLow, bandHigh) {
  const re = Array.from(samples);
  const im = new Array(N).fill(0);
  fft(re, im);
  for (let i = 0; i < N; i++) {
    const f = (i <= N / 2) ? i * FS / N : (i - N) * FS / N;
    if (Math.abs(f) < bandLow || Math.abs(f) > bandHigh) {
      re[i] = 0;
      im[i] = 0;
    }
  }
  ifft(re, im);
  // bandpassed real signal is in re[]; magnitude of analytic signal ≈ |bandpassed|
  // Simpler: rectify, remove DC, FFT again
  const rect = new Float32Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    rect[i] = Math.abs(re[i]);
    sum += rect[i];
  }
  const mean = sum / N;
  for (let i = 0; i < N; i++) rect[i] -= mean;
  return magnitudeSpectrum(rect);
}

// ══════════════════════════════════════════════════════════════════════
//  METRICS
// ══════════════════════════════════════════════════════════════════════
function computeMetrics(samples) {
  const n = samples.length;
  let sum = 0, sumSq = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    sum += samples[i];
    sumSq += samples[i] * samples[i];
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const std = Math.sqrt(Math.max(1e-12, variance));
  const rms = Math.sqrt(sumSq / n);
  const crest = rms > 1e-9 ? peak / rms : 0;
  // Kurtosis (m4 / variance^2). Normal = 3, impulsive signals > 3.
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = samples[i] - mean;
    m4 += d * d * d * d;
  }
  m4 /= n;
  const kurtosis = variance > 1e-9 ? m4 / (variance * variance) : 0;
  return { rms, peak, crest, kurtosis, std };
}

// ══════════════════════════════════════════════════════════════════════
//  AUTO DIAGNOSIS
// ══════════════════════════════════════════════════════════════════════
// Find the strongest peak in a frequency band and return its freq / magnitude.
function findPeakInBand(mag, centerHz, toleranceHz) {
  const binHz = FS / N;
  const lo = Math.max(1, Math.floor((centerHz - toleranceHz) / binHz));
  const hi = Math.min(mag.length - 1, Math.ceil((centerHz + toleranceHz) / binHz));
  let best = { freq: 0, mag: 0 };
  for (let i = lo; i <= hi; i++) {
    if (mag[i] > best.mag) best = { freq: i * binHz, mag: mag[i] };
  }
  return best;
}

function diagnose(freqs, spectrum, envSpectrum, metrics) {
  const results = [];
  // Running speed related
  const p1x = findPeakInBand(spectrum, freqs.fr, 2);
  const p2x = findPeakInBand(spectrum, 2 * freqs.fr, 3);
  const p3x = findPeakInBand(spectrum, 3 * freqs.fr, 3);
  const pHalf = findPeakInBand(spectrum, 1.5 * freqs.fr, 3);
  // Bearing faults in envelope
  const pBpfo = findPeakInBand(envSpectrum, freqs.bpfo, 3);
  const pBpfi = findPeakInBand(envSpectrum, freqs.bpfi, 3);
  const p2Bsf = findPeakInBand(envSpectrum, 2 * freqs.bsf, 3);
  const pFtf  = findPeakInBand(envSpectrum, freqs.ftf, 2);

  // Relative scoring: each peak compared to median of envelope/spectrum
  function median(arr) {
    const copy = Array.from(arr).sort((a,b) => a-b);
    return copy[Math.floor(copy.length / 2)];
  }
  const specMed = median(spectrum.slice(5, 500)) || 1e-6;
  const envMed = median(envSpectrum.slice(5, 500)) || 1e-6;

  if (p1x.mag / specMed > 25) results.push({ tag: "1×", severity: Math.min(1, p1x.mag / specMed / 80), label: "Imbalance", confidence: "High", hint: "Strong peak at running speed", color: C.gold });
  if (p2x.mag / specMed > 15) results.push({ tag: "2×", severity: Math.min(1, p2x.mag / specMed / 50), label: "Misalignment", confidence: "Medium", hint: "Strong peak at 2× running speed", color: C.purple });
  if (pHalf.mag / specMed > 10) results.push({ tag: "0.5×", severity: Math.min(1, pHalf.mag / specMed / 40), label: "Looseness", confidence: "Medium", hint: "Half-integer harmonics present", color: C.orange });
  if (pBpfo.mag / envMed > 8 && metrics.kurtosis > 3.5) results.push({ tag: "BPFO", severity: Math.min(1, pBpfo.mag / envMed / 25), label: "Outer race fault", confidence: "High", hint: `Envelope peak at ${pBpfo.freq.toFixed(1)} Hz`, color: C.red });
  if (pBpfi.mag / envMed > 8 && metrics.kurtosis > 3.5) results.push({ tag: "BPFI", severity: Math.min(1, pBpfi.mag / envMed / 25), label: "Inner race fault", confidence: "High", hint: `Envelope peak at ${pBpfi.freq.toFixed(1)} Hz`, color: C.red });
  if (p2Bsf.mag / envMed > 8 && metrics.kurtosis > 3.5) results.push({ tag: "2×BSF", severity: Math.min(1, p2Bsf.mag / envMed / 25), label: "Rolling element fault", confidence: "Medium", hint: `Envelope peak at ${p2Bsf.freq.toFixed(1)} Hz`, color: C.red });
  if (pFtf.mag / envMed > 10) results.push({ tag: "FTF", severity: Math.min(1, pFtf.mag / envMed / 30), label: "Cage defect", confidence: "Low", hint: `Envelope peak at ${pFtf.freq.toFixed(1)} Hz`, color: C.red });

  return results;
}

// ══════════════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════════════
function downsample(arr, targetPoints, fromIdx = 0, toIdx = arr.length) {
  const span = toIdx - fromIdx;
  if (span <= targetPoints) {
    const out = [];
    for (let i = fromIdx; i < toIdx; i++) out.push({ i, v: arr[i] });
    return out;
  }
  const step = span / targetPoints;
  const out = [];
  for (let k = 0; k < targetPoints; k++) {
    const idx = Math.floor(fromIdx + k * step);
    out.push({ i: idx, v: arr[idx] });
  }
  return out;
}

function metricColor(kind, value) {
  // kind: 'rms' | 'crest' | 'kurtosis' | 'peak'
  if (kind === "crest") {
    if (value < 3) return C.green;
    if (value < 4.5) return C.gold;
    return C.red;
  }
  if (kind === "kurtosis") {
    if (value < 3.5) return C.green;
    if (value < 5) return C.gold;
    return C.red;
  }
  if (kind === "rms") {
    if (value < 1.5) return C.green;
    if (value < 2.8) return C.gold;
    return C.red;
  }
  if (kind === "peak") {
    if (value < 4) return C.green;
    if (value < 7) return C.gold;
    return C.red;
  }
  return C.text;
}

// Pill component
function Pill({ children, color = C.textDim, bg, border }) {
  return (
    <span style={{
      fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 4,
      color, background: bg || "transparent",
      border: `1px solid ${border || color + "33"}`,
      letterSpacing: "0.05em", whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function VibrationFFTAnalyzer() {
  const [presetKey, setPresetKey] = useState("acs480_conveyor");
  const [rpm, setRpm] = useState(PRESETS.acs480_conveyor.rpm);
  const [bearing, setBearing] = useState(PRESETS.acs480_conveyor.bearing);
  const [faultMode, setFaultMode] = useState("healthy");
  const [severity, setSeverity] = useState(60);
  const [noiseLevel, setNoiseLevel] = useState(0.3);
  const [running, setRunning] = useState(true);
  const [tab, setTab] = useState("time");   // "time" | "fft" | "env"
  const [infoOpen, setInfoOpen] = useState(false);
  const [showBearingEdit, setShowBearingEdit] = useState(false);

  // Live data
  const [samples, setSamples] = useState(() => new Float32Array(N));
  const [spectrum, setSpectrum] = useState(() => new Float32Array(N / 2));
  const [envSpec, setEnvSpec] = useState(() => new Float32Array(N / 2));
  const [metrics, setMetrics] = useState({ rms: 0, peak: 0, crest: 0, kurtosis: 0, std: 0 });

  const tRef = useRef(0);

  // On preset change, pull defaults
  useEffect(() => {
    const p = PRESETS[presetKey];
    if (!p) return;
    setRpm(p.rpm);
    setBearing(p.bearing);
  }, [presetKey]);

  const freqs = useMemo(() => computeFaultFrequencies(rpm, bearing), [rpm, bearing]);

  // Live signal generation loop
  useEffect(() => {
    if (!running) return;
    const params = { rpm, bearing, faultMode, severity, noiseLevel };
    const id = setInterval(() => {
      tRef.current += N / FS;
      const buf = synthesize(tRef.current, params);
      const spec = magnitudeSpectrum(buf);
      const env = envelopeSpectrum(buf, ENV_BAND_LOW, ENV_BAND_HIGH);
      const m = computeMetrics(buf);
      setSamples(buf);
      setSpectrum(spec);
      setEnvSpec(env);
      setMetrics(m);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, rpm, bearing, faultMode, severity, noiseLevel]);

  const diagnosis = useMemo(() => diagnose(freqs, spectrum, envSpec, metrics), [freqs, spectrum, envSpec, metrics]);

  // ═══ Chart data ══════════════════════════════════════════════
  // Time-domain: show first 0.1 sec = ~820 samples, downsample to 300
  const timeData = useMemo(() => {
    const endIdx = Math.min(N, Math.round(0.1 * FS));
    return downsample(samples, 300, 0, endIdx).map(d => ({
      t: (d.i / FS * 1000).toFixed(1),  // ms
      v: d.v,
    }));
  }, [samples]);

  // FFT: show 0-500 Hz (captures all bearing faults + harmonics comfortably)
  const fftData = useMemo(() => {
    const binHz = FS / N;
    const endBin = Math.min(spectrum.length, Math.ceil(500 / binHz));
    const out = [];
    for (let i = 1; i < endBin; i++) {
      out.push({ f: +(i * binHz).toFixed(1), m: spectrum[i] });
    }
    return out;
  }, [spectrum]);

  // Envelope spectrum: show 0-300 Hz (fault frequencies live here)
  const envData = useMemo(() => {
    const binHz = FS / N;
    const endBin = Math.min(envSpec.length, Math.ceil(300 / binHz));
    const out = [];
    for (let i = 1; i < endBin; i++) {
      out.push({ f: +(i * binHz).toFixed(1), m: envSpec[i] });
    }
    return out;
  }, [envSpec]);

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; height: 3px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        .vfa-slider { -webkit-appearance: none; width: 100%; height: 3px; background: ${C.border}; border-radius: 2px; outline: none; }
        .vfa-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: ${C.cyan}; cursor: pointer; border: 2px solid ${C.bg}; }
        .vfa-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: ${C.cyan}; cursor: pointer; border: 2px solid ${C.bg}; }
      `}</style>

      <div style={{ maxWidth: 1600, margin: "0 auto", padding: "64px 28px 32px" }}>
        {/* ═══ HEADER ═══════════════════════════════════════════════ */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.cyan, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>
              Condition Monitoring · Signal Analysis
            </div>
            <h1 style={{ fontFamily: heading, fontSize: 32, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.03em" }}>
              Vibration FFT Analyzer
            </h1>
            <div style={{ fontFamily: body, fontSize: 13, color: C.textSoft, marginTop: 6, maxWidth: 680 }}>
              Synthesize motor vibration with realistic fault signatures, then analyze with FFT and envelope demodulation. The same workflow used in industrial bearing diagnostics.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setRunning(r => !r)}
              style={{
                background: running ? C.greenBg : C.card,
                border: `1px solid ${running ? C.green + "55" : C.border}`,
                color: running ? C.green : C.textSoft,
                fontFamily: mono, fontSize: 11, fontWeight: 600,
                padding: "8px 16px", borderRadius: 8, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: running ? C.green : C.textMuted, boxShadow: running ? `0 0 6px ${C.green}` : "none" }} />
              {running ? "Live" : "Paused"}
            </button>
            <button
              onClick={() => setInfoOpen(true)}
              title="About this demo"
              style={{
                background: C.card, border: `1px solid ${C.border}`, color: C.textSoft,
                width: 34, height: 34, borderRadius: 8, cursor: "pointer",
                fontFamily: heading, fontSize: 14, fontWeight: 700,
              }}
            >?</button>
          </div>
        </div>

        {/* ═══ CONTROLS STRIP ═══════════════════════════════════════ */}
        <div style={{
          background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: "18px 20px", marginBottom: 16,
          display: "grid", gridTemplateColumns: "1.2fr 1.6fr 1fr 1fr", gap: 20, alignItems: "start",
        }}>
          {/* Preset */}
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>Motor Preset</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(PRESETS).map(([k, p]) => (
                <button key={k} onClick={() => setPresetKey(k)} style={{
                  background: presetKey === k ? C.cyanBg : C.card,
                  border: `1px solid ${presetKey === k ? C.cyan + "55" : C.border}`,
                  color: presetKey === k ? C.cyan : C.textSoft,
                  fontFamily: mono, fontSize: 10, fontWeight: 500,
                  padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                  textAlign: "left",
                }}>
                  <div>{p.label}</div>
                  <div style={{ fontSize: 8, color: C.textDim, marginTop: 2 }}>{p.subtitle}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Fault mode */}
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>Fault Injection</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {Object.entries(FAULT_MODES).map(([k, f]) => (
                <button key={k} onClick={() => setFaultMode(k)} style={{
                  background: faultMode === k ? f.color + "22" : C.card,
                  border: `1px solid ${faultMode === k ? f.color + "66" : C.border}`,
                  color: faultMode === k ? f.color : C.textSoft,
                  fontFamily: mono, fontSize: 9, fontWeight: 500,
                  padding: "6px 4px", borderRadius: 5, cursor: "pointer",
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          {/* Severity */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Severity</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.cyan, fontWeight: 600 }}>{severity}%</span>
            </div>
            <input type="range" min="0" max="100" value={severity} onChange={e => setSeverity(+e.target.value)} className="vfa-slider" disabled={faultMode === "healthy"} style={{ opacity: faultMode === "healthy" ? 0.3 : 1 }} />
            <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, marginTop: 6, fontStyle: "italic" }}>
              {faultMode === "healthy" ? "No fault injected" : FAULT_MODES[faultMode].description}
            </div>
          </div>

          {/* RPM + noise */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Shaft Speed</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, fontWeight: 600 }}>{rpm} RPM</span>
            </div>
            <input type="range" min="300" max="3000" step="10" value={rpm} onChange={e => setRpm(+e.target.value)} className="vfa-slider" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, marginBottom: 4 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Noise Floor</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.textSoft }}>{noiseLevel.toFixed(2)}</span>
            </div>
            <input type="range" min="0.05" max="1.0" step="0.05" value={noiseLevel} onChange={e => setNoiseLevel(+e.target.value)} className="vfa-slider" />
          </div>
        </div>

        {/* ═══ MAIN LAYOUT ══════════════════════════════════════════ */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>

          {/* ═══ LEFT COLUMN: CHARTS ═══ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Chart tabs */}
            <div style={{ display: "flex", gap: 4, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4 }}>
              {[
                { id: "time", label: "Time Domain",     sub: "Raw waveform" },
                { id: "fft",  label: "FFT Spectrum",    sub: "Frequency content" },
                { id: "env",  label: "Envelope Spectrum", sub: "Demodulated bearing signatures" },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{
                  flex: 1, background: tab === t.id ? C.cyanBg : "transparent",
                  border: `1px solid ${tab === t.id ? C.cyan + "55" : "transparent"}`,
                  borderRadius: 7, padding: "10px 14px", cursor: "pointer",
                  textAlign: "left", transition: "all 0.2s",
                }}>
                  <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: tab === t.id ? C.cyan : C.text }}>{t.label}</div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, marginTop: 2 }}>{t.sub}</div>
                </button>
              ))}
            </div>

            {/* Main chart */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px", height: 380 }}>
              {tab === "time" && <TimeChart data={timeData} />}
              {tab === "fft"  && <FFTChart data={fftData} freqs={freqs} faultMode={faultMode} />}
              {tab === "env"  && <EnvelopeChart data={envData} freqs={freqs} faultMode={faultMode} />}
            </div>

            {/* Metrics strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "RMS",          value: metrics.rms.toFixed(3),      unit: "g",   kind: "rms" },
                { label: "Peak",         value: metrics.peak.toFixed(3),     unit: "g",   kind: "peak" },
                { label: "Crest Factor", value: metrics.crest.toFixed(2),    unit: "",    kind: "crest" },
                { label: "Kurtosis",     value: metrics.kurtosis.toFixed(2), unit: "",    kind: "kurtosis" },
              ].map(m => {
                const col = metricColor(m.kind, parseFloat(m.value));
                return (
                  <div key={m.label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`, borderRadius: 8, padding: "12px 16px" }}>
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{m.label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
                      <span style={{ fontFamily: heading, fontSize: 22, fontWeight: 700, color: col, letterSpacing: "-0.02em" }}>{m.value}</span>
                      <span style={{ fontFamily: mono, fontSize: 10, color: C.textDim }}>{m.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ RIGHT COLUMN: SIDEBAR ═══ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Diagnosis */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: diagnosis.length === 0 ? C.green : C.red, boxShadow: `0 0 6px ${diagnosis.length === 0 ? C.green : C.red}` }} />
                Auto Diagnosis
              </div>
              {diagnosis.length === 0 ? (
                <div style={{ padding: "14px 0", textAlign: "center" }}>
                  <div style={{ fontFamily: heading, fontSize: 16, color: C.green, fontWeight: 600 }}>No faults detected</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, marginTop: 6 }}>All peaks within normal bounds</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {diagnosis.map((d, i) => (
                    <div key={i} style={{ background: C.card, border: `1px solid ${d.color}33`, borderLeft: `3px solid ${d.color}`, borderRadius: 6, padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontFamily: heading, fontSize: 12, fontWeight: 600, color: d.color }}>{d.label}</span>
                        <Pill color={d.color} bg={d.color + "18"}>{d.tag}</Pill>
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, marginBottom: 6 }}>{d.hint}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${d.severity * 100}%`, background: d.color, transition: "width 0.3s" }} />
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 9, color: C.textSoft }}>{d.confidence}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fault frequencies */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>Fault Frequencies</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  { key: "fr",   label: "1× Shaft (fr)",     color: C.gold },
                  { key: "ftf",  label: "FTF · Cage",        color: C.blue },
                  { key: "bsf",  label: "BSF · Ball Spin",   color: C.purple },
                  { key: "bpfo", label: "BPFO · Outer Race", color: C.red },
                  { key: "bpfi", label: "BPFI · Inner Race", color: C.red },
                ].map(row => (
                  <div key={row.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: C.card, borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 3, height: 14, background: row.color, borderRadius: 1 }} />
                      <span style={{ fontFamily: mono, fontSize: 10, color: C.textSoft }}>{row.label}</span>
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 11, color: C.text, fontWeight: 600 }}>{freqs[row.key].toFixed(1)} Hz</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bearing geometry */}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.12em" }}>Bearing Geometry</div>
                <button onClick={() => setShowBearingEdit(s => !s)} style={{
                  background: "transparent", border: "none", color: C.cyan, cursor: "pointer",
                  fontFamily: mono, fontSize: 9, padding: 0,
                }}>{showBearingEdit ? "Close" : "Edit"}</button>
              </div>
              <div style={{ fontFamily: heading, fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>{bearing.model}</div>
              {!showBearingEdit ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { label: "Balls",     val: bearing.nBalls },
                    { label: "Ball Ø",    val: `${bearing.ballDia} mm` },
                    { label: "Pitch Ø",   val: `${bearing.pitchDia} mm` },
                    { label: "Contact ∠", val: `${bearing.contactAngle}°` },
                  ].map(x => (
                    <div key={x.label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                      <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>{x.label}</span>
                      <span style={{ fontFamily: mono, fontSize: 10, color: C.textSoft }}>{x.val}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { key: "nBalls",       label: "Number of balls", min: 4,  max: 24, step: 1 },
                    { key: "ballDia",      label: "Ball diameter (mm)",     min: 3,  max: 40, step: 0.5 },
                    { key: "pitchDia",     label: "Pitch diameter (mm)",    min: 10, max: 200, step: 1 },
                    { key: "contactAngle", label: "Contact angle (°)",       min: 0,  max: 40, step: 1 },
                  ].map(f => (
                    <div key={f.key}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>{f.label}</span>
                        <span style={{ fontFamily: mono, fontSize: 9, color: C.cyan }}>{bearing[f.key]}</span>
                      </div>
                      <input
                        type="range"
                        className="vfa-slider"
                        min={f.min} max={f.max} step={f.step}
                        value={bearing[f.key]}
                        onChange={e => setBearing(b => ({ ...b, [f.key]: +e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ═══ INFO MODAL ═══════════════════════════════════════════ */}
      {infoOpen && (
        <div onClick={() => setInfoOpen(false)} style={{
          position: "fixed", inset: 0, zIndex: 500,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16,
            padding: "28px 32px", maxWidth: 640, maxHeight: "85vh", overflow: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: 10, color: C.cyan, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 4 }}>About</div>
                <div style={{ fontFamily: heading, fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: "-0.03em" }}>Vibration FFT Analyzer</div>
              </div>
              <button onClick={() => setInfoOpen(false)} style={{
                background: "transparent", border: "none", color: C.textDim, cursor: "pointer", fontSize: 20, padding: 0,
              }}>×</button>
            </div>

            <div style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.75 }}>
              <p style={{ margin: "0 0 14px" }}>
                This tool does what vibration analysts do every day in process plants: generate a waveform, look at its frequency content, and pull out bearing fault signatures using envelope demodulation. Everything runs in the browser, no backend.
              </p>

              <div style={{ fontFamily: heading, fontSize: 14, fontWeight: 600, color: C.cyan, marginTop: 20, marginBottom: 8 }}>How the signal is built</div>
              <p style={{ margin: "0 0 14px" }}>
                The baseline is a running-speed sine wave plus a small 2x harmonic and broadband noise. Mechanical faults add their own signatures on top: imbalance boosts 1x, misalignment pumps up 2x and 3x, looseness brings in half-integer harmonics. Bearing faults are more interesting. They show up as periodic impulses that excite a high-frequency resonance (around 2.8 kHz here), repeating at the bearing's characteristic fault frequency.
              </p>

              <div style={{ fontFamily: heading, fontSize: 14, fontWeight: 600, color: C.cyan, marginTop: 20, marginBottom: 8 }}>Why envelope demodulation</div>
              <p style={{ margin: "0 0 14px" }}>
                Early bearing faults don't show up well in the raw FFT. The impulses are low-energy and spread across a wide band of resonance harmonics. But if you bandpass around the resonance (1.8-3.8 kHz), rectify, and FFT the envelope, the fault frequency pops out clearly. That's the standard diagnostic workflow and it's what the third chart tab shows.
              </p>

              <div style={{ fontFamily: heading, fontSize: 14, fontWeight: 600, color: C.cyan, marginTop: 20, marginBottom: 8 }}>Metrics that matter</div>
              <p style={{ margin: "0 0 14px" }}>
                RMS tracks overall vibration energy. Crest factor (peak over RMS) is around 1.4 for a clean sine and climbs when impulses appear. Kurtosis is the sharpest early-warning metric: it measures how "peaky" the signal is, sitting near 3 for healthy gaussian signals and jumping well above 4 when bearings start impacting.
              </p>

              <div style={{ fontFamily: heading, fontSize: 14, fontWeight: 600, color: C.cyan, marginTop: 20, marginBottom: 8 }}>Built by</div>
              <p style={{ margin: 0 }}>
                Egemen Birol. I worked on ABB drives and Siemens PLCs at ArcelorMittal's hot rolling mill. Condition monitoring was always part of the job, so this demo is basically the analysis side of what vibration engineers do, rebuilt from scratch in React. FFT is a hand-rolled radix-2 Cooley-Tukey implementation.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  CHART COMPONENTS
// ══════════════════════════════════════════════════════════════════════
function TimeChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 10, bottom: 30 }}>
        <CartesianGrid stroke={C.border} strokeDasharray="2 4" />
        <XAxis
          dataKey="t" stroke={C.textDim}
          tick={{ fontSize: 10, fontFamily: mono, fill: C.textDim }}
          tickLine={{ stroke: C.border }} axisLine={{ stroke: C.border }}
          label={{ value: "Time (ms)", position: "insideBottom", offset: -16, fill: C.textDim, fontSize: 10, fontFamily: mono }}
        />
        <YAxis
          stroke={C.textDim}
          tick={{ fontSize: 10, fontFamily: mono, fill: C.textDim }}
          tickLine={{ stroke: C.border }} axisLine={{ stroke: C.border }}
          label={{ value: "Acceleration (g)", angle: -90, position: "insideLeft", fill: C.textDim, fontSize: 10, fontFamily: mono }}
          domain={["auto", "auto"]}
        />
        <Tooltip
          contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: mono, fontSize: 11 }}
          labelStyle={{ color: C.textDim }}
          itemStyle={{ color: C.cyan }}
          formatter={(v) => [typeof v === "number" ? v.toFixed(3) : v, "g"]}
        />
        <Line type="monotone" dataKey="v" stroke={C.cyan} strokeWidth={1.2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function FFTChart({ data, freqs, faultMode }) {
  // Reference lines for running speed harmonics
  const refs = [
    { x: freqs.fr,      label: "1×",   color: C.gold },
    { x: 2 * freqs.fr,  label: "2×",   color: C.purple },
    { x: 3 * freqs.fr,  label: "3×",   color: C.purple + "99" },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 10, bottom: 30 }}>
        <CartesianGrid stroke={C.border} strokeDasharray="2 4" />
        <XAxis
          dataKey="f" stroke={C.textDim} type="number" domain={[0, 500]}
          tick={{ fontSize: 10, fontFamily: mono, fill: C.textDim }}
          tickLine={{ stroke: C.border }} axisLine={{ stroke: C.border }}
          label={{ value: "Frequency (Hz)", position: "insideBottom", offset: -16, fill: C.textDim, fontSize: 10, fontFamily: mono }}
        />
        <YAxis
          stroke={C.textDim}
          tick={{ fontSize: 10, fontFamily: mono, fill: C.textDim }}
          tickLine={{ stroke: C.border }} axisLine={{ stroke: C.border }}
          label={{ value: "Magnitude", angle: -90, position: "insideLeft", fill: C.textDim, fontSize: 10, fontFamily: mono }}
        />
        <Tooltip
          contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: mono, fontSize: 11 }}
          labelStyle={{ color: C.textDim }}
          itemStyle={{ color: C.cyan }}
          formatter={(v, n, p) => [typeof v === "number" ? v.toFixed(4) : v, `${p.payload.f} Hz`]}
        />
        {refs.map((r, i) => (
          <ReferenceLine key={i} x={r.x} stroke={r.color} strokeDasharray="2 3" strokeWidth={1}
            label={{ value: r.label, position: "top", fill: r.color, fontSize: 10, fontFamily: mono }} />
        ))}
        <Line type="monotone" dataKey="m" stroke={C.cyan} strokeWidth={1.3} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EnvelopeChart({ data, freqs, faultMode }) {
  // Bearing fault frequency markers on envelope
  const refs = [
    { x: freqs.ftf,       label: "FTF",   color: C.blue },
    { x: 2 * freqs.bsf,   label: "2×BSF", color: C.purple },
    { x: freqs.bpfo,      label: "BPFO",  color: C.red },
    { x: freqs.bpfi,      label: "BPFI",  color: C.orange },
  ];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 10, bottom: 30 }}>
        <CartesianGrid stroke={C.border} strokeDasharray="2 4" />
        <XAxis
          dataKey="f" stroke={C.textDim} type="number" domain={[0, 300]}
          tick={{ fontSize: 10, fontFamily: mono, fill: C.textDim }}
          tickLine={{ stroke: C.border }} axisLine={{ stroke: C.border }}
          label={{ value: "Frequency (Hz)", position: "insideBottom", offset: -16, fill: C.textDim, fontSize: 10, fontFamily: mono }}
        />
        <YAxis
          stroke={C.textDim}
          tick={{ fontSize: 10, fontFamily: mono, fill: C.textDim }}
          tickLine={{ stroke: C.border }} axisLine={{ stroke: C.border }}
          label={{ value: "Envelope Magnitude", angle: -90, position: "insideLeft", fill: C.textDim, fontSize: 10, fontFamily: mono }}
        />
        <Tooltip
          contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: mono, fontSize: 11 }}
          labelStyle={{ color: C.textDim }}
          itemStyle={{ color: C.red }}
          formatter={(v, n, p) => [typeof v === "number" ? v.toFixed(4) : v, `${p.payload.f} Hz`]}
        />
        {refs.map((r, i) => (
          <ReferenceLine key={i} x={r.x} stroke={r.color} strokeDasharray="2 3" strokeWidth={1}
            label={{ value: r.label, position: "top", fill: r.color, fontSize: 10, fontFamily: mono }} />
        ))}
        <Line type="monotone" dataKey="m" stroke={C.red} strokeWidth={1.3} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
