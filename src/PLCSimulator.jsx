import { useState, useMemo, useCallback, useRef, useEffect } from "react";

// ══════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0e1117", panel: "#151920", card: "#1a1f28", border: "#242b36", borderLight: "#2e3744",
  gold: "#c9a227", goldDim: "#c9a22733", green: "#3d9e4f", greenDim: "#3d9e4f33",
  blue: "#4a8fd4", blueDim: "#4a8fd422", red: "#c94a4a", redDim: "#c94a4a33",
  cyan: "#4ac9b0", orange: "#d49a3d",
  text: "#d0d4dc", textSoft: "#9aa0ae", textDim: "#5e6678", textMuted: "#3a4050",
  railColor: "#4a8fd4", wireActive: "#4ac9b0", wireInactive: "#2e3744",
};
const mono = "'JetBrains Mono', 'Fira Code', monospace";
const heading = "'Syne', sans-serif";
const body = "'Outfit', sans-serif";

// ══════════════════════════════════════════════════════════════════════
//  LADDER LOGIC ENGINE
// ══════════════════════════════════════════════════════════════════════
const ELEMENT_TYPES = {
  NO: { label: "NO", fullName: "Normally Open", symbol: "] [", color: C.blue },
  NC: { label: "NC", fullName: "Normally Closed", symbol: "]/[", color: C.orange },
  COIL: { label: "COIL", fullName: "Output Coil", symbol: "( )", color: C.green },
  TON: { label: "TON", fullName: "Timer On-Delay", symbol: "TON", color: C.cyan },
  CTU: { label: "CTU", fullName: "Counter Up", symbol: "CTU", color: C.gold },
  SET: { label: "SET", fullName: "Latch Set", symbol: "(S)", color: C.green },
  RST: { label: "RST", fullName: "Latch Reset", symbol: "(R)", color: C.red },
};

function createDefaultProgram() {
  return {
    inputs: { I0: "Start Button", I1: "Stop Button", I2: "Sensor A", I3: "Sensor B", I4: "Emergency" },
    outputs: { Q0: "Motor", Q1: "Valve", Q2: "Alarm", Q3: "Light" },
    rungs: [
      { id: 1, comment: "Motor start/stop circuit", elements: [
        { type: "NO", address: "I0", id: "e1" },
        { type: "NC", address: "I1", id: "e2" },
        { type: "NC", address: "I4", id: "e3" },
        { type: "COIL", address: "Q0", id: "e4" },
      ]},
      { id: 2, comment: "Valve control with sensor", elements: [
        { type: "NO", address: "Q0", id: "e5" },
        { type: "NO", address: "I2", id: "e6" },
        { type: "COIL", address: "Q1", id: "e7" },
      ]},
      { id: 3, comment: "Alarm when both sensors active", elements: [
        { type: "NO", address: "I2", id: "e8" },
        { type: "NO", address: "I3", id: "e9" },
        { type: "COIL", address: "Q2", id: "e10" },
      ]},
      { id: 4, comment: "Status light follows motor", elements: [
        { type: "NO", address: "Q0", id: "e11" },
        { type: "COIL", address: "Q3", id: "e12" },
      ]},
    ],
  };
}

function evaluateProgram(program, inputStates, prevOutputStates) {
  const state = { ...inputStates };
  const outputs = { ...prevOutputStates };
  const rungResults = [];

  for (const rung of program.rungs) {
    const contacts = rung.elements.filter(e => e.type === "NO" || e.type === "NC");
    const outputElements = rung.elements.filter(e => ["COIL", "SET", "RST"].includes(e.type));

    let rungPower = true;
    const elementStates = {};

    for (const el of contacts) {
      const addrState = state[el.address] || outputs[el.address] || false;
      let passes;
      if (el.type === "NO") {
        passes = !!addrState;
      } else {
        passes = !addrState;
      }
      elementStates[el.id] = passes;
      rungPower = rungPower && passes;
    }

    for (const el of outputElements) {
      elementStates[el.id] = rungPower;
      if (el.type === "COIL") {
        outputs[el.address] = rungPower;
        state[el.address] = rungPower;
      } else if (el.type === "SET" && rungPower) {
        outputs[el.address] = true;
        state[el.address] = true;
      } else if (el.type === "RST" && rungPower) {
        outputs[el.address] = false;
        state[el.address] = false;
      }
    }

    rungResults.push({ rungId: rung.id, powered: rungPower, elementStates });
  }

  return { outputs, rungResults };
}

