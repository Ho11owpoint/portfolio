import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, ComposedChart, BarChart, Bar, Cell } from "recharts";

// ══════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0e1117", panel: "#151920", card: "#1a1f28", border: "#242b36", borderLight: "#2e3744",
  green: "#34d399", greenDim: "#34d39933", greenBg: "#34d39912",
  gold: "#f0b429", goldDim: "#f0b42933", goldBg: "#f0b42912",
  red: "#f87171", redDim: "#f8717133", redBg: "#f8717112",
  blue: "#60a5fa", blueDim: "#60a5fa33", blueBg: "#60a5fa12",
  cyan: "#22d3ee", purple: "#a78bfa", orange: "#fb923c",
  text: "#e2e8f0", textSoft: "#94a3b8", textDim: "#64748b", textMuted: "#475569", textFaint: "#334155",
};
const mono = "'JetBrains Mono', 'Fira Code', monospace";
const heading = "'Syne', sans-serif";
const body = "'Outfit', sans-serif";

// ══════════════════════════════════════════════════════════════════════
//  SENSOR SIMULATION ENGINE
// ══════════════════════════════════════════════════════════════════════
function gaussianNoise(sigma = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
}

const MOTOR_PROFILES = {
  rolling_mill: {
    label: "Rolling Mill Drive",
    subtitle: "ABB ACS880 · 250kW",
    baselines: { vibration: 2.8, temperature: 65, current: 180, rpm: 1480 },
    limits: { vibration: [0, 15], temperature: [20, 120], current: [0, 350], rpm: [0, 1500] },
    warningThresholds: { vibration: 6.5, temperature: 85, current: 260 },
    criticalThresholds: { vibration: 10, temperature: 100, current: 310 },
    noiseLevel: { vibration: 0.3, temperature: 0.5, current: 4, rpm: 2 },
  },
  conveyor: {
    label: "Conveyor Drive",
    subtitle: "ABB ACS480 · 45kW",
    baselines: { vibration: 1.2, temperature: 45, current: 62, rpm: 1450 },
    limits: { vibration: [0, 10], temperature: [20, 90], current: [0, 120], rpm: [0, 1500] },
    warningThresholds: { vibration: 3.5, temperature: 65, current: 85 },
    criticalThresholds: { vibration: 6, temperature: 78, current: 105 },
    noiseLevel: { vibration: 0.15, temperature: 0.3, current: 2, rpm: 1.5 },
  },
  pump: {
    label: "Cooling Pump",
    subtitle: "Centrifugal · 15kW",
    baselines: { vibration: 0.8, temperature: 38, current: 28, rpm: 2950 },
    limits: { vibration: [0, 8], temperature: [20, 80], current: [0, 55], rpm: [0, 3000] },
    warningThresholds: { vibration: 2.5, temperature: 55, current: 40 },
    criticalThresholds: { vibration: 4.5, temperature: 68, current: 48 },
    noiseLevel: { vibration: 0.1, temperature: 0.2, current: 1, rpm: 3 },
  },
};

const FAULT_MODES = {
  none: { label: "Healthy", color: C.green },
  bearing: { label: "Bearing Wear", color: C.orange, affects: { vibration: 3.5, temperature: 1.8, current: 1.2 }, rateMultiplier: { vibration: 0.015, temperature: 0.008, current: 0.004 } },
  imbalance: { label: "Rotor Imbalance", color: C.gold, affects: { vibration: 4.0, temperature: 1.1, current: 1.5 }, rateMultiplier: { vibration: 0.02, temperature: 0.003, current: 0.006 } },
  overload: { label: "Overload", color: C.red, affects: { vibration: 1.3, temperature: 2.5, current: 2.2 }, rateMultiplier: { vibration: 0.005, temperature: 0.015, current: 0.012 } },
  misalignment: { label: "Shaft Misalignment", color: C.purple, affects: { vibration: 2.8, temperature: 1.5, current: 1.4 }, rateMultiplier: { vibration: 0.012, temperature: 0.006, current: 0.005 } },
};

