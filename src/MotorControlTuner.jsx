import { useState, useMemo, useRef } from "react";
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, ComposedChart, ScatterChart, Scatter, Cell, ZAxis } from "recharts";

// ══════════════════════════════════════════════════════════════════════
//  MOTOR PHYSICS ENGINE
// ══════════════════════════════════════════════════════════════════════
function simulateMotor(params, pid, dt = 0.002, duration = 5) {
  const { J, B, loadTorque, targetSpeed } = params;
  const { Kp, Ki, Kd } = pid;
  let omega = 0, integral = 0, prevError = targetSpeed;
  const data = [];
  const step = Math.max(1, Math.floor(0.01 / dt));
  let maxOmega = 0, settlingTime = 0, riseStart = -1, riseEnd = -1;
  const total = Math.floor(duration / dt);
  for (let i = 0; i <= total; i++) {
    const t = i * dt;
    const error = targetSpeed - omega;
    integral += error * dt;
    integral = Math.max(-1000, Math.min(1000, integral));
    const deriv = (error - prevError) / dt;
    let u = Kp * error + Ki * integral + Kd * deriv;
    u = Math.max(-500, Math.min(500, u));
    const domega = (u - loadTorque - B * omega) / J;
    omega += domega * dt;
    prevError = error;
    if (omega > maxOmega) maxOmega = omega;
    if (riseStart < 0 && omega >= targetSpeed * 0.1) riseStart = t;
    if (riseEnd < 0 && omega >= targetSpeed * 0.9) riseEnd = t;
    if (Math.abs(error / targetSpeed) > 0.02) settlingTime = t;
    if (i % step === 0) {
      data.push({
        time: parseFloat(t.toFixed(3)),
        speed: parseFloat(omega.toFixed(3)),
        target: targetSpeed,
        error: parseFloat(error.toFixed(3)),
        control: parseFloat(u.toFixed(2)),
      });
    }
  }
  const overshoot = targetSpeed > 0 ? Math.max(0, ((maxOmega - targetSpeed) / targetSpeed) * 100) : 0;
  const riseTime = riseEnd >= 0 && riseStart >= 0 ? riseEnd - riseStart : null;
  const sse = data.length > 0 ? Math.abs(data[data.length - 1].error) : 999;
  return {
    data,
    metrics: {
      overshoot: overshoot.toFixed(1),
      settlingTime: settlingTime.toFixed(2),
      riseTime: riseTime !== null ? riseTime.toFixed(3) : "N/A",
      steadyStateError: sse.toFixed(3),
      peakSpeed: maxOmega.toFixed(1),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
//  REWARD FUNCTION
// ══════════════════════════════════════════════════════════════════════
function computeReward(params, pid) {
  const { data, metrics } = simulateMotor(params, pid, 0.002, 5);
  const os = parseFloat(metrics.overshoot);
  const st = parseFloat(metrics.settlingTime);
  const sse = parseFloat(metrics.steadyStateError);
  const rt = metrics.riseTime !== "N/A" ? parseFloat(metrics.riseTime) : 5;
  if (data.some(d => Math.abs(d.speed) > params.targetSpeed * 3 || isNaN(d.speed))) return -100;
  const overshootPenalty = os < 5 ? 30 : os < 15 ? 15 - os * 0.5 : -os * 1.5;
  const settlingReward = st < 1 ? 30 : st < 2 ? 20 : st < 3 ? 10 : -st * 2;
  const sseReward = sse < 0.5 ? 25 : sse < 2 ? 15 : sse < 5 ? 5 : -sse;
  const riseReward = rt < 0.5 ? 15 : rt < 1 ? 10 : rt < 2 ? 5 : 0;
  return overshootPenalty + settlingReward + sseReward + riseReward;
}

// ══════════════════════════════════════════════════════════════════════
//  NEURAL NETWORK
// ══════════════════════════════════════════════════════════════════════
function randomGaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

class PolicyNetwork {
  constructor(layerSizes = [4, 32, 16, 3]) {
    this.layers = layerSizes;
    this.weights = [];
    this.biases = [];
    for (let i = 0; i < layerSizes.length - 1; i++) {
      const scale = Math.sqrt(2.0 / layerSizes[i]);
      const w = [];
      for (let r = 0; r < layerSizes[i]; r++) {
        const row = [];
        for (let c = 0; c < layerSizes[i + 1]; c++) row.push(randomGaussian() * scale);
        w.push(row);
      }
      this.weights.push(w);
      this.biases.push(new Array(layerSizes[i + 1]).fill(0));
    }
  }
  forward(input) {
    let x = [...input];
    for (let l = 0; l < this.weights.length; l++) {
      const w = this.weights[l], b = this.biases[l];
      const out = new Array(b.length).fill(0);
      for (let j = 0; j < b.length; j++) {
        let sum = b[j];
        for (let i = 0; i < x.length; i++) sum += x[i] * w[i][j];
        out[j] = l < this.weights.length - 1 ? Math.max(0, sum) : sum;
      }
      x = out;
    }
    return x.map(v => 1.0 / (1.0 + Math.exp(-v)));
  }
  getFlat() {
    const flat = [];
    for (let l = 0; l < this.weights.length; l++) {
      for (const row of this.weights[l]) for (const v of row) flat.push(v);
      for (const v of this.biases[l]) flat.push(v);
    }
    return flat;
  }
  setFlat(flat) {
    let idx = 0;
    for (let l = 0; l < this.weights.length; l++) {
      for (let r = 0; r < this.weights[l].length; r++)
        for (let c = 0; c < this.weights[l][r].length; c++)
          this.weights[l][r][c] = flat[idx++];
      for (let j = 0; j < this.biases[l].length; j++) this.biases[l][j] = flat[idx++];
    }
  }
  clone() { const nn = new PolicyNetwork(this.layers); nn.setFlat(this.getFlat()); return nn; }
}

// ══════════════════════════════════════════════════════════════════════
//  EVOLUTION STRATEGY
// ══════════════════════════════════════════════════════════════════════
const PID_MAX = { Kp: 50, Ki: 30, Kd: 15 };
function normalizeInput(p) { return [p.J / 50, p.B / 5, p.loadTorque / 50, p.targetSpeed / 300]; }
function decodePID(raw) {
  return { Kp: parseFloat((raw[0] * PID_MAX.Kp).toFixed(2)), Ki: parseFloat((raw[1] * PID_MAX.Ki).toFixed(2)), Kd: parseFloat((raw[2] * PID_MAX.Kd).toFixed(2)) };
}

function runESGeneration(policy, motorParams, popSize, sigma) {
  const baseParams = policy.getFlat();
  const n = baseParams.length;
  const noises = [], rewards = [], candidates = [];
  for (let i = 0; i < popSize; i++) {
    const noise = new Array(n).fill(0).map(() => randomGaussian());
    const perturbed = baseParams.map((p, j) => p + sigma * noise[j]);
    const tp = policy.clone(); tp.setFlat(perturbed);
    const pid = decodePID(tp.forward(normalizeInput(motorParams)));
    const reward = computeReward(motorParams, pid);
    noises.push(noise); rewards.push(reward); candidates.push({ pid, reward });
  }
  const indices = rewards.map((_, i) => i).sort((a, b) => rewards[b] - rewards[a]);
  const shaped = new Array(popSize).fill(0);
  for (let rank = 0; rank < popSize; rank++)
    shaped[indices[rank]] = Math.max(0, Math.log(popSize / 2 + 1) - Math.log(rank + 1));
  const ss = shaped.reduce((a, b) => a + b, 0) || 1;
  const norm = shaped.map(s => s / ss - 1 / popSize);
  const grad = new Array(n).fill(0);
  for (let i = 0; i < popSize; i++) for (let j = 0; j < n; j++) grad[j] += norm[i] * noises[i][j];
  policy.setFlat(baseParams.map((p, j) => p + (0.05 / sigma) * grad[j]));
  return {
    bestReward: rewards[indices[0]],
    avgReward: rewards.reduce((a, b) => a + b, 0) / popSize,
    bestPID: candidates[indices[0]].pid,
    candidates: candidates.sort((a, b) => b.reward - a.reward).slice(0, 8),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  PRESETS
// ══════════════════════════════════════════════════════════════════════
const PRESETS = {
  rolling_mill: { label: "Rolling Mill Drive", subtitle: "ABB ACS880 · Heavy Load", icon: "⚙", params: { J: 12, B: 0.8, loadTorque: 15, targetSpeed: 150 }, pid: { Kp: 20, Ki: 8, Kd: 3 } },
  conveyor: { label: "Conveyor Belt", subtitle: "ABB ACS480 · Medium Duty", icon: "⛓", params: { J: 3, B: 0.3, loadTorque: 5, targetSpeed: 60 }, pid: { Kp: 10, Ki: 5, Kd: 1.5 } },
  downcoiler: { label: "Downcoiler Motor", subtitle: "High Inertia · Speed Sync", icon: "⊚", params: { J: 25, B: 1.2, loadTorque: 30, targetSpeed: 200 }, pid: { Kp: 35, Ki: 12, Kd: 5 } },
  pump: { label: "Pump Drive", subtitle: "Low Inertia · Smooth", icon: "◎", params: { J: 0.5, B: 0.1, loadTorque: 1, targetSpeed: 30 }, pid: { Kp: 5, Ki: 3, Kd: 0.5 } },
};

// ══════════════════════════════════════════════════════════════════════
//  UI PRIMITIVES
// ══════════════════════════════════════════════════════════════════════
const mono = "'JetBrains Mono', 'DM Mono', 'Fira Code', monospace";
const display = "'Space Grotesk', 'Inter', sans-serif";
const C = {
  bg: "#0b0b09", panel: "#111110", card: "#161614", border: "#1e1e1b", borderLight: "#2a2a25",
  gold: "#d4a843", goldDim: "#d4a84355", green: "#4ead5b", red: "#c94a4a", blue: "#4a9ed4", orange: "#d4864a",
  text: "#c8c8b8", textDim: "#7a7a6a", textMuted: "#4a4a3e", textFaint: "#2e2e28",
};

function Slider({ label, value, onChange, min, max, step, unit, color, disabled }) {
  const pct = ((value - min) / (max - min)) * 100;
  const c = disabled ? C.textMuted : (color || C.gold);
  return (
    <div style={{ marginBottom: 14, opacity: disabled ? 0.45 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: mono, color: c, fontWeight: 600 }}>
          {value}{unit && <span style={{ fontSize: 9, color: C.textMuted, marginLeft: 3 }}>{unit}</span>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", height: 3, appearance: "none", background: `linear-gradient(to right, ${c} 0%, ${c} ${pct}%, ${C.border} ${pct}%, ${C.border} 100%)`, borderRadius: 2, outline: "none", cursor: disabled ? "not-allowed" : "pointer" }}
      />
    </div>
  );
}

function Metric({ label, value, unit, status }) {
  const sc = status === "good" ? C.green : status === "warn" ? C.gold : status === "bad" ? C.red : C.textDim;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", flex: 1, minWidth: 85 }}>
      <div style={{ fontSize: 9, fontFamily: mono, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontFamily: mono, color: sc, fontWeight: 700, lineHeight: 1 }}>
        {value}<span style={{ fontSize: 9, color: C.textMuted, marginLeft: 2, fontWeight: 400 }}>{unit}</span>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: `${C.panel}f0`, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "8px 12px", fontFamily: mono, fontSize: 10, backdropFilter: "blur(8px)" }}>
      <div style={{ color: C.textMuted, marginBottom: 4 }}>t = {label}s</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color, marginBottom: 1 }}>{p.name}: {p.value}</div>)}
    </div>
  );
}