// ══════════════════════════════════════════════════════════════════════
//  AI OPTIMIZER
// ══════════════════════════════════════════════════════════════════════
function analyzeProgram(program) {
  const suggestions = [];
  const usedAddresses = new Map();
  const outputWriters = new Map();
  let score = 100;

  // Build usage maps
  for (const rung of program.rungs) {
    for (const el of rung.elements) {
      if (!usedAddresses.has(el.address)) usedAddresses.set(el.address, []);
      usedAddresses.get(el.address).push({ rungId: rung.id, type: el.type, id: el.id });

      if (["COIL", "SET", "RST"].includes(el.type)) {
        if (!outputWriters.has(el.address)) outputWriters.set(el.address, []);
        outputWriters.get(el.address).push(rung.id);
      }
    }
  }

  // Check for duplicate coils (same output driven by multiple rungs)
  for (const [addr, writers] of outputWriters) {
    if (writers.length > 1 && !program.rungs.some(r => r.elements.some(e => e.address === addr && (e.type === "SET" || e.type === "RST")))) {
      suggestions.push({
        type: "warning",
        title: "Duplicate coil detected",
        detail: `${addr} (${program.outputs[addr] || addr}) is driven by rungs ${writers.join(", ")}. Only the last rung's result will take effect. Consider using SET/RST latches instead.`,
        impact: "reliability",
        rungIds: writers,
      });
      score -= 15;
    }
  }

  // Check for redundant contacts
  for (const rung of program.rungs) {
    const contacts = rung.elements.filter(e => e.type === "NO" || e.type === "NC");
    const addrCount = {};
    for (const c of contacts) {
      const key = `${c.type}:${c.address}`;
      addrCount[key] = (addrCount[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(addrCount)) {
      if (count > 1) {
        const [type, addr] = key.split(":");
        suggestions.push({
          type: "optimize",
          title: "Redundant contact",
          detail: `Rung ${rung.id}: ${type} contact for ${addr} appears ${count} times. Remove the duplicate.`,
          impact: "scan time",
          rungIds: [rung.id],
        });
        score -= 5;
      }
    }

    // Check for contradictory contacts (NO and NC of same address in series)
    const noAddrs = new Set(contacts.filter(c => c.type === "NO").map(c => c.address));
    const ncAddrs = new Set(contacts.filter(c => c.type === "NC").map(c => c.address));
    for (const addr of noAddrs) {
      if (ncAddrs.has(addr)) {
        suggestions.push({
          type: "error",
          title: "Contradictory logic",
          detail: `Rung ${rung.id}: ${addr} has both NO and NC contacts in series. This rung can never be true. Remove it or fix the logic.`,
          impact: "functionality",
          rungIds: [rung.id],
        });
        score -= 25;
      }
    }
  }

  // Check for unused inputs
  const allInputs = Object.keys(program.inputs);
  for (const inp of allInputs) {
    if (!usedAddresses.has(inp)) {
      suggestions.push({
        type: "info",
        title: "Unused input",
        detail: `${inp} (${program.inputs[inp]}) is declared but never used in any rung.`,
        impact: "cleanup",
        rungIds: [],
      });
      score -= 3;
    }
  }

  // Check for outputs read as inputs without being written
  for (const rung of program.rungs) {
    for (const el of rung.elements) {
      if ((el.type === "NO" || el.type === "NC") && el.address.startsWith("Q")) {
        const writerRungs = outputWriters.get(el.address) || [];
        const thisRungIdx = program.rungs.findIndex(r => r.id === rung.id);
        const writtenBefore = writerRungs.some(wId => {
          const wIdx = program.rungs.findIndex(r => r.id === wId);
          return wIdx < thisRungIdx;
        });
        if (!writtenBefore && writerRungs.length > 0) {
          suggestions.push({
            type: "warning",
            title: "Output read before write",
            detail: `Rung ${rung.id}: reads ${el.address} but it's only written in a later rung (${writerRungs.join(", ")}). The value will be from the previous scan cycle. Consider reordering rungs.`,
            impact: "timing",
            rungIds: [rung.id, ...writerRungs],
          });
          score -= 8;
        }
      }
    }
  }

  // Check for seal-in circuit pattern (missing self-hold)
  for (const rung of program.rungs) {
    const hasStart = rung.elements.some(e => e.type === "NO" && e.address.startsWith("I"));
    const coils = rung.elements.filter(e => e.type === "COIL");
    if (hasStart && coils.length === 1) {
      const coilAddr = coils[0].address;
      const hasSealIn = rung.elements.some(e => e.type === "NO" && e.address === coilAddr);
      if (!hasSealIn) {
        suggestions.push({
          type: "info",
          title: "No seal-in contact",
          detail: `Rung ${rung.id}: Output ${coilAddr} (${program.outputs[coilAddr] || coilAddr}) has no self-holding contact. The output will only be on while the input is held. Add a NO contact for ${coilAddr} in parallel if latching is needed.`,
          impact: "design pattern",
          rungIds: [rung.id],
        });
        score -= 2;
      }
    }
  }

  // Performance estimate
  const totalElements = program.rungs.reduce((sum, r) => sum + r.elements.length, 0);
  const scanTime = (totalElements * 0.1 + program.rungs.length * 0.5).toFixed(1);

  score = Math.max(0, Math.min(100, score));

  return {
    suggestions: suggestions.sort((a, b) => {
      const order = { error: 0, warning: 1, optimize: 2, info: 3 };
      return order[a.type] - order[b.type];
    }),
    score,
    stats: {
      rungs: program.rungs.length,
      elements: totalElements,
      inputs: allInputs.length,
      outputs: Object.keys(program.outputs).length,
      estimatedScanTime: scanTime,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
//  PRESET PROGRAMS
// ══════════════════════════════════════════════════════════════════════
const PRESETS = {
  motor_start_stop: {
    label: "Motor Start/Stop",
    subtitle: "Classic control circuit",
    program: createDefaultProgram(),
  },
  conveyor_sort: {
    label: "Conveyor Sort",
    subtitle: "Sensor-driven routing",
    program: {
      inputs: { I0: "Part Detect", I1: "Metal Sensor", I2: "Size Large", I3: "Run Enable", I4: "E-Stop" },
      outputs: { Q0: "Conveyor Run", Q1: "Diverter Left", Q2: "Diverter Right", Q3: "Counter" },
      rungs: [
        { id: 1, comment: "Conveyor runs when enabled and no e-stop", elements: [
          { type: "NO", address: "I3", id: "s1" },
          { type: "NC", address: "I4", id: "s2" },
          { type: "COIL", address: "Q0", id: "s3" },
        ]},
        { id: 2, comment: "Metal parts go left", elements: [
          { type: "NO", address: "I0", id: "s4" },
          { type: "NO", address: "I1", id: "s5" },
          { type: "NO", address: "Q0", id: "s6" },
          { type: "COIL", address: "Q1", id: "s7" },
        ]},
        { id: 3, comment: "Large parts go right", elements: [
          { type: "NO", address: "I0", id: "s8" },
          { type: "NC", address: "I1", id: "s9" },
          { type: "NO", address: "I2", id: "s10" },
          { type: "COIL", address: "Q2", id: "s11" },
        ]},
        { id: 4, comment: "Count all detected parts", elements: [
          { type: "NO", address: "I0", id: "s12" },
          { type: "COIL", address: "Q3", id: "s13" },
        ]},
      ],
    },
  },
  fault_detection: {
    label: "Fault Handler",
    subtitle: "With redundant checks (has issues)",
    program: {
      inputs: { I0: "Sensor 1", I1: "Sensor 2", I2: "Temp OK", I3: "Pressure OK", I4: "Reset" },
      outputs: { Q0: "System OK", Q1: "Alarm", Q2: "Shutdown", Q3: "Status" },
      rungs: [
        { id: 1, comment: "System OK when both sensors agree", elements: [
          { type: "NO", address: "I0", id: "f1" },
          { type: "NO", address: "I1", id: "f2" },
          { type: "NO", address: "I2", id: "f3" },
          { type: "NO", address: "I3", id: "f4" },
          { type: "COIL", address: "Q0", id: "f5" },
        ]},
        { id: 2, comment: "Alarm on fault (has contradictory logic)", elements: [
          { type: "NO", address: "I2", id: "f6" },
          { type: "NC", address: "I2", id: "f7" },
          { type: "COIL", address: "Q1", id: "f8" },
        ]},
        { id: 3, comment: "Shutdown (duplicate coil issue)", elements: [
          { type: "NC", address: "Q0", id: "f9" },
          { type: "COIL", address: "Q2", id: "f10" },
        ]},
        { id: 4, comment: "Shutdown also triggered here", elements: [
          { type: "NO", address: "I4", id: "f11" },
          { type: "COIL", address: "Q2", id: "f12" },
        ]},
        { id: 5, comment: "Status mirrors system", elements: [
          { type: "NO", address: "Q0", id: "f13" },
          { type: "COIL", address: "Q3", id: "f14" },
        ]},
      ],
    },
  },
};

// ══════════════════════════════════════════════════════════════════════
//  UI COMPONENTS
// ══════════════════════════════════════════════════════════════════════
function LadderElement({ element, powered, active, highlighted }) {
  const t = ELEMENT_TYPES[element.type];
  const isContact = element.type === "NO" || element.type === "NC";
  const bg = highlighted ? `${C.red}25` : active ? `${t.color}15` : `${C.bg}88`;
  const borderColor = highlighted ? C.red : active ? t.color : C.border;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
      padding: "8px 10px", borderRadius: 6,
      background: bg, border: `1px solid ${borderColor}`,
      minWidth: 72, transition: "all 0.15s ease", position: "relative",
    }}>
      {active && (
        <div style={{ position: "absolute", inset: -1, borderRadius: 6, boxShadow: `0 0 10px ${t.color}33`, pointerEvents: "none" }} />
      )}
      <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: active ? t.color : C.textDim, letterSpacing: "0.05em" }}>
        {t.symbol}
      </div>
      <div style={{ fontFamily: mono, fontSize: 9, color: active ? C.text : C.textDim, fontWeight: 600 }}>
        {element.address}
      </div>
    </div>
  );
}