function generateSensorReading(profile, faultMode, degradation, t) {
  const fault = FAULT_MODES[faultMode];
  const sensors = {};
  for (const key of ["vibration", "temperature", "current"]) {
    let base = profile.baselines[key];
    let noise = gaussianNoise(profile.noiseLevel[key]);
    // Cyclic variation
    let cyclic = Math.sin(t * 0.05) * profile.noiseLevel[key] * 0.5;
    // Fault contribution
    let faultContrib = 0;
    if (faultMode !== "none") {
      faultContrib = (fault.affects[key] - 1) * base * degradation;
    }
    sensors[key] = Math.max(profile.limits[key][0], Math.min(profile.limits[key][1], base + noise + cyclic + faultContrib));
  }
  sensors.rpm = profile.baselines.rpm + gaussianNoise(profile.noiseLevel.rpm);
  if (faultMode === "overload") sensors.rpm -= degradation * 30;
  sensors.rpm = Math.max(0, sensors.rpm);
  return sensors;
}

// ══════════════════════════════════════════════════════════════════════
//  ANOMALY DETECTION
// ══════════════════════════════════════════════════════════════════════
function computeStats(history, key) {
  if (history.length < 10) return { mean: 0, std: 1, zscore: 0 };
  const vals = history.slice(-60).map(h => h[key]);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) || 0.01;
  const latest = history[history.length - 1][key];
  return { mean, std, zscore: Math.abs((latest - mean) / std) };
}

function computeHealthScore(profile, sensors, history) {
  let score = 100;
  for (const key of ["vibration", "temperature", "current"]) {
    const val = sensors[key];
    const warn = profile.warningThresholds[key];
    const crit = profile.criticalThresholds[key];
    const base = profile.baselines[key];

    if (val >= crit) score -= 35;
    else if (val >= warn) score -= 15 * ((val - warn) / (crit - warn));
    else if (val > base * 1.3) score -= 5;

    const stats = computeStats(history, key);
    if (stats.zscore > 3) score -= 10;
    else if (stats.zscore > 2) score -= 4;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function estimateRUL(healthHistory) {
  if (healthHistory.length < 20) return null;
  const recent = healthHistory.slice(-30);
  if (recent.length < 5) return null;

  const n = recent.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += recent[i]; sumXY += i * recent[i]; sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  if (slope >= -0.05) return 999; // stable or improving

  const currentHealth = recent[recent.length - 1];
  const stepsToZero = Math.abs(currentHealth / slope);
  const hoursPerStep = 0.5;
  return Math.max(0, Math.round(stepsToZero * hoursPerStep));
}

function detectAnomalies(profile, sensors) {
  const anomalies = [];
  for (const key of ["vibration", "temperature", "current"]) {
    const val = sensors[key];
    if (val >= profile.criticalThresholds[key]) {
      anomalies.push({ sensor: key, level: "critical", value: val.toFixed(1), threshold: profile.criticalThresholds[key] });
    } else if (val >= profile.warningThresholds[key]) {
      anomalies.push({ sensor: key, level: "warning", value: val.toFixed(1), threshold: profile.warningThresholds[key] });
    }
  }
  return anomalies;
}

// ══════════════════════════════════════════════════════════════════════
//  UI COMPONENTS
// ══════════════════════════════════════════════════════════════════════
function HealthGauge({ score }) {
  const col = score >= 75 ? C.green : score >= 45 ? C.gold : C.red;
  const label = score >= 75 ? "HEALTHY" : score >= 45 ? "WARNING" : "CRITICAL";
  const circ = 2 * Math.PI * 52;
  const offset = circ - (score / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r="52" fill="none" stroke={C.border} strokeWidth="7" />
        <circle cx="65" cy="65" r="52" fill="none" stroke={col} strokeWidth="7"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 65 65)"
          style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.3s" }} />
        <text x="65" y="58" textAnchor="middle" fontFamily={mono} fontSize="30" fontWeight="700" fill={col}>{score}</text>
        <text x="65" y="78" textAnchor="middle" fontFamily={mono} fontSize="9" fill={C.textDim} letterSpacing="0.1em">{label}</text>
      </svg>
    </div>
  );
}

function SensorCard({ label, value, unit, baseline, warning, critical, icon }) {
  const numVal = parseFloat(value);
  const status = numVal >= critical ? "critical" : numVal >= warning ? "warning" : "normal";
  const col = status === "critical" ? C.red : status === "warning" ? C.gold : C.green;
  const bgCol = status === "critical" ? C.redBg : status === "warning" ? C.goldBg : C.greenBg;

  return (
    <div style={{
      background: C.card, border: `1px solid ${status !== "normal" ? col + "44" : C.border}`,
      borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 140,
      transition: "all 0.3s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
        <div style={{
          width: 8, height: 8, borderRadius: "50%", background: col,
          boxShadow: status !== "normal" ? `0 0 8px ${col}88` : "none",
          animation: status === "critical" ? "pulse 0.8s infinite" : "none",
        }} />
      </div>
      <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700, color: col, lineHeight: 1 }}>
        {value}
        <span style={{ fontSize: 11, color: C.textDim, marginLeft: 3, fontWeight: 400 }}>{unit}</span>
      </div>
      <div style={{ marginTop: 8, height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          width: `${Math.min(100, (numVal / critical) * 100)}%`,
          background: `linear-gradient(90deg, ${C.green}, ${numVal > warning ? C.gold : C.green}, ${numVal > critical * 0.9 ? C.red : C.gold})`,
          transition: "width 0.3s",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontFamily: mono, fontSize: 8, color: C.textMuted }}>
        <span>Base: {baseline}</span>
        <span>Warn: {warning}</span>
        <span>Crit: {critical}</span>
      </div>
    </div>
  );
}

function AlarmRow({ alarm, index }) {
  const col = alarm.level === "critical" ? C.red : C.gold;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
      background: index % 2 === 0 ? `${col}06` : "transparent",
      borderRadius: 4, fontSize: 10, fontFamily: mono,
    }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: col, flexShrink: 0 }} />
      <span style={{ color: C.textDim, minWidth: 44 }}>{alarm.time}</span>
      <span style={{ color: col, fontWeight: 600, minWidth: 50 }}>{alarm.level.toUpperCase()}</span>
      <span style={{ color: C.textSoft, flex: 1 }}>{alarm.sensor}: {alarm.value} {alarm.unit} (limit: {alarm.threshold})</span>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: `${C.panel}f5`, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "8px 12px", fontFamily: mono, fontSize: 10, backdropFilter: "blur(8px)" }}>
      <div style={{ color: C.textDim, marginBottom: 4 }}>t = {label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color, marginBottom: 1 }}>{p.name}: {typeof p.value === "number" ? p.value.toFixed(2) : p.value}</div>)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN APPLICATION