function ScatterTip({ active, payload }) {
  if (!active || !payload?.[0]?.payload) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: `${C.panel}f0`, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "8px 12px", fontFamily: mono, fontSize: 10, backdropFilter: "blur(8px)" }}>
      <div style={{ color: C.gold }}>Kp: {d.Kp} · Ki: {d.Ki} · Kd: {d.Kd}</div>
      <div style={{ color: C.green }}>Reward: {d.reward}</div>
      <div style={{ color: C.textMuted }}>Generation {d.gen}</div>
    </div>
  );
}

function EmptyChart({ message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", border: `2px dashed ${C.borderLight}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 16, color: C.textMuted }}>◈</span>
      </div>
      <span style={{ fontFamily: mono, fontSize: 11, color: C.textMuted }}>{message}</span>
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span>{children}</span>
      {right && <span style={{ fontSize: 8, padding: "2px 6px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, color: C.textMuted }}>{right}</span>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN APPLICATION
// ══════════════════════════════════════════════════════════════════════
export default function MotorControlTuner() {
  const [mode, setMode] = useState("manual");
  const [params, setParams] = useState(PRESETS.rolling_mill.params);
  const [pid, setPid] = useState(PRESETS.rolling_mill.pid);
  const [activePreset, setActivePreset] = useState("rolling_mill");
  const [activeTab, setActiveTab] = useState("response");
  const [showComparison, setShowComparison] = useState(false);
  const [savedRun, setSavedRun] = useState(null);
  const [duration, setDuration] = useState(5);
  const [showInfo, setShowInfo] = useState(false);

  const [rlStatus, setRlStatus] = useState("idle");
  const [rlGeneration, setRlGeneration] = useState(0);
  const [rlHistory, setRlHistory] = useState([]);
  const [rlBestPID, setRlBestPID] = useState(null);
  const [rlBestReward, setRlBestReward] = useState(-Infinity);
  const [rlExploration, setRlExploration] = useState([]);
  const [rlPopSize, setRlPopSize] = useState(30);
  const [rlSigma, setRlSigma] = useState(0.1);
  const [rlMaxGen, setRlMaxGen] = useState(80);
  const [manualPidBeforeRL, setManualPidBeforeRL] = useState(null);

  const policyRef = useRef(null);
  const trainingRef = useRef(false);
  const animRef = useRef(null);

  const activePID = mode === "rl" && rlBestPID ? rlBestPID : pid;
  const result = useMemo(() => simulateMotor(params, activePID, 0.002, duration), [params, activePID, duration]);
  const manualResult = useMemo(() => manualPidBeforeRL ? simulateMotor(params, manualPidBeforeRL, 0.002, duration) : null, [params, manualPidBeforeRL, duration]);

  const chartData = useMemo(() => {
    if (mode === "rl" && manualResult && showComparison)
      return result.data.map((d, i) => ({ ...d, manualSpeed: manualResult.data[i]?.speed ?? null }));
    if (mode === "manual" && showComparison && savedRun)
      return result.data.map((d, i) => ({ ...d, savedSpeed: savedRun.data[i]?.speed ?? null }));
    return result.data;
  }, [result, mode, showComparison, savedRun, manualResult]);

  const applyPreset = (key) => { setActivePreset(key); setParams({ ...PRESETS[key].params }); setPid({ ...PRESETS[key].pid }); resetRL(); };

  const resetRL = () => {
    trainingRef.current = false;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setRlStatus("idle"); setRlGeneration(0); setRlHistory([]); setRlBestPID(null);
    setRlBestReward(-Infinity); setRlExploration([]); setManualPidBeforeRL(null); policyRef.current = null;
  };

  const startTraining = () => {
    setManualPidBeforeRL({ ...pid }); setShowComparison(true);
    policyRef.current = new PolicyNetwork([4, 32, 16, 3]);
    setRlStatus("training"); setRlGeneration(0); setRlHistory([]);
    setRlBestPID(null); setRlBestReward(-Infinity); setRlExploration([]);
    trainingRef.current = true;
    let gen = 0, bestOverall = -Infinity, bestPIDOverall = null;
    const history = [], exploration = [];
    const step = () => {
      if (!trainingRef.current || gen >= rlMaxGen) { trainingRef.current = false; setRlStatus("done"); return; }
      const res = runESGeneration(policyRef.current, params, rlPopSize, rlSigma);
      gen++;
      if (res.bestReward > bestOverall) { bestOverall = res.bestReward; bestPIDOverall = { ...res.bestPID }; }
      history.push({ gen, bestReward: parseFloat(res.bestReward.toFixed(2)), avgReward: parseFloat(res.avgReward.toFixed(2)), overallBest: parseFloat(bestOverall.toFixed(2)) });
      res.candidates.forEach(c => exploration.push({ Kp: c.pid.Kp, Ki: c.pid.Ki, Kd: c.pid.Kd, reward: parseFloat(c.reward.toFixed(1)), gen }));
      setRlGeneration(gen); setRlHistory([...history]);
      setRlBestPID(bestPIDOverall ? { ...bestPIDOverall } : null);
      setRlBestReward(bestOverall); setRlExploration([...exploration.slice(-250)]);
      animRef.current = requestAnimationFrame(() => setTimeout(step, 8));
    };
    animRef.current = requestAnimationFrame(() => setTimeout(step, 50));
  };

  const stopTraining = () => { trainingRef.current = false; setRlStatus("done"); };
  const applyRLGains = () => { if (rlBestPID) { setPid({ ...rlBestPID }); setMode("manual"); } };
  const getOS = v => parseFloat(v) < 5 ? "good" : parseFloat(v) < 20 ? "warn" : "bad";
  const getST = v => parseFloat(v) < 1.5 ? "good" : parseFloat(v) < 3 ? "warn" : "bad";
  const getSSE = v => parseFloat(v) < 1 ? "good" : parseFloat(v) < 5 ? "warn" : "bad";
  const manualReward = useMemo(() => computeReward(params, pid).toFixed(1), [params, pid]);

  const tabList = [
    { key: "response", label: "Step Response" },
    { key: "error", label: "Error" },
    { key: "control", label: "Control" },
    ...(mode === "rl" ? [{ key: "training", label: "Training" }, { key: "explore", label: "Exploration" }] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');
        input[type="range"]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:${C.gold};border:3px solid ${C.bg};cursor:pointer;box-shadow:0 0 10px ${C.goldDim}}
        input[type="range"]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:${C.gold};border:3px solid ${C.bg};cursor:pointer}
        .btn{transition:all .2s ease;cursor:pointer;user-select:none}.btn:hover{transform:translateY(-1px);filter:brightness(1.1)}.btn:active{transform:translateY(0)}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
      `}</style>

      {/* ═══ HEADER ═══════════════════════════════════════════════ */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", background: `${C.panel}cc`, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(135deg, ${C.gold}22, ${C.gold}08)`, border: `1px solid ${C.gold}33`,
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke={C.gold} strokeWidth="1.5" />
                <circle cx="8" cy="8" r="2" fill={C.gold} />
                <line x1="8" y1="2" x2="8" y2="4" stroke={C.gold} strokeWidth="1.5" />
                <line x1="14" y1="8" x2="12" y2="8" stroke={C.gold} strokeWidth="1.5" />
                <line x1="8" y1="14" x2="8" y2="12" stroke={C.gold} strokeWidth="1.5" />
                <line x1="2" y1="8" x2="4" y2="8" stroke={C.gold} strokeWidth="1.5" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: 15, fontFamily: display, fontWeight: 700, color: "#eaeada", margin: 0, letterSpacing: "-0.03em" }}>
                Motor Control Tuner
              </h1>
              <p style={{ fontSize: 10, fontFamily: mono, color: C.textMuted, margin: 0 }}>
                PID Optimization with Reinforcement Learning
              </p>
            </div>
          </div>

          {/* Mode Toggle */}
          <div style={{ display: "flex", background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden", marginLeft: 8 }}>
            {[["manual", "Manual Tune"], ["rl", "RL Agent"]].map(([m, lb]) => (
              <button key={m} onClick={() => { setMode(m); if (m === "rl" && !["training", "explore"].includes(activeTab)) setActiveTab("response"); }} className="btn" style={{
                background: mode === m ? (m === "rl" ? `${C.gold}15` : `${C.text}08`) : "transparent",
                border: "none", padding: "6px 16px",
                fontFamily: mono, fontSize: 10, letterSpacing: "0.05em", fontWeight: mode === m ? 600 : 400,
                color: mode === m ? (m === "rl" ? C.gold : C.text) : C.textMuted,
                borderRight: m === "manual" ? `1px solid ${C.border}` : "none",
              }}>{lb}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Status Indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: rlStatus === "training" ? C.gold : C.green,
              boxShadow: `0 0 8px ${rlStatus === "training" ? C.goldDim : C.green}66`,
              animation: rlStatus === "training" ? "pulse 1.2s infinite" : "none",
            }} />
            <span style={{ fontSize: 9, fontFamily: mono, color: C.textMuted }}>
              {rlStatus === "training" ? `Training · Gen ${rlGeneration}` : "Ready"}
            </span>
          </div>
          {/* Info Button */}
          <button className="btn" onClick={() => setShowInfo(!showInfo)} style={{
            background: showInfo ? `${C.gold}15` : "transparent", border: `1px solid ${showInfo ? C.gold + "44" : C.border}`,
            borderRadius: 6, padding: "4px 10px", fontFamily: mono, fontSize: 10, color: showInfo ? C.gold : C.textDim, cursor: "pointer",
          }}>?</button>
        </div>
      </div>

      {/* ═══ INFO PANEL ═══════════════════════════════════════════ */}
      {showInfo && (
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: "16px 24px", background: `${C.card}ee`, display: "flex", gap: 32, fontFamily: mono, fontSize: 10, lineHeight: 1.7 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.gold, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>About</div>
            <div style={{ color: C.textDim }}>
              Interactive DC motor PID tuner with an AI-powered auto-tuning agent. The simulator solves J·dω/dt + B·ω = u(t) − T<sub>load</sub> numerically, with a full PID controller: u(t) = Kp·e + Ki·∫e·dt + Kd·de/dt.
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.gold, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>RL Agent</div>
            <div style={{ color: C.textDim }}>
              The auto-tuner uses an Evolution Strategy (OpenAI-ES) with a 4→32→16→3 neural policy network. Rank-based fitness shaping guides the population toward optimal PID gains, evaluated against a composite reward of overshoot, settling time, rise time, and steady-state error.
            </div>
          </div>
          <div style={{ flex: 0.6 }}>
            <div style={{ color: C.gold, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>Built By</div>
            <div style={{ color: C.textDim }}>
              Egemen Birol<br />
              EE Engineer · M.Sc. AI<br />
              <span style={{ color: C.textMuted }}>Industrial Automation × AI</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MAIN LAYOUT ══════════════════════════════════════════ */}
      <div style={{ display: "flex", height: showInfo ? "calc(100vh - 125px)" : "calc(100vh - 54px)" }}>

        {/* ─── LEFT PANEL ──────────────────────────────────── */}
        <div style={{ width: 300, minWidth: 300, borderRight: `1px solid ${C.border}`, padding: "18px 20px", overflowY: "auto", background: `${C.panel}88` }}>

          {/* Presets */}
          <div style={{ marginBottom: 20 }}>
            <SectionLabel>Presets</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {Object.entries(PRESETS).map(([key, p]) => (
                <button key={key} className="btn" onClick={() => applyPreset(key)} style={{
                  background: activePreset === key ? `${C.gold}0d` : "transparent",
                  border: `1px solid ${activePreset === key ? C.gold + "55" : C.border}`,
                  borderRadius: 8, padding: "8px 10px", textAlign: "left",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 12, opacity: activePreset === key ? 1 : 0.4 }}>{p.icon}</span>
                    <span style={{ fontSize: 10, fontFamily: display, fontWeight: 600, color: activePreset === key ? C.gold : C.textDim }}>{p.label}</span>
                  </div>
                  <div style={{ fontSize: 8, fontFamily: mono, color: C.textMuted, marginTop: 2, marginLeft: 17 }}>{p.subtitle}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Motor Parameters */}
          <div style={{ marginBottom: 20 }}>
            <SectionLabel>Motor Parameters</SectionLabel>
            <Slider label="Inertia (J)" value={params.J} onChange={v => { setParams(p => ({ ...p, J: v })); if (mode === "rl") resetRL(); }} min={0.1} max={50} step={0.1} unit="kg·m²" />
            <Slider label="Damping (B)" value={params.B} onChange={v => { setParams(p => ({ ...p, B: v })); if (mode === "rl") resetRL(); }} min={0} max={5} step={0.05} unit="N·m·s" />
            <Slider label="Load Torque" value={params.loadTorque} onChange={v => { setParams(p => ({ ...p, loadTorque: v })); if (mode === "rl") resetRL(); }} min={0} max={50} step={0.5} unit="N·m" />
            <Slider label="Target Speed" value={params.targetSpeed} onChange={v => { setParams(p => ({ ...p, targetSpeed: v })); if (mode === "rl") resetRL(); }} min={10} max={300} step={5} unit="RPM" />
          </div>

          {/* ─── MODE-SPECIFIC CONTROLS ─────────────────── */}
          {mode === "manual" ? (
            <>
              <div style={{ marginBottom: 18 }}>
                <SectionLabel right="MANUAL">PID Gains</SectionLabel>
                <Slider label="Kp (Proportional)" value={pid.Kp} onChange={v => setPid(p => ({ ...p, Kp: v }))} min={0} max={50} step={0.5} unit="" color={C.gold} />
                <Slider label="Ki (Integral)" value={pid.Ki} onChange={v => setPid(p => ({ ...p, Ki: v }))} min={0} max={30} step={0.5} unit="" color={C.blue} />
                <Slider label="Kd (Derivative)" value={pid.Kd} onChange={v => setPid(p => ({ ...p, Kd: v }))} min={0} max={15} step={0.1} unit="" color={C.orange} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <Slider label="Simulation Duration" value={duration} onChange={setDuration} min={1} max={15} step={0.5} unit="sec" color={C.textDim} />
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <button className="btn" onClick={() => { setSavedRun({ data: [...result.data], metrics: { ...result.metrics } }); setShowComparison(true); }}
                  style={{ flex: 1, padding: "8px 0", background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, color: C.textDim, fontFamily: mono, fontSize: 10, fontWeight: 500 }}>
                  Snapshot
                </button>
                <button className="btn" onClick={() => { setShowComparison(false); setSavedRun(null); }}
                  style={{ flex: 1, padding: "8px 0", background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, color: C.textMuted, fontFamily: mono, fontSize: 10 }}>
                  Clear
                </button>
              </div>
              {showComparison && savedRun && (
                <div style={{ padding: "6px 10px", border: `1px dashed ${C.borderLight}`, borderRadius: 6, fontSize: 9, fontFamily: mono, color: C.textMuted, marginBottom: 10 }}>
                  Snapshot active — shown as dashed line
                </div>
              )}
              <div style={{ padding: "8px 10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 10, fontFamily: mono, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: C.textMuted }}>Reward Score</span>
                <span style={{ color: parseFloat(manualReward) > 60 ? C.green : parseFloat(manualReward) > 20 ? C.gold : C.red, fontWeight: 700, fontSize: 14 }}>{manualReward}</span>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <SectionLabel right={rlStatus === "idle" ? "READY" : rlStatus === "training" ? "ACTIVE" : "DONE"}>RL Auto-Tuner</SectionLabel>

                {/* Algorithm Card */}
                <div style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 14, fontSize: 9, fontFamily: mono, color: C.textDim, lineHeight: 1.7 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
                    <span style={{ color: C.gold }}>Algorithm</span><span>Evolution Strategy</span>
                    <span style={{ color: C.gold }}>Network</span><span>4 → 32 → 16 → 3</span>
                    <span style={{ color: C.gold }}>Selection</span><span>Rank-Based Fitness Shaping</span>
                    <span style={{ color: C.gold }}>Objective</span><span>Composite Reward</span>
                  </div>
                </div>

                <Slider label="Population" value={rlPopSize} onChange={setRlPopSize} min={10} max={60} step={5} unit="" color={C.gold} disabled={rlStatus === "training"} />
                <Slider label="Mutation σ" value={rlSigma} onChange={setRlSigma} min={0.01} max={0.5} step={0.01} unit="" color={C.gold} disabled={rlStatus === "training"} />
                <Slider label="Generations" value={rlMaxGen} onChange={setRlMaxGen} min={20} max={200} step={10} unit="" color={C.gold} disabled={rlStatus === "training"} />
              </div>

              {/* Train Button */}
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {rlStatus !== "training" ? (
                  <button className="btn" onClick={startTraining} style={{
                    flex: 1, padding: "10px 0",
                    background: `linear-gradient(135deg, ${C.gold}20, ${C.gold}08)`,
                    border: `1px solid ${C.gold}88`, borderRadius: 8, color: C.gold,
                    fontFamily: mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.03em",
                  }}>{rlStatus === "done" ? "Retrain" : "Train Agent"}</button>
                ) : (
                  <button className="btn" onClick={stopTraining} style={{
                    flex: 1, padding: "10px 0", background: `${C.red}12`,
                    border: `1px solid ${C.red}66`, borderRadius: 8, color: C.red,
                    fontFamily: mono, fontSize: 11, fontWeight: 600,
                  }}>Stop</button>
                )}
                <button className="btn" onClick={resetRL} style={{
                  padding: "10px 14px", background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 8, color: C.textMuted, fontFamily: mono, fontSize: 11,
                }}>↺</button>
              </div>

              {/* Progress */}
              {rlStatus !== "idle" && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${(rlGeneration / rlMaxGen) * 100}%`,
                      background: rlStatus === "training" ? `linear-gradient(90deg, ${C.gold}, ${C.green})` : C.green,
                      borderRadius: 2, transition: "width 0.3s",
                    }} />
                  </div>
                  <div style={{ fontSize: 9, fontFamily: mono, color: C.textMuted, marginTop: 4, textAlign: "center" }}>
                    {rlGeneration} / {rlMaxGen} generations · {(rlGeneration * rlPopSize).toLocaleString()} evaluations
                  </div>
                </div>
              )}

              {/* Best Gains */}
              {rlBestPID && (
                <div style={{ padding: "12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, fontFamily: mono, color: C.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Optimized Gains</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["Kp", C.gold], ["Ki", C.blue], ["Kd", C.orange]].map(([k, c]) => (
                      <div key={k} style={{ flex: 1, textAlign: "center", padding: "6px 4px", background: C.bg, borderRadius: 6, border: `1px solid ${c}22` }}>
                        <div style={{ fontSize: 8, color: C.textMuted, fontFamily: mono }}>{k}</div>
                        <div style={{ fontSize: 16, color: c, fontFamily: mono, fontWeight: 700 }}>{rlBestPID[k]}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 9, fontFamily: mono }}>
                    <span style={{ color: C.textMuted }}>Reward <span style={{ color: C.green, fontWeight: 600 }}>{rlBestReward.toFixed(1)}</span></span>
                    <span style={{ color: C.textMuted }}>Gen {rlGeneration}</span>
                  </div>
                  {rlStatus === "done" && (
                    <button className="btn" onClick={applyRLGains} style={{
                      width: "100%", marginTop: 10, padding: "8px",
                      background: `${C.green}15`, border: `1px solid ${C.green}66`,
                      borderRadius: 6, color: C.green,
                      fontFamily: mono, fontSize: 10, fontWeight: 600,
                    }}>Apply to Manual Mode</button>
                  )}
                </div>
              )}

              {/* Comparison */}
              {manualPidBeforeRL && rlBestPID && (
                <div style={{ padding: "10px 12px", background: C.bg, border: `1px dashed ${C.borderLight}`, borderRadius: 8, fontSize: 9, fontFamily: mono }}>
                  <div style={{ color: C.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.1em" }}>Manual vs RL</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: C.textMuted, marginBottom: 3 }}>Manual</div>
                      {["Kp", "Ki", "Kd"].map(k => <div key={k} style={{ color: C.textDim }}>{k}: {manualPidBeforeRL[k]}</div>)}
                      <div style={{ color: C.textDim, marginTop: 3 }}>R: {computeReward(params, manualPidBeforeRL).toFixed(1)}</div>
                    </div>
                    <div style={{ width: 1, background: C.border }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: `${C.gold}88`, marginBottom: 3 }}>RL Agent</div>
                      {["Kp", "Ki", "Kd"].map(k => <div key={k} style={{ color: C.gold }}>{k}: {rlBestPID[k]}</div>)}
                      <div style={{ color: C.green, marginTop: 3 }}>R: {rlBestReward.toFixed(1)}</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── RIGHT PANEL ─────────────────────────────────── */}
        <div style={{ flex: 1, padding: "18px 24px", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Metrics */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <Metric label="Overshoot" value={result.metrics.overshoot} unit="%" status={getOS(result.metrics.overshoot)} />
            <Metric label="Settling" value={result.metrics.settlingTime} unit="s" status={getST(result.metrics.settlingTime)} />
            <Metric label="Rise Time" value={result.metrics.riseTime} unit="s" status="good" />
            <Metric label="SS Error" value={result.metrics.steadyStateError} unit="RPM" status={getSSE(result.metrics.steadyStateError)} />
            <Metric label="Peak" value={result.metrics.peakSpeed} unit="RPM" status={parseFloat(result.metrics.peakSpeed) > params.targetSpeed * 1.3 ? "bad" : "good"} />
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 14 }}>
            {tabList.map(tab => (
              <button key={tab.key} className="btn" onClick={() => setActiveTab(tab.key)} style={{
                background: "transparent", border: "none",
                borderBottom: `2px solid ${activeTab === tab.key ? C.gold : "transparent"}`,
                padding: "7px 16px", fontFamily: mono, fontSize: 10, fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? C.gold : C.textMuted, letterSpacing: "0.04em",
              }}>{tab.label}</button>
            ))}
          </div>

          {/* Chart */}
          <div style={{
            flex: 1, background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: "16px 12px 10px 10px", minHeight: 280,
            position: "relative", overflow: "hidden",
          }}>
            {/* Training scanline */}
            {rlStatus === "training" && (
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent 0%, ${C.gold} 50%, transparent 100%)`, backgroundSize: "200% 100%", animation: "gradient 2s ease infinite", zIndex: 2 }} />
            )}

            <ResponsiveContainer width="100%" height="100%">
              {activeTab === "response" ? (
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="time" stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} label={{ value: "Time (s)", position: "insideBottom", offset: -2, style: { fontSize: 10, fill: C.textMuted, fontFamily: "JetBrains Mono" } }} />
                  <YAxis stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} label={{ value: "Speed (RPM)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: C.textMuted, fontFamily: "JetBrains Mono" } }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={params.targetSpeed} stroke={C.gold} strokeDasharray="8 4" strokeOpacity={0.25} />
                  <ReferenceLine y={params.targetSpeed * 1.02} stroke={C.green} strokeDasharray="2 4" strokeOpacity={0.12} />
                  <ReferenceLine y={params.targetSpeed * 0.98} stroke={C.green} strokeDasharray="2 4" strokeOpacity={0.12} />
                  <Line type="monotone" dataKey="target" stroke={`${C.gold}25`} strokeWidth={1} dot={false} name="Target" />
                  <Line type="monotone" dataKey="speed" stroke={mode === "rl" && rlBestPID ? C.green : C.gold} strokeWidth={2.5} dot={false} name={mode === "rl" && rlBestPID ? "RL Agent" : "Speed"} isAnimationActive={false} />
                  {mode === "rl" && showComparison && manualResult && <Line type="monotone" dataKey="manualSpeed" stroke={C.textDim} strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Manual" isAnimationActive={false} />}
                  {mode === "manual" && showComparison && savedRun && <Line type="monotone" dataKey="savedSpeed" stroke={C.textDim} strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Snapshot" isAnimationActive={false} />}
                </ComposedChart>
              ) : activeTab === "error" ? (
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="time" stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <YAxis stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke={`${C.green}33`} />
                  <Line type="monotone" dataKey="error" stroke={C.red} strokeWidth={2} dot={false} name="Error" isAnimationActive={false} />
                </ComposedChart>
              ) : activeTab === "control" ? (
                <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="time" stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <YAxis stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="control" stroke={C.blue} strokeWidth={2} dot={false} name="Control" isAnimationActive={false} />
                </ComposedChart>
              ) : activeTab === "training" ? (
                rlHistory.length > 0 ? (
                  <ComposedChart data={rlHistory} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="gen" stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} label={{ value: "Generation", position: "insideBottom", offset: -2, style: { fontSize: 10, fill: C.textMuted, fontFamily: "JetBrains Mono" } }} />
                    <YAxis stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} label={{ value: "Reward", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: C.textMuted, fontFamily: "JetBrains Mono" } }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="avgReward" stroke={C.textMuted} strokeWidth={1} dot={false} name="Population Avg" isAnimationActive={false} />
                    <Line type="monotone" dataKey="overallBest" stroke={C.green} strokeWidth={2} dot={false} name="Best Overall" isAnimationActive={false} />
                    <Line type="monotone" dataKey="bestReward" stroke={`${C.gold}44`} strokeWidth={1} dot={false} name="Gen Best" isAnimationActive={false} />
                  </ComposedChart>
                ) : <EmptyChart message="Start training to see learning curve" />
              ) : activeTab === "explore" ? (
                rlExploration.length > 0 ? (
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 5, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="Kp" stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} name="Kp" type="number" domain={["auto", "auto"]} label={{ value: "Kp", position: "insideBottom", offset: -2, style: { fontSize: 10, fill: C.textMuted, fontFamily: "JetBrains Mono" } }} />
                    <YAxis dataKey="Ki" stroke={C.textMuted} tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} name="Ki" type="number" domain={["auto", "auto"]} label={{ value: "Ki", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: C.textMuted, fontFamily: "JetBrains Mono" } }} />
                    <ZAxis dataKey="reward" range={[20, 80]} />
                    <Tooltip content={<ScatterTip />} />
                    <Scatter data={rlExploration} name="Explored">
                      {rlExploration.map((e, i) => (
                        <Cell key={i} fill={e.reward > 60 ? C.green : e.reward > 20 ? C.gold : e.reward > -20 ? C.orange : C.red} fillOpacity={Math.min(0.25 + (e.gen / rlMaxGen) * 0.75, 1)} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                ) : <EmptyChart message="Start training to see exploration map" />
              ) : null}
            </ResponsiveContainer>
          </div>

          {/* Footer */}
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 9, fontFamily: mono, color: C.textFaint }}>
              DC Motor Model · PID Controller · {mode === "rl" ? "Evolution Strategy (OpenAI-ES)" : "Manual Tuning"}
            </div>
            <div style={{ fontSize: 9, fontFamily: mono, color: C.textFaint }}>
              egemenbirol5@gmail.com
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