function WireSegment({ active }) {
  return (
    <div style={{
      width: 24, height: 2, alignSelf: "center",
      background: active ? C.wireActive : C.wireInactive,
      boxShadow: active ? `0 0 6px ${C.wireActive}66` : "none",
      transition: "all 0.15s",
    }} />
  );
}

function RungView({ rung, rungResult, highlightedRungs, onRemoveRung, rungCount }) {
  const powered = rungResult?.powered || false;
  const isHighlighted = highlightedRungs.includes(rung.id);

  return (
    <div style={{
      background: isHighlighted ? `${C.red}08` : C.card,
      border: `1px solid ${isHighlighted ? `${C.red}44` : C.border}`,
      borderRadius: 10, padding: "14px 18px", marginBottom: 10,
      transition: "all 0.3s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: C.textDim }}>R{rung.id}</span>
          <span style={{ fontFamily: body, fontSize: 11, color: C.textSoft }}>{rung.comment}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: powered ? C.green : C.textMuted,
            boxShadow: powered ? `0 0 6px ${C.green}88` : "none",
            transition: "all 0.2s",
          }} />
          {rungCount > 1 && (
            <button onClick={() => onRemoveRung(rung.id)} style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: mono, fontSize: 10, color: C.textMuted, padding: "2px 4px",
              transition: "color 0.2s",
            }}
              onMouseEnter={e => e.currentTarget.style.color = C.red}
              onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
            >×</button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {/* Left rail */}
        <div style={{ width: 3, height: 48, background: powered ? C.wireActive : C.railColor, borderRadius: 2, opacity: powered ? 1 : 0.3, transition: "all 0.15s" }} />
        <WireSegment active={powered} />

        {rung.elements.map((el, i) => {
          const elState = rungResult?.elementStates?.[el.id] ?? false;
          const isLast = i === rung.elements.length - 1;
          const isOutput = ["COIL", "SET", "RST"].includes(el.type);
          return (
            <div key={el.id} style={{ display: "flex", alignItems: "center" }}>
              <LadderElement element={el} active={elState} highlighted={isHighlighted} />
              {!isLast && <WireSegment active={elState} />}
            </div>
          );
        })}

        <WireSegment active={powered} />
        {/* Right rail */}
        <div style={{ width: 3, height: 48, background: powered ? C.wireActive : C.railColor, borderRadius: 2, opacity: powered ? 1 : 0.3, transition: "all 0.15s" }} />
      </div>
    </div>
  );
}