// ══════════════════════════════════════════════════════════════════════
export default function PredictiveMaintenance() {
  const [profile, setProfile] = useState("rolling_mill");
  const [faultMode, setFaultMode] = useState("none");
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [history, setHistory] = useState([]);
  const [healthHistory, setHealthHistory] = useState([]);
  const [alarms, setAlarms] = useState([]);
  const [activeChart, setActiveChart] = useState("vibration");
  const [showInfo, setShowInfo] = useState(false);

  const degradationRef = useRef(0);
  const tickRef = useRef(0);
  const intervalRef = useRef(null);

  const motor = MOTOR_PROFILES[profile];

  const reset = useCallback(() => {
    degradationRef.current = 0;
    tickRef.current = 0;
    setHistory([]);
    setHealthHistory([]);
    setAlarms([]);
  }, []);

  const changeProfile = (p) => {
    setProfile(p);
    reset();
  };

  const changeFault = (f) => {
    setFaultMode(f);
    degradationRef.current = 0;
  };

  useEffect(() => {
    if (!running) { if (intervalRef.current) clearInterval(intervalRef.current); return; }

    const interval = Math.max(50, 500 / speed);
    intervalRef.current = setInterval(() => {
      tickRef.current += 1;
      const t = tickRef.current;

      // Progress degradation
      if (faultMode !== "none") {
        const rate = FAULT_MODES[faultMode].rateMultiplier.vibration * speed;
        degradationRef.current = Math.min(1, degradationRef.current + rate);
      }

      const sensors = generateSensorReading(motor, faultMode, degradationRef.current, t);
      const reading = { t, ...sensors };

      setHistory(prev => {
        const next = [...prev, reading];
        return next.length > 200 ? next.slice(-200) : next;
      });

      // Health
      setHistory(prevH => {
        const health = computeHealthScore(motor, sensors, prevH.length > 0 ? prevH : [reading]);
        setHealthHistory(prevHH => {
          const next = [...prevHH, health];
          return next.length > 200 ? next.slice(-200) : next;
        });
        return prevH; // don't change, just read
      });

      // Alarms
      const anomalies = detectAnomalies(motor, sensors);
      if (anomalies.length > 0) {
        const minutes = Math.floor(t * 0.5);
        const timeStr = `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
        const units = { vibration: "mm/s", temperature: "°C", current: "A" };
        const newAlarms = anomalies.map(a => ({ time: timeStr, level: a.level, sensor: a.sensor, value: a.value, unit: units[a.sensor], threshold: a.threshold }));
        setAlarms(prev => [...newAlarms, ...prev].slice(0, 50));
      }
    }, interval);

    return () => clearInterval(intervalRef.current);
  }, [running, speed, motor, faultMode]);

  const latestSensors = history.length > 0 ? history[history.length - 1] : { vibration: 0, temperature: 0, current: 0, rpm: 0 };
  const currentHealth = healthHistory.length > 0 ? healthHistory[healthHistory.length - 1] : 100;
  const rul = estimateRUL(healthHistory);
  const degradePct = (degradationRef.current * 100).toFixed(0);

  const chartColors = { vibration: C.cyan, temperature: C.orange, current: C.blue, health: C.green };
  const chartUnits = { vibration: "mm/s", temperature: "°C", current: "A", health: "%" };

  const chartData = useMemo(() => {
    if (activeChart === "health") {
      return healthHistory.map((h, i) => ({ t: i, health: h }));
    }
    return history.map(h => ({ t: h.t, [activeChart]: h[activeChart] }));
  }, [history, healthHistory, activeChart]);

  const warningLine = activeChart !== "health" ? motor.warningThresholds[activeChart] : 45;
  const criticalLine = activeChart !== "health" ? motor.criticalThresholds[activeChart] : 25;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700&display=swap');
        .mbtn{transition:all .2s ease;cursor:pointer}.mbtn:hover{transform:translateY(-1px);filter:brightness(1.1)}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: `${C.panel}cc`, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: `${C.green}18`, border: `1px solid ${C.green}33` }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1v4M7 9v4M1 7h4M9 7h4" stroke={C.green} strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="7" cy="7" r="2" stroke={C.green} strokeWidth="1.5" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: 14, fontFamily: heading, fontWeight: 700, color: C.text, margin: 0 }}>Predictive Maintenance</h1>
              <p style={{ fontSize: 9, fontFamily: mono, color: C.textDim, margin: 0 }}>Real-Time Condition Monitoring & Failure Prediction</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button className="mbtn" onClick={() => setRunning(!running)} style={{
              background: running ? `${C.green}15` : `${C.red}15`,
              border: `1px solid ${running ? `${C.green}44` : `${C.red}44`}`,
              borderRadius: 6, padding: "5px 14px", fontFamily: mono, fontSize: 10, fontWeight: 600,
              color: running ? C.green : C.red,
            }}>{running ? "● LIVE" : "◼ PAUSED"}</button>
            <button className="mbtn" onClick={reset} style={{
              background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "5px 12px", fontFamily: mono, fontSize: 10, color: C.textDim,
            }}>↺ Reset</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>Speed: {speed}x</div>
          <input type="range" min="1" max="10" value={speed} onChange={e => setSpeed(parseInt(e.target.value))}
            style={{ width: 60, height: 3, appearance: "none", background: C.border, borderRadius: 2, outline: "none", cursor: "pointer", accentColor: C.green }} />
          <button className="mbtn" onClick={() => setShowInfo(!showInfo)} style={{
            background: showInfo ? `${C.gold}15` : "transparent", border: `1px solid ${showInfo ? C.gold + "44" : C.border}`,
            borderRadius: 6, padding: "4px 10px", fontFamily: mono, fontSize: 10, color: showInfo ? C.gold : C.textDim,
          }}>?</button>
          <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>Egemen Birol</div>
        </div>
      </div>

      {/* Info */}
      {showInfo && (
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: "14px 20px", background: `${C.card}ee`, display: "flex", gap: 28, fontFamily: mono, fontSize: 10, lineHeight: 1.7 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.green, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>About</div>
            <div style={{ color: C.textDim }}>Real-time condition monitoring dashboard for industrial motors. Simulates vibration, temperature, and current readings with configurable fault injection. The system detects anomalies using statistical methods and estimates remaining useful life from degradation trends.</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.green, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>Detection Engine</div>
            <div style={{ color: C.textDim }}>Health scoring combines threshold monitoring with z-score anomaly detection on a rolling 60-sample window. RUL is estimated by linear regression on the health trend, projecting time to critical failure. Each fault mode has its own degradation profile across all sensors.</div>
          </div>
          <div style={{ flex: 0.6 }}>
            <div style={{ color: C.green, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>Built By</div>
            <div style={{ color: C.textDim }}>Egemen Birol<br />EE Engineer, M.Sc. AI<br /><span style={{ color: C.textMuted }}>Industrial Automation x AI</span></div>
          </div>
        </div>
      )}

      {/* Main */}
      <div style={{ display: "flex", height: showInfo ? "calc(100vh - 115px)" : "calc(100vh - 52px)" }}>

        {/* Left Panel */}
        <div style={{ width: 260, minWidth: 260, borderRight: `1px solid ${C.border}`, padding: "14px 16px", overflowY: "auto", background: `${C.panel}66` }}>
          {/* Motor Select */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Motor Profile</div>
            {Object.entries(MOTOR_PROFILES).map(([key, m]) => (
              <button key={key} className="mbtn" onClick={() => changeProfile(key)} style={{
                width: "100%", textAlign: "left", marginBottom: 5,
                background: profile === key ? `${C.green}12` : "transparent",
                border: `1px solid ${profile === key ? `${C.green}44` : C.border}`,
                borderRadius: 7, padding: "8px 10px", cursor: "pointer",
              }}>
                <div style={{ fontSize: 11, fontFamily: heading, fontWeight: 600, color: profile === key ? C.green : C.textSoft }}>{m.label}</div>
                <div style={{ fontSize: 9, fontFamily: mono, color: C.textMuted, marginTop: 1 }}>{m.subtitle}</div>
              </button>
            ))}
          </div>

          {/* Fault Injection */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
              <span>Fault Injection</span>
              <span style={{ fontSize: 8, color: C.textMuted }}>simulated</span>
            </div>
            {Object.entries(FAULT_MODES).map(([key, f]) => (
              <button key={key} className="mbtn" onClick={() => changeFault(key)} style={{
                width: "100%", textAlign: "left", marginBottom: 4,
                background: faultMode === key ? `${f.color}12` : "transparent",
                border: `1px solid ${faultMode === key ? f.color + "44" : C.border}`,
                borderRadius: 6, padding: "6px 10px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: faultMode === key ? f.color : C.textMuted }} />
                <span style={{ fontFamily: mono, fontSize: 10, color: faultMode === key ? f.color : C.textDim }}>{f.label}</span>
              </button>
            ))}

            {faultMode !== "none" && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, marginBottom: 4 }}>Degradation</div>
                <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${degradePct}%`, background: `linear-gradient(90deg, ${C.gold}, ${C.red})`, borderRadius: 2, transition: "width 0.3s" }} />
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, marginTop: 4, textAlign: "center", fontWeight: 600 }}>{degradePct}%</div>
              </div>
            )}
          </div>

          {/* Health & RUL */}
          <div style={{ marginBottom: 16 }}>
            <HealthGauge score={currentHealth} />
          </div>

          <div style={{ padding: "12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Remaining Useful Life</div>
            <div style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: rul !== null ? (rul < 50 ? C.red : rul < 200 ? C.gold : C.green) : C.textDim }}>
              {rul === null ? "..." : rul >= 999 ? "Stable" : `${rul}h`}
            </div>
            <div style={{ fontFamily: mono, fontSize: 8, color: C.textMuted, marginTop: 2 }}>
              {rul !== null && rul < 999 ? "estimated from degradation trend" : "no degradation detected"}
            </div>
          </div>
        </div>

        {/* Center */}
        <div style={{ flex: 1, padding: "14px 20px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Sensor Cards */}
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <SensorCard label="Vibration" value={latestSensors.vibration.toFixed(2)} unit="mm/s" baseline={motor.baselines.vibration} warning={motor.warningThresholds.vibration} critical={motor.criticalThresholds.vibration} />
            <SensorCard label="Temperature" value={latestSensors.temperature.toFixed(1)} unit="°C" baseline={motor.baselines.temperature} warning={motor.warningThresholds.temperature} critical={motor.criticalThresholds.temperature} />
            <SensorCard label="Current" value={latestSensors.current.toFixed(1)} unit="A" baseline={motor.baselines.current} warning={motor.warningThresholds.current} critical={motor.criticalThresholds.current} />
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", minWidth: 120, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>RPM</div>
              <div style={{ fontFamily: mono, fontSize: 26, fontWeight: 700, color: C.text }}>{Math.round(latestSensors.rpm)}</div>
            </div>
          </div>

          {/* Chart Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>
            {[
              { key: "vibration", label: "Vibration" },
              { key: "temperature", label: "Temperature" },
              { key: "current", label: "Current" },
              { key: "health", label: "Health Trend" },
            ].map(tab => (
              <button key={tab.key} className="mbtn" onClick={() => setActiveChart(tab.key)} style={{
                background: "transparent", border: "none",
                borderBottom: `2px solid ${activeChart === tab.key ? chartColors[tab.key] : "transparent"}`,
                padding: "7px 16px", fontFamily: mono, fontSize: 10, fontWeight: activeChart === tab.key ? 600 : 400,
                color: activeChart === tab.key ? chartColors[tab.key] : C.textDim, cursor: "pointer",
              }}>{tab.label}</button>
            ))}
          </div>

          {/* Chart */}
          <div style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 10px 8px", minHeight: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="t" stroke={C.textMuted} tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }} />
                <YAxis stroke={C.textMuted} tick={{ fontSize: 9, fontFamily: "JetBrains Mono" }}
                  domain={activeChart === "health" ? [0, 100] : ["auto", "auto"]}
                  label={{ value: chartUnits[activeChart], angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 9, fill: C.textDim, fontFamily: "JetBrains Mono" } }} />
                <Tooltip content={<ChartTooltip />} />
                {activeChart !== "health" && <ReferenceLine y={warningLine} stroke={C.gold} strokeDasharray="6 3" strokeOpacity={0.5} />}
                {activeChart !== "health" && <ReferenceLine y={criticalLine} stroke={C.red} strokeDasharray="6 3" strokeOpacity={0.5} />}
                {activeChart === "health" && <ReferenceLine y={45} stroke={C.gold} strokeDasharray="6 3" strokeOpacity={0.4} />}
                {activeChart === "health" && <ReferenceLine y={25} stroke={C.red} strokeDasharray="6 3" strokeOpacity={0.4} />}
                <Line type="monotone" dataKey={activeChart} stroke={chartColors[activeChart]} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: 8, fontFamily: mono, fontSize: 8, color: C.textFaint, textAlign: "center" }}>
            Condition Monitoring · Z-Score Anomaly Detection · Linear RUL Estimation · egemenbirol5@gmail.com
          </div>
        </div>

        {/* Right: Alarms */}
        <div style={{ width: 280, minWidth: 280, borderLeft: `1px solid ${C.border}`, padding: "14px 14px", overflowY: "auto", background: `${C.panel}66` }}>
          <div style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Alarm Log</span>
            <span style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 4,
              background: alarms.length > 0 ? C.redBg : C.greenBg,
              color: alarms.length > 0 ? C.red : C.green,
              border: `1px solid ${alarms.length > 0 ? C.redDim : C.greenDim}`,
              fontWeight: 600,
            }}>{alarms.length}</span>
          </div>

          {alarms.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 11, color: C.textMuted }}>No alarms</div>
              <div style={{ fontFamily: body, fontSize: 10, color: C.textFaint, marginTop: 4 }}>Inject a fault to see alerts</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {alarms.map((a, i) => <AlarmRow key={i} alarm={a} index={i} />)}
            </div>
          )}

          {/* Detection Summary */}
          {history.length > 30 && (
            <div style={{ marginTop: 16, padding: "10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase", marginBottom: 6 }}>Detection Stats</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.textSoft, lineHeight: 1.8 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.textDim }}>Samples</span><span>{history.length}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.textDim }}>Total Alarms</span><span style={{ color: alarms.length > 10 ? C.red : C.textSoft }}>{alarms.length}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.textDim }}>Active Fault</span><span style={{ color: FAULT_MODES[faultMode].color }}>{FAULT_MODES[faultMode].label}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.textDim }}>Health</span><span style={{ color: currentHealth >= 75 ? C.green : currentHealth >= 45 ? C.gold : C.red }}>{currentHealth}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