function IOToggle({ address, label, value, onChange, isOutput }) {
  return (
    <button onClick={() => !isOutput && onChange(!value)} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 10px", borderRadius: 6,
      background: value ? (isOutput ? `${C.green}18` : `${C.blue}15`) : `${C.bg}`,
      border: `1px solid ${value ? (isOutput ? `${C.green}44` : `${C.blue}44`) : C.border}`,
      cursor: isOutput ? "default" : "pointer",
      transition: "all 0.15s", width: "100%",
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: value ? (isOutput ? C.green : C.blue) : C.textMuted,
        boxShadow: value ? `0 0 6px ${isOutput ? C.green : C.blue}88` : "none",
        transition: "all 0.2s",
      }} />
      <span style={{ fontFamily: mono, fontSize: 10, color: value ? C.text : C.textDim, fontWeight: 600 }}>{address}</span>
      <span style={{ fontFamily: body, fontSize: 10, color: C.textDim, flex: 1, textAlign: "left" }}>{label}</span>
    </button>
  );
}

function SuggestionCard({ suggestion }) {
  const colors = { error: C.red, warning: C.orange, optimize: C.blue, info: C.textDim };
  const icons = { error: "✕", warning: "!", optimize: "⟳", info: "i" };
  const col = colors[suggestion.type];

  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: `${col}08`, border: `1px solid ${col}22`,
      marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${col}20`, fontFamily: mono, fontSize: 10, fontWeight: 700, color: col,
        }}>{icons[suggestion.type]}</div>
        <span style={{ fontFamily: heading, fontSize: 12, fontWeight: 600, color: col }}>{suggestion.title}</span>
        <span style={{ fontFamily: mono, fontSize: 8, color: C.textDim, marginLeft: "auto", padding: "1px 5px", background: C.bg, borderRadius: 3 }}>{suggestion.impact}</span>
      </div>
      <div style={{ fontFamily: body, fontSize: 11, color: C.textSoft, lineHeight: 1.6, marginLeft: 24 }}>
        {suggestion.detail}
      </div>
    </div>
  );
}

function ScoreGauge({ score }) {
  const col = score >= 80 ? C.green : score >= 50 ? C.gold : C.red;
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r="40" fill="none" stroke={C.border} strokeWidth="5" />
        <circle cx="48" cy="48" r="40" fill="none" stroke={col} strokeWidth="5"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 48 48)"
          style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.3s" }} />
        <text x="48" y="44" textAnchor="middle" fontFamily={mono} fontSize="22" fontWeight="700" fill={col}>{score}</text>
        <text x="48" y="60" textAnchor="middle" fontFamily={mono} fontSize="8" fill={C.textDim}>/ 100</text>
      </svg>
      <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>Logic Score</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN APPLICATION
// ══════════════════════════════════════════════════════════════════════
export default function PLCSimulator() {
  const [program, setProgram] = useState(PRESETS.motor_start_stop.program);
  const [activePreset, setActivePreset] = useState("motor_start_stop");
  const [inputStates, setInputStates] = useState({});
  const [running, setRunning] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [highlightedRungs, setHighlightedRungs] = useState([]);
  const [addingTo, setAddingTo] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const outputStatesRef = useRef({});

  const evalResult = useMemo(() => {
    if (!running) return { outputs: {}, rungResults: [] };
    return evaluateProgram(program, inputStates, outputStatesRef.current);
  }, [program, inputStates, running]);

  useEffect(() => {
    if (running) outputStatesRef.current = evalResult.outputs;
  }, [evalResult, running]);

  const analysis = useMemo(() => analyzeProgram(program), [program]);

  const toggleInput = (addr) => {
    setInputStates(prev => ({ ...prev, [addr]: !prev[addr] }));
  };

  const loadPreset = (key) => {
    setActivePreset(key);
    setProgram(PRESETS[key].program);
    setInputStates({});
    outputStatesRef.current = {};
    setHighlightedRungs([]);
    setAddingTo(null);
  };

  const removeRung = (rungId) => {
    setProgram(prev => ({
      ...prev,
      rungs: prev.rungs.filter(r => r.id !== rungId),
    }));
  };

  const addElement = (rungId, type, address) => {
    const id = `e_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    setProgram(prev => ({
      ...prev,
      rungs: prev.rungs.map(r => {
        if (r.id !== rungId) return r;
        const isOutput = ["COIL", "SET", "RST"].includes(type);
        const insertIdx = isOutput ? r.elements.length : r.elements.filter(e => !["COIL", "SET", "RST"].includes(e.type)).length;
        const newElements = [...r.elements];
        newElements.splice(insertIdx, 0, { type, address, id });
        return { ...r, elements: newElements };
      }),
    }));
    setAddingTo(null);
  };

  const addRung = () => {
    const maxId = Math.max(0, ...program.rungs.map(r => r.id));
    setProgram(prev => ({
      ...prev,
      rungs: [...prev.rungs, {
        id: maxId + 1,
        comment: "New rung",
        elements: [
          { type: "NO", address: "I0", id: `e_new_${Date.now()}_1` },
          { type: "COIL", address: "Q0", id: `e_new_${Date.now()}_2` },
        ],
      }],
    }));
  };

  const highlightSuggestion = (rungIds) => {
    setHighlightedRungs(rungIds);
    setTimeout(() => setHighlightedRungs([]), 3000);
  };

  const allAddresses = [...Object.keys(program.inputs), ...Object.keys(program.outputs)];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700&display=swap');
        input[type="range"]::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:${C.blue};border:2px solid ${C.bg};cursor:pointer}
        .pbtn{transition:all .2s ease;cursor:pointer}.pbtn:hover{transform:translateY(-1px);filter:brightness(1.1)}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${C.border};border-radius:3px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "12px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: `${C.panel}cc`, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
              background: `${C.blue}18`, border: `1px solid ${C.blue}33`,
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1" stroke={C.blue} strokeWidth="1.5" />
                <rect x="8" y="1" width="5" height="5" rx="1" stroke={C.blue} strokeWidth="1.5" />
                <rect x="1" y="8" width="5" height="5" rx="1" stroke={C.blue} strokeWidth="1.5" />
                <rect x="8" y="8" width="5" height="5" rx="1" stroke={C.blue} strokeWidth="1.5" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: 14, fontFamily: heading, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.02em" }}>PLC Logic Simulator</h1>
              <p style={{ fontSize: 9, fontFamily: mono, color: C.textDim, margin: 0 }}>Ladder Logic Editor with AI Analysis</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            <button className="pbtn" onClick={() => setRunning(!running)} style={{
              background: running ? `${C.green}15` : `${C.red}15`,
              border: `1px solid ${running ? `${C.green}44` : `${C.red}44`}`,
              borderRadius: 6, padding: "5px 14px",
              fontFamily: mono, fontSize: 10, fontWeight: 600,
              color: running ? C.green : C.red,
            }}>{running ? "● RUN" : "◼ STOP"}</button>
            <button className="pbtn" onClick={() => setShowAnalysis(!showAnalysis)} style={{
              background: showAnalysis ? `${C.gold}15` : "transparent",
              border: `1px solid ${showAnalysis ? `${C.gold}44` : C.border}`,
              borderRadius: 6, padding: "5px 14px",
              fontFamily: mono, fontSize: 10, fontWeight: 600,
              color: showAnalysis ? C.gold : C.textDim,
            }}>AI Analysis</button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 5, background: C.card, border: `1px solid ${C.border}`,
            fontFamily: mono, fontSize: 9, color: C.textDim,
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: running ? C.green : C.red,
              animation: running ? "pulse 1.5s infinite" : "none",
            }} />
            {running ? "Scanning" : "Stopped"}
          </div>
          <button className="pbtn" onClick={() => setShowInfo(!showInfo)} style={{
            background: showInfo ? `${C.gold}15` : "transparent", border: `1px solid ${showInfo ? C.gold + "44" : C.border}`,
            borderRadius: 6, padding: "4px 10px", fontFamily: mono, fontSize: 10, color: showInfo ? C.gold : C.textDim, cursor: "pointer",
          }}>?</button>
          <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>Egemen Birol</div>
        </div>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: "14px 20px", background: `${C.card}ee`, display: "flex", gap: 28, fontFamily: mono, fontSize: 10, lineHeight: 1.7 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.blue, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>About</div>
            <div style={{ color: C.textDim }}>
              Interactive ladder logic simulator. Build PLC programs visually, toggle inputs to see real-time signal flow, and run AI analysis to catch logic errors and optimization opportunities.
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.blue, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>AI Engine</div>
            <div style={{ color: C.textDim }}>
              The analyzer checks for contradictory logic, duplicate coils, redundant contacts, missing seal-in patterns, output read-before-write issues, and unused I/O. Each issue impacts the overall logic score.
            </div>
          </div>
          <div style={{ flex: 0.6 }}>
            <div style={{ color: C.blue, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.1em" }}>Built By</div>
            <div style={{ color: C.textDim }}>
              Egemen Birol<br />
              EE Engineer, M.Sc. AI<br />
              <span style={{ color: C.textMuted }}>Industrial Automation x AI</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout */}
      <div style={{ display: "flex", height: showInfo ? "calc(100vh - 115px)" : "calc(100vh - 52px)" }}>

        {/* Left: I/O and Presets */}
        <div style={{ width: 240, minWidth: 240, borderRight: `1px solid ${C.border}`, padding: "14px 14px", overflowY: "auto", background: `${C.panel}66` }}>
          {/* Presets */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Presets</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {Object.entries(PRESETS).map(([key, p]) => (
                <button key={key} className="pbtn" onClick={() => loadPreset(key)} style={{
                  background: activePreset === key ? `${C.blue}12` : "transparent",
                  border: `1px solid ${activePreset === key ? `${C.blue}44` : C.border}`,
                  borderRadius: 7, padding: "8px 10px", textAlign: "left", cursor: "pointer",
                }}>
                  <div style={{ fontSize: 11, fontFamily: heading, fontWeight: 600, color: activePreset === key ? C.blue : C.textSoft }}>{p.label}</div>
                  <div style={{ fontSize: 9, fontFamily: mono, color: C.textMuted, marginTop: 1 }}>{p.subtitle}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Inputs */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 3, height: 10, background: C.blue, borderRadius: 1 }} />
              Inputs
              <span style={{ fontFamily: mono, fontSize: 8, color: C.textMuted, marginLeft: "auto" }}>click to toggle</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(program.inputs).map(([addr, label]) => (
                <IOToggle key={addr} address={addr} label={label} value={inputStates[addr] || false} onChange={() => toggleInput(addr)} />
              ))}
            </div>
          </div>

          {/* Outputs */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 3, height: 10, background: C.green, borderRadius: 1 }} />
              Outputs
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(program.outputs).map(([addr, label]) => (
                <IOToggle key={addr} address={addr} label={label} value={evalResult.outputs[addr] || false} isOutput onChange={() => {}} />
              ))}
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: "10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 9, fontFamily: mono, color: C.textDim, lineHeight: 1.8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 8px" }}>
              <span>Rungs</span><span style={{ color: C.textSoft }}>{analysis.stats.rungs}</span>
              <span>Elements</span><span style={{ color: C.textSoft }}>{analysis.stats.elements}</span>
              <span>Est. Scan</span><span style={{ color: C.textSoft }}>{analysis.stats.estimatedScanTime} ms</span>
            </div>
          </div>
        </div>

        {/* Center: Ladder Diagram */}
        <div style={{ flex: 1, padding: "14px 20px", overflowY: "auto" }}>
          {program.rungs.map((rung) => {
            const rungResult = evalResult.rungResults.find(r => r.rungId === rung.id);
            return (
              <div key={rung.id}>
                <RungView
                  rung={rung}
                  rungResult={rungResult}
                  highlightedRungs={highlightedRungs}
                  onRemoveRung={removeRung}
                  rungCount={program.rungs.length}
                />
                {/* Add element controls */}
                {addingTo === rung.id ? (
                  <div style={{ padding: "10px 12px", background: C.card, border: `1px solid ${C.blue}33`, borderRadius: 8, marginBottom: 10, marginTop: -6 }}>
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, marginBottom: 8, textTransform: "uppercase" }}>Add element to rung {rung.id}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {Object.entries(ELEMENT_TYPES).filter(([k]) => !["TON", "CTU"].includes(k)).map(([type, info]) => (
                        <div key={type} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ fontFamily: mono, fontSize: 8, color: info.color, textAlign: "center" }}>{info.label}</div>
                          <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                            {allAddresses.map(addr => (
                              <button key={`${type}-${addr}`} className="pbtn" onClick={() => addElement(rung.id, type, addr)} style={{
                                background: `${info.color}10`, border: `1px solid ${info.color}22`,
                                borderRadius: 4, padding: "3px 6px", fontFamily: mono, fontSize: 8, color: info.color, cursor: "pointer",
                              }}>{addr}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="pbtn" onClick={() => setAddingTo(null)} style={{
                      marginTop: 8, background: "transparent", border: `1px solid ${C.border}`,
                      borderRadius: 4, padding: "3px 10px", fontFamily: mono, fontSize: 9, color: C.textDim, cursor: "pointer",
                    }}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ marginBottom: 10, marginTop: -6 }}>
                    <button className="pbtn" onClick={() => setAddingTo(rung.id)} style={{
                      background: "transparent", border: `1px dashed ${C.border}`,
                      borderRadius: 6, padding: "4px 10px", fontFamily: mono, fontSize: 9, color: C.textMuted, cursor: "pointer",
                      transition: "all 0.2s", width: "100%",
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue + "44"; e.currentTarget.style.color = C.blue; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}
                    >+ Add Element</button>
                  </div>
                )}
              </div>
            );
          })}

          <button className="pbtn" onClick={addRung} style={{
            background: `${C.blue}08`, border: `1px dashed ${C.blue}33`,
            borderRadius: 8, padding: "12px", fontFamily: mono, fontSize: 11, color: C.blue,
            cursor: "pointer", width: "100%", transition: "all 0.2s",
          }}
            onMouseEnter={e => e.currentTarget.style.background = `${C.blue}15`}
            onMouseLeave={e => e.currentTarget.style.background = `${C.blue}08`}
          >+ Add Rung</button>

          {/* Footer */}
          <div style={{ marginTop: 16, fontFamily: mono, fontSize: 8, color: C.textMuted, textAlign: "center" }}>
            IEC 61131-3 Ladder Logic Simulation · egemenbirol5@gmail.com
          </div>
        </div>

        {/* Right: AI Analysis */}
        {showAnalysis && (
          <div style={{ width: 300, minWidth: 300, borderLeft: `1px solid ${C.border}`, padding: "14px 14px", overflowY: "auto", background: `${C.panel}66` }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.gold, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>AI Analysis</span>
              <span style={{ fontSize: 8, padding: "2px 6px", background: `${C.gold}12`, border: `1px solid ${C.gold}22`, borderRadius: 3 }}>
                {analysis.suggestions.length} findings
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <ScoreGauge score={analysis.score} />
            </div>

            {analysis.suggestions.length === 0 ? (
              <div style={{ padding: "16px", background: `${C.green}08`, border: `1px solid ${C.green}22`, borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontFamily: mono, fontSize: 12, color: C.green, fontWeight: 600 }}>No issues found</div>
                <div style={{ fontFamily: body, fontSize: 11, color: C.textDim, marginTop: 4 }}>Your logic looks clean.</div>
              </div>
            ) : (
              <div>
                {analysis.suggestions.map((s, i) => (
                  <div key={i} onClick={() => s.rungIds.length > 0 && highlightSuggestion(s.rungIds)} style={{ cursor: s.rungIds.length > 0 ? "pointer" : "default" }}>
                    <SuggestionCard suggestion={s} />
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 16, padding: "10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Scoring</div>
              <div style={{ fontFamily: body, fontSize: 10, color: C.textDim, lineHeight: 1.7 }}>
                Starts at 100. Contradictory logic: -25. Duplicate coils: -15. Read-before-write: -8. Redundant contacts: -5. Unused I/O: -3. Missing seal-in: -2.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
