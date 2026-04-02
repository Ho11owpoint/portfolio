import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

// ══════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS (matching portfolio)
// ══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#161a22", bgAlt: "#1b2029", panel: "#1f242e", card: "#232933",
  border: "#2e3542", borderLight: "#3a4250",
  gold: "#c9a227", goldBright: "#e0b830", goldDim: "#c9a22733", goldSubtle: "#c9a22712",
  green: "#3d9e4f", blue: "#4a8fd4", orange: "#c47a2e", red: "#b54a4a",
  text: "#dce0e8", textSoft: "#a8aebb", textDim: "#6e7788", textMuted: "#454d5c", textFaint: "#2e3440",
  // SCADA status
  run: "#3d9e4f", warn: "#c9a227", fault: "#b54a4a", idle: "#454d5c",
};
const mono = "'JetBrains Mono', 'Fira Code', monospace";
const heading = "'Syne', 'Inter', sans-serif";
const body = "'Outfit', 'Inter', sans-serif";

// ══════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════
function useInterval(cb, ms) {
  const ref = useRef(cb);
  useEffect(() => { ref.current = cb; }, [cb]);
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function noise(base, amp) { return base + (Math.random() - 0.5) * 2 * amp; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function fmt1(v) { return v.toFixed(1); }
function fmt0(v) { return Math.round(v).toString(); }

const TICK_MS = 700;
const MAX_TREND = 70;

// ══════════════════════════════════════════════════════════════════════
//  PROCESS FLOW SVG
// ══════════════════════════════════════════════════════════════════════
function statusColor(s) {
  if (s === "run") return C.run;
  if (s === "warn") return C.warn;
  if (s === "fault") return C.fault;
  return C.idle;
}

function ProcessFlow({ running, metrics, faultType }) {
  // SVG viewBox = "0 0 1060 200"
  // Stations along the strip line at y=100
  const stripY = 100;

  // Station positions
  const EC   = { x: 52,  label: "EC",    type: "coiler" };
  const R1   = { x: 135, label: "R1",    type: "stand" };
  const R2   = { x: 185, label: "R2",    type: "stand" };
  const R3   = { x: 235, label: "R3",    type: "stand" };
  const R4   = { x: 285, label: "R4",    type: "stand" };
  const CS   = { x: 340, label: "CS",    type: "shear" };
  const F1   = { x: 400, label: "F1",    type: "fstand" };
  const F2   = { x: 440, label: "F2",    type: "fstand" };
  const F3   = { x: 480, label: "F3",    type: "fstand" };
  const F4   = { x: 520, label: "F4",    type: "fstand" };
  const F5   = { x: 560, label: "F5",    type: "fstand" };
  const F6   = { x: 600, label: "F6",    type: "fstand" };
  const F7   = { x: 640, label: "F7",    type: "fstand" };
  const ROT  = { x: 755, label: "ROT",   type: "table", width: 130 };
  const DC1  = { x: 930, label: "DC1",   type: "coiler" };
  const DC2  = { x: 1005, label: "DC2",  type: "coiler" };

  const allStands = { R1, R2, R3, R4, F1, F2, F3, F4, F5, F6, F7 };
  const statuses = metrics?.stationStatus || {};

  function getStatus(id) {
    if (!running) return "idle";
    return statuses[id] || "run";
  }

  // Strip segment from x1 to x2 at stripY, with given color
  function StripSeg({ x1, x2, color }) {
    return <line x1={x1} y1={stripY} x2={x2} y2={stripY} stroke={color} strokeWidth={running ? 7 : 3} strokeLinecap="round" opacity={running ? 1 : 0.25} />;
  }

  // Rolling stand symbol (two roll circles)
  function Stand({ x, label, type, id }) {
    const st = getStatus(id || label);
    const sc = statusColor(st);
    const rollR = type === "fstand" ? 14 : 18;
    const isFault = st === "fault";
    return (
      <g>
        {/* Top roll */}
        <circle cx={x} cy={stripY - rollR} r={rollR} fill={C.panel} stroke={isFault ? C.fault : C.border} strokeWidth={1.5} />
        {/* Bottom roll */}
        <circle cx={x} cy={stripY + rollR} r={rollR} fill={C.panel} stroke={isFault ? C.fault : C.border} strokeWidth={1.5} />
        {/* Roll center lines */}
        <line x1={x - rollR + 3} y1={stripY - rollR} x2={x + rollR - 3} y2={stripY - rollR} stroke={C.border} strokeWidth={1} opacity={0.5} />
        <line x1={x - rollR + 3} y1={stripY + rollR} x2={x + rollR - 3} y2={stripY + rollR} stroke={C.border} strokeWidth={1} opacity={0.5} />
        {/* Status dot */}
        <circle cx={x} cy={stripY - rollR - 10} r={4} fill={sc} opacity={running ? 1 : 0.4}>
          {isFault && <animate attributeName="opacity" values="1;0.2;1" dur="0.8s" repeatCount="indefinite" />}
        </circle>
        {/* Label */}
        <text x={x} y={stripY + rollR + 18} textAnchor="middle" fontFamily={mono} fontSize={10} fill={C.textDim}>{label}</text>
      </g>
    );
  }

  // Coiler symbol
  function Coiler({ x, label, id }) {
    const st = getStatus(id || label);
    const sc = statusColor(st);
    return (
      <g>
        <circle cx={x} cy={stripY} r={28} fill={C.panel} stroke={C.border} strokeWidth={1.5} />
        <circle cx={x} cy={stripY} r={19} fill={C.bgAlt} stroke={C.border} strokeWidth={1} />
        <circle cx={x} cy={stripY} r={10} fill={C.panel} stroke={C.border} strokeWidth={1} />
        <circle cx={x} cy={stripY} r={4}  fill={C.border} />
        {/* Spiral hint lines */}
        {running && <path d={`M ${x} ${stripY - 22} A 22 22 0 0 1 ${x + 22} ${stripY}`} fill="none" stroke={C.gold} strokeWidth={1.5} opacity={0.4} />}
        {/* Status dot */}
        <circle cx={x + 20} cy={stripY - 20} r={5} fill={sc} opacity={running ? 1 : 0.4} />
        <text x={x} y={stripY + 42} textAnchor="middle" fontFamily={mono} fontSize={10} fill={C.textDim}>{label}</text>
      </g>
    );
  }

  // Crop shear
  function Shear({ x }) {
    const st = getStatus("CS");
    const sc = statusColor(st);
    return (
      <g>
        <rect x={x - 12} y={stripY - 32} width={24} height={64} rx={3} fill={C.panel} stroke={C.border} strokeWidth={1.5} />
        <line x1={x - 8} y1={stripY - 8} x2={x + 8} y2={stripY + 8} stroke={C.textMuted} strokeWidth={2} />
        <line x1={x - 8} y1={stripY + 8} x2={x + 8} y2={stripY - 8} stroke={C.textMuted} strokeWidth={2} />
        <circle cx={x} cy={stripY - 40} r={4} fill={sc} opacity={running ? 1 : 0.4} />
        <text x={x} y={stripY + 50} textAnchor="middle" fontFamily={mono} fontSize={10} fill={C.textDim}>CS</text>
      </g>
    );
  }

  // Run-out table
  function RunOutTable({ x, width }) {
    const st = getStatus("ROT");
    const sc = statusColor(st);
    const isCool = faultType === "cooling_fault";
    return (
      <g>
        <rect x={x - width / 2} y={stripY - 22} width={width} height={44} rx={3}
          fill={isCool ? `${C.fault}10` : `${C.blue}10`}
          stroke={isCool ? C.fault : C.blue} strokeWidth={1.5} />
        {/* Roller lines */}
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={i} x1={x - width / 2 + 10 + i * (width - 20) / 7} y1={stripY - 18}
            x2={x - width / 2 + 10 + i * (width - 20) / 7} y2={stripY + 18}
            stroke={isCool ? C.fault : C.blue} strokeWidth={1} opacity={0.4} />
        ))}
        {/* Cooling water lines */}
        {!isCool && Array.from({ length: 4 }).map((_, i) => (
          <line key={i}
            x1={x - width / 2 + 20 + i * (width - 40) / 3} y1={stripY - 20}
            x2={x - width / 2 + 20 + i * (width - 40) / 3} y2={stripY + 20}
            stroke="#4a8fd4" strokeWidth={2} opacity={0.2} strokeDasharray="3 4" />
        ))}
        <circle cx={x} cy={stripY - 30} r={4} fill={sc} opacity={running ? 1 : 0.4} />
        <text x={x} y={stripY + 36} textAnchor="middle" fontFamily={mono} fontSize={10} fill={C.textDim}>ROT (Laminar Cooling)</text>
      </g>
    );
  }

  // Temperature label
  function TempLabel({ x, y, temp, label }) {
    const color = temp > 1050 ? "#ff6633" : temp > 950 ? "#ff9900" : temp > 880 ? C.gold : temp > 700 ? "#88bb55" : "#4a8fd4";
    return (
      <g opacity={running ? 1 : 0.3}>
        <text x={x} y={y - 4} textAnchor="middle" fontFamily={mono} fontSize={9} fill={C.textDim}>{label}</text>
        <text x={x} y={y + 10} textAnchor="middle" fontFamily={mono} fontSize={12} fontWeight="600" fill={color}>
          {running && temp ? `${fmt0(temp)}°C` : "---"}
        </text>
      </g>
    );
  }

  // Strip color segments based on temperature zones
  const stripColor = (temp) => {
    if (!running) return C.border;
    if (temp > 1080) return "#ff5522";
    if (temp > 980)  return "#ff8800";
    if (temp > 900)  return C.gold;
    if (temp > 750)  return "#99bb44";
    return "#5599cc";
  };

  const m = metrics;

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>HOT ROLLING MILL – PROCESS FLOW</span>
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: "RUN", color: C.run },
            { label: "WARN", color: C.warn },
            { label: "FAULT", color: C.fault },
            { label: "IDLE", color: C.idle },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 1060 200" style={{ width: "100%", height: 190, display: "block" }}>
        <defs>
          <linearGradient id="stripGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#ff5522" stopOpacity={running ? 1 : 0.2} />
            <stop offset="30%"  stopColor="#ff8800" stopOpacity={running ? 1 : 0.2} />
            <stop offset="55%"  stopColor={C.gold}  stopOpacity={running ? 1 : 0.2} />
            <stop offset="80%"  stopColor="#88bb44" stopOpacity={running ? 1 : 0.2} />
            <stop offset="100%" stopColor="#5599cc" stopOpacity={running ? 1 : 0.2} />
          </linearGradient>
        </defs>

        {/* Background grid */}
        <rect x="0" y="0" width="1060" height="200" fill="transparent" />

        {/* === STRIP LINE (full, gradient, under everything) === */}
        {/* Split into segments for fault coloring */}
        <line x1={EC.x + 28} y1={stripY} x2={R1.x - 18} y2={stripY}
          stroke={stripColor(m?.entryTemp || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />
        <line x1={R1.x + 18} y1={stripY} x2={R2.x - 18} y2={stripY}
          stroke={stripColor(m?.roughingExitTemp || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />
        <line x1={R2.x + 18} y1={stripY} x2={R3.x - 18} y2={stripY}
          stroke={stripColor(m?.roughingExitTemp || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />
        <line x1={R3.x + 18} y1={stripY} x2={R4.x - 18} y2={stripY}
          stroke={stripColor(m?.roughingExitTemp || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />
        <line x1={R4.x + 18} y1={stripY} x2={CS.x - 12} y2={stripY}
          stroke={stripColor(m?.roughingExitTemp || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />
        <line x1={CS.x + 12} y1={stripY} x2={F1.x - 14} y2={stripY}
          stroke={stripColor(m?.fStandTemps?.[0] || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />
        {[F1, F2, F3, F4, F5, F6].map((st, i) => (
          <line key={st.label} x1={st.x + 14} y1={stripY} x2={[F2, F3, F4, F5, F6, F7][i].x - 14} y2={stripY}
            stroke={stripColor(m?.fStandTemps?.[i + 1] || 0)}
            strokeWidth={running && (faultType !== "cobble_f4" || i < 2) ? 7 : 3}
            strokeOpacity={running && (faultType !== "cobble_f4" || i < 2) ? 1 : 0.15} />
        ))}
        <line x1={F7.x + 14} y1={stripY} x2={ROT.x - ROT.width / 2} y2={stripY}
          stroke={stripColor(m?.exitTemp || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />
        <line x1={ROT.x + ROT.width / 2} y1={stripY} x2={DC1.x - 28} y2={stripY}
          stroke={stripColor(m?.runoutExitTemp || 0)} strokeWidth={running ? 7 : 3} strokeOpacity={running ? 1 : 0.2} />

        {/* Strip animation (moving material indication) */}
        {running && (
          <line x1={EC.x + 28} y1={stripY} x2={DC1.x - 28} y2={stripY}
            stroke="white" strokeWidth={1} strokeOpacity={0.12}
            strokeDasharray="18 14">
            <animate attributeName="stroke-dashoffset" from="0" to="-320" dur="1.2s" repeatCount="indefinite" />
          </line>
        )}

        {/* === STATIONS === */}
        <Coiler x={EC.x} label="EC" id="EC" />
        <Stand x={R1.x} label="R1" type="stand" id="R1" />
        <Stand x={R2.x} label="R2" type="stand" id="R2" />
        <Stand x={R3.x} label="R3" type="stand" id="R3" />
        <Stand x={R4.x} label="R4" type="stand" id="R4" />
        <Shear x={CS.x} />
        <Stand x={F1.x} label="F1" type="fstand" id="F1" />
        <Stand x={F2.x} label="F2" type="fstand" id="F2" />
        <Stand x={F3.x} label="F3" type="fstand" id="F3" />
        <Stand x={F4.x} label="F4" type="fstand" id="F4" />
        <Stand x={F5.x} label="F5" type="fstand" id="F5" />
        <Stand x={F6.x} label="F6" type="fstand" id="F6" />
        <Stand x={F7.x} label="F7" type="fstand" id="F7" />
        <RunOutTable x={ROT.x} width={ROT.width} />
        <Coiler x={DC1.x} label="DC1" id="DC1" />
        <Coiler x={DC2.x} label="DC2" id="DC2" />

        {/* === TEMPERATURE LABELS === */}
        <TempLabel x={EC.x}   y={40} temp={m?.entryTemp || 0}          label="Entry" />
        <TempLabel x={CS.x}   y={40} temp={m?.roughingExitTemp || 0}   label="Post-R" />
        <TempLabel x={F4.x}   y={40} temp={m?.fStandTemps?.[3] || 0}   label="F4" />
        <TempLabel x={F7.x}   y={40} temp={m?.exitTemp || 0}           label="Exit" />
        <TempLabel x={ROT.x}  y={40} temp={m?.runoutExitTemp || 0}     label="Coiler" />

        {/* === SECTION LABELS === */}
        <text x={210} y={175} textAnchor="middle" fontFamily={mono} fontSize={9} fill={C.textMuted}>ROUGHING</text>
        <text x={520} y={175} textAnchor="middle" fontFamily={mono} fontSize={9} fill={C.textMuted}>FINISHING STANDS</text>
        <text x={755} y={175} textAnchor="middle" fontFamily={mono} fontSize={9} fill={C.textMuted}>LAMINAR COOLING</text>
      </svg>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  FINISHING STAND TABLE
// ══════════════════════════════════════════════════════════════════════
function StandTable({ running, metrics }) {
  const stands = ["F1", "F2", "F3", "F4", "F5", "F6", "F7"];
  const m = metrics;
  const statuses = m?.stationStatus || {};

  function Cell({ v, unit, hi, warn, fault }) {
    const isWarn  = warn  !== undefined && v >= warn;
    const isFault = fault !== undefined && v >= fault;
    const color = isFault ? C.red : isWarn ? C.warn : C.textSoft;
    return (
      <td style={{ fontFamily: mono, fontSize: 11, color, padding: "5px 8px", textAlign: "right", borderBottom: `1px solid ${C.border}` }}>
        {running && v !== undefined ? `${typeof v === "number" ? v.toFixed(unit === "mm" ? 2 : 1) : v}${unit}` : "–"}
      </td>
    );
  }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>FINISHING STANDS – LIVE DATA</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.bgAlt }}>
              {["STAND", "STATUS", "SPEED (m/min)", "FORCE (MN)", "CURRENT (%FLA)", "TENSION (kN)"].map(h => (
                <th key={h} style={{ fontFamily: mono, fontSize: 9, color: C.textDim, padding: "6px 8px", textAlign: h === "STAND" || h === "STATUS" ? "left" : "right", borderBottom: `1px solid ${C.border}`, letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stands.map((id, i) => {
              const st = running ? (statuses[id] || "run") : "idle";
              const sc = statusColor(st);
              const current = m?.fCurrents?.[i];
              const speed   = m?.fSpeeds?.[i];
              const force   = m?.fForces?.[i];
              const tension = i < 6 ? m?.fTensions?.[i] : undefined;
              return (
                <tr key={id} style={{ background: st === "fault" ? `${C.fault}08` : "transparent" }}>
                  <td style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: C.text, padding: "5px 8px", borderBottom: `1px solid ${C.border}` }}>{id}</td>
                  <td style={{ padding: "5px 8px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: sc, boxShadow: st === "fault" ? `0 0 6px ${C.fault}` : "none" }}>
                        {st === "fault" && <style>{`@keyframes blink { 0%,100%{opacity:1}50%{opacity:0.2} }`}</style>}
                      </div>
                      <span style={{ fontFamily: mono, fontSize: 9, color: sc, textTransform: "uppercase" }}>{st}</span>
                    </div>
                  </td>
                  <Cell v={speed} unit="" warn={undefined} fault={undefined} />
                  <Cell v={force} unit="" warn={23} fault={27} />
                  <Cell v={current} unit="" warn={90} fault={100} />
                  <td style={{ fontFamily: mono, fontSize: 11, color: tension > 150 ? C.warn : C.textSoft, padding: "5px 8px", textAlign: "right", borderBottom: `1px solid ${C.border}` }}>
                    {running && tension !== undefined ? `${fmt0(tension)}` : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  TREND CHART
// ══════════════════════════════════════════════════════════════════════
const CHART_COLORS = { exitTemp: "#ff8800", exitThick: C.blue, exitSpeed: C.green };

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px" }}>
      {payload.map(p => (
        <div key={p.dataKey} style={{ fontFamily: mono, fontSize: 10, color: p.color, marginBottom: 2 }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value}
        </div>
      ))}
    </div>
  );
};

function TrendPanel({ trendData, running }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 20, alignItems: "center" }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>PROCESS TRENDS</span>
        {[
          { label: "Exit Temp (°C)", color: "#ff8800" },
          { label: "Thickness (mm)", color: C.blue },
          { label: "Exit Speed (m/min)", color: C.green },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: "12px 8px 4px", height: 160 }}>
        {trendData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" opacity={0.4} />
              <XAxis dataKey="t" hide />
              <YAxis yAxisId="temp" domain={[800, 1200]} tick={{ fontFamily: mono, fontSize: 9, fill: C.textDim }} width={38} />
              <YAxis yAxisId="thick" orientation="right" domain={[0, 15]} tick={{ fontFamily: mono, fontSize: 9, fill: C.textDim }} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Line yAxisId="temp"  type="monotone" dataKey="exitTemp"   name="Exit Temp (°C)"     stroke="#ff8800" dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line yAxisId="thick" type="monotone" dataKey="exitThick"  name="Thickness (mm)"     stroke={C.blue}  dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Line yAxisId="thick" type="monotone" dataKey="exitSpeed"  name="Speed (/10 m/min)"  stroke={C.green} dot={false} strokeWidth={1.5} isAnimationActive={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: mono, fontSize: 11, color: C.textMuted }}>
              {running ? "Collecting data..." : "Start the mill to see trends"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  KEY METRICS PANEL
// ══════════════════════════════════════════════════════════════════════
function MetricBox({ label, value, unit, warn, fault, status }) {
  const numVal = parseFloat(value);
  const isWarn  = warn  !== undefined && !isNaN(numVal) && numVal >= warn;
  const isFault = fault !== undefined && !isNaN(numVal) && numVal >= fault;
  const color = status === "fault" ? C.red : status === "warn" ? C.warn : isFault ? C.red : isWarn ? C.warn : C.gold;
  return (
    <div style={{ background: C.bgAlt, border: `1px solid ${isFault || status === "fault" ? C.fault : isWarn || status === "warn" ? C.warn : C.border}`, borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value ?? "–"}</span>
        {unit && <span style={{ fontFamily: mono, fontSize: 11, color: C.textDim }}>{unit}</span>}
      </div>
    </div>
  );
}

function MetricsPanel({ running, metrics, speedSP, thicknessSP, coilCount, meterCount }) {
  const m = metrics;
  const exitSpeedActual = m?.fSpeeds?.[6];
  const entryTemp = m?.entryTemp;
  const exitTemp  = m?.exitTemp;
  const exitThick = m?.exitThickness;
  const coilerTemp = m?.coilerTemp;

  // Guess at any fault status from stationStatus
  const hasFault = Object.values(m?.stationStatus || {}).includes("fault");
  const hasWarn  = Object.values(m?.stationStatus || {}).includes("warn");

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>KEY PROCESS VALUES</span>
      </div>
      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <MetricBox
          label="ENTRY TEMP"
          value={running && entryTemp ? fmt0(entryTemp) : "–"}
          unit="°C" warn={1160} fault={1180} />
        <MetricBox
          label="EXIT TEMP"
          value={running && exitTemp ? fmt0(exitTemp) : "–"}
          unit="°C" fault={950} />
        <MetricBox
          label="EXIT THICKNESS"
          value={running && exitThick ? exitThick.toFixed(2) : "–"}
          unit="mm"
          warn={thicknessSP + 0.12}
          fault={thicknessSP + 0.25} />
        <MetricBox
          label="EXIT SPEED"
          value={running && exitSpeedActual ? fmt0(exitSpeedActual) : "–"}
          unit="m/min" />
        <MetricBox
          label="COILER TEMP"
          value={running && coilerTemp ? fmt0(coilerTemp) : "–"}
          unit="°C" warn={620} fault={680} />
        <MetricBox
          label="MILL STATUS"
          value={!running ? "STOPPED" : hasFault ? "FAULT" : hasWarn ? "WARNING" : "RUNNING"}
          status={!running ? undefined : hasFault ? "fault" : hasWarn ? "warn" : undefined} />
        <MetricBox label="COILS PRODUCED"  value={fmt0(coilCount)} />
        <MetricBox label="METERS ROLLED"   value={meterCount > 1000 ? `${(meterCount / 1000).toFixed(1)}k` : fmt0(meterCount)} />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  ALARM LOG
// ══════════════════════════════════════════════════════════════════════
function AlarmLog({ alarms, alarmHistory, running }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>ALARM LOG</span>
        {alarms.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.fault }}>
              <style>{`@keyframes blink2{0%,100%{opacity:1}50%{opacity:0.15}}`}</style>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.fault, animation: "blink2 1s infinite" }} />
            </div>
            <span style={{ fontFamily: mono, fontSize: 10, color: C.fault }}>{alarms.length} ACTIVE</span>
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", maxHeight: 240 }}>
        {alarms.length === 0 && alarmHistory.length === 0 && (
          <div style={{ padding: "20px 16px", fontFamily: mono, fontSize: 11, color: C.textMuted, textAlign: "center" }}>
            {running ? "No active alarms" : "Mill stopped – no alarms"}
          </div>
        )}
        {alarms.map((a) => (
          <div key={a.id} style={{
            padding: "8px 16px",
            borderBottom: `1px solid ${C.border}`,
            borderLeft: `3px solid ${a.level === "FAULT" ? C.fault : C.warn}`,
            background: a.level === "FAULT" ? `${C.fault}08` : `${C.warn}06`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: a.level === "FAULT" ? C.fault : C.warn, letterSpacing: "0.08em" }}>{a.level}</span>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>
                {a.time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.textSoft, lineHeight: 1.5 }}>{a.text}</div>
          </div>
        ))}
        {alarmHistory.slice(-8).reverse().map((a, i) => (
          <div key={i} style={{
            padding: "6px 16px",
            borderBottom: `1px solid ${C.border}`,
            opacity: 0.45,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>CLR – {a.level}</span>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>
                {a.time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>{a.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  INFO PANEL
// ══════════════════════════════════════════════════════════════════════
const INFO_TABS = ["About", "Process", "Built By"];

function InfoPanel({ onClose }) {
  const [tab, setTab] = useState(0);
  return (
    <div style={{
      position: "absolute", top: 60, right: 16, width: 360, zIndex: 200,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: "0 24px 64px #0009", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: heading, fontSize: 15, fontWeight: 700, color: C.text }}>SCADA HMI Dashboard</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
      </div>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {INFO_TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            flex: 1, padding: "9px 0", background: tab === i ? C.goldSubtle : "transparent",
            border: "none", borderBottom: tab === i ? `2px solid ${C.gold}` : "2px solid transparent",
            color: tab === i ? C.gold : C.textDim, fontFamily: mono, fontSize: 10,
            cursor: "pointer", letterSpacing: "0.05em",
          }}>{t}</button>
        ))}
      </div>
      <div style={{ padding: "16px 18px", maxHeight: 340, overflowY: "auto" }}>
        {tab === 0 && (
          <div style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.7 }}>
            <p style={{ marginBottom: 12 }}>A SCADA-style operator interface for a hot rolling mill, built as a browser simulation. It mirrors the kind of HMI screens I worked with at ArcelorMittal Eisenhüttenstadt.</p>
            <p style={{ marginBottom: 12 }}>The mill processes a transfer bar (~180mm thick, ~1150°C) through four roughing stands, a crop shear, seven finishing stands, a laminar cooling bed, and finally coils it at around 550–600°C.</p>
            <p>Use the controls at the bottom to start the mill, adjust speed and target thickness, or inject faults to see how the alarm system responds.</p>
          </div>
        )}
        {tab === 1 && (
          <div style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.7 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, marginBottom: 4 }}>ROUGHING (R1–R4)</div>
              <p style={{ marginBottom: 8 }}>Reduces the transfer bar from ~180mm to ~18mm. Four passes, moderate speed (~30–60 m/min). The crop shear (CS) removes the head and tail before finishing.</p>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, marginBottom: 4 }}>FINISHING (F1–F7)</div>
              <p style={{ marginBottom: 8 }}>Seven stands in tandem reduce the strip to 2–12mm at 300–900 m/min. Speed is controlled as a cascade – each stand must match mass flow (v × h = constant). Tension between stands is monitored to detect cascade faults.</p>
            </div>
            <div>
              <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, marginBottom: 4 }}>LAMINAR COOLING (ROT)</div>
              <p>Water curtains on the run-out table drop the strip from ~880°C to ~580°C for coiling. Cooling rate determines final steel properties.</p>
            </div>
          </div>
        )}
        {tab === 2 && (
          <div style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.7 }}>
            <p style={{ marginBottom: 12 }}>Built by <span style={{ color: C.gold }}>Egemen Birol</span> – electrical and electronics engineer, M.Sc. AI candidate based in Germany.</p>
            <p style={{ marginBottom: 12 }}>The process values and fault types are based on real equipment I worked with at ArcelorMittal's hot rolling mill (Warmwalzwerk) in Eisenhüttenstadt – Siemens S7 PLCs, ABB ACS880 drives, WinCC SCADA.</p>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              React 18 + Recharts · No backend · All physics client-side
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
const FAULT_OPTIONS = [
  { id: "none",          label: "Normal Operation" },
  { id: "cobble_f4",    label: "Strip Cobble – F4" },
  { id: "overcurrent_f6", label: "F6 Overcurrent" },
  { id: "cooling_fault", label: "Cooling Pressure Low" },
  { id: "speed_cascade", label: "Speed Cascade – F3/F4" },
];

const PRESETS = [
  { label: "Threading",  speed: 120,  thick: 8.0  },
  { label: "Normal",     speed: 540,  thick: 4.0  },
  { label: "High Speed", speed: 840,  thick: 2.5  },
];

export default function SCADADashboard() {
  const [running,     setRunning]     = useState(false);
  const [speedSP,     setSpeedSP]     = useState(540);
  const [thicknessSP, setThicknessSP] = useState(4.0);
  const [faultType,   setFaultType]   = useState("none");
  const [showInfo,    setShowInfo]    = useState(false);
  const [alarms,      setAlarms]      = useState([]);
  const [alarmHistory, setAlarmHistory] = useState([]);
  const [trendData,   setTrendData]   = useState([]);
  const [metrics,     setMetrics]     = useState(null);
  const [tick,        setTick]        = useState(0);
  const [coilCount,   setCoilCount]   = useState(0);
  const [meterCount,  setMeterCount]  = useState(0);
  const [time,        setTime]        = useState(new Date());
  const prevAlarmIds = useRef(new Set());
  const coilTimer    = useRef(0);

  useInterval(() => setTime(new Date()), 1000);

  useInterval(() => {
    setTick(t => t + 1);
    if (!running) { setMetrics(null); return; }

    const f = faultType;

    // ── temperatures ──────────────────────────────────────────────
    const entryTemp       = noise(1138, 9);
    const roughingExitTemp = noise(1078, 10);
    const fStandTemps     = [1052, 1015, 978, 944, 912, 886, 862].map((b, i) => {
      return noise(f === "cooling_fault" && i >= 3 ? b + 38 : b, 7);
    });
    const exitTemp        = noise(f === "cooling_fault" ? 928 : 862, 8);
    const runoutExitTemp  = noise(f === "cooling_fault" ? 685  : 582, 11);
    const coilerTemp      = noise(f === "cooling_fault" ? 650  : 558, 8);

    // ── thickness ─────────────────────────────────────────────────
    const exitThickness   = noise(thicknessSP, 0.06);

    // ── speeds via mass flow continuity (v × h = const) ──────────
    const th = thicknessSP;
    const finishingThickIn = [18, 12, 8, 6, 4.5, 3.2, th + 0.1];
    const fSpeeds = finishingThickIn.map((tin, i) => {
      let v = speedSP * th / tin;
      if (f === "speed_cascade" && (i === 2 || i === 3)) v += noise(0, v * 0.03);
      if (f === "cobble_f4"    && i >= 3)                v = 0;
      return Math.max(0, v + noise(0, 1.5));
    });
    const rSpeeds = [180, 100, 55, 30].map(tin => noise(speedSP * th / tin * 0.55, 1.5));

    // ── rolling forces (MN) ────────────────────────────────────────
    const fForces = [22, 20, 18.5, 16.5, 14, 12, 10].map((b, i) => {
      let v = noise(b, 0.5);
      if (f === "cobble_f4" && i === 3) v = noise(32, 2);
      return v;
    });

    // ── motor currents (%FLA) ──────────────────────────────────────
    const fCurrents = [72, 68, 65, 62, 58, 55, 52].map((b, i) => {
      let v = noise(b, 3);
      if (f === "overcurrent_f6" && i === 5) v = noise(112, 5);
      if (f === "cobble_f4"      && i === 3) v = noise(145, 8);
      if (f === "cobble_f4"      && i >  3)  v = 0;
      return clamp(v, 0, 200);
    });

    // ── inter-stand tension (kN) ───────────────────────────────────
    const fTensions = Array.from({ length: 6 }, (_, i) => {
      let v = noise(122, 10);
      if (f === "speed_cascade" && i === 2) v = noise(185, 22);
      return v;
    });

    // ── station statuses ──────────────────────────────────────────
    const stationStatus = {};
    ["EC","R1","R2","R3","R4","CS","F1","F2","F3","F4","F5","F6","F7","ROT","DC1","DC2"]
      .forEach(id => { stationStatus[id] = "run"; });
    if (f === "cobble_f4")     { ["F4","F5","F6","F7"].forEach(id => stationStatus[id] = "fault"); }
    if (f === "overcurrent_f6"){ stationStatus["F6"] = "fault"; }
    if (f === "cooling_fault") { stationStatus["ROT"] = "warn"; }
    if (f === "speed_cascade") { stationStatus["F3"] = "warn"; stationStatus["F4"] = "warn"; }

    setMetrics({ entryTemp, roughingExitTemp, fStandTemps, exitTemp, runoutExitTemp, coilerTemp,
      exitThickness, fSpeeds, rSpeeds, fForces, fCurrents, fTensions, stationStatus });

    // ── alarms ────────────────────────────────────────────────────
    const newAlarms = [];
    if (f === "cobble_f4")     newAlarms.push({ id: "cobble",  level: "FAULT", text: "Strip cobble at F4 – tandem line stopping. Check pinch rolls.", time: new Date() });
    if (f === "overcurrent_f6") newAlarms.push({ id: "oc_f6",  level: "FAULT", text: `F6 drive overcurrent: ${fCurrents[5].toFixed(0)}% FLA (limit: 100%)`, time: new Date() });
    if (f === "cooling_fault") newAlarms.push({ id: "cool",    level: "WARN",  text: "Laminar cooling water pressure low: 1.8 bar (SP: 3.2 bar)", time: new Date() });
    if (f === "speed_cascade") newAlarms.push({ id: "cascade", level: "WARN",  text: `F3/F4 inter-stand tension: ${fTensions[2].toFixed(0)} kN (limit: 150 kN)`, time: new Date() });
    if (exitTemp    > 950)     newAlarms.push({ id: "temp_hi", level: "FAULT", text: `Exit temperature high: ${fmt0(exitTemp)}°C (limit: 950°C)`, time: new Date() });
    if (exitThickness > thicknessSP + 0.2) newAlarms.push({ id: "thick_hi", level: "WARN", text: `Exit thickness high: ${exitThickness.toFixed(2)} mm (SP: ${thicknessSP} mm)`, time: new Date() });
    if (exitThickness < thicknessSP - 0.2) newAlarms.push({ id: "thick_lo", level: "WARN", text: `Exit thickness low: ${exitThickness.toFixed(2)} mm (SP: ${thicknessSP} mm)`, time: new Date() });

    // archive cleared alarms
    const newIds = new Set(newAlarms.map(a => a.id));
    const cleared = [...prevAlarmIds.current].filter(id => !newIds.has(id));
    if (cleared.length > 0) {
      const prev = alarms.filter(a => cleared.includes(a.id));
      setAlarmHistory(h => [...h, ...prev].slice(-20));
    }
    prevAlarmIds.current = newIds;
    setAlarms(newAlarms);

    // ── production meters ─────────────────────────────────────────
    const exitSpeed = fSpeeds[6] || 0;
    const addedMeters = exitSpeed * TICK_MS / 60000;
    setMeterCount(c => c + addedMeters);

    coilTimer.current += addedMeters;
    if (coilTimer.current >= 1800) { // ~1800m per coil
      setCoilCount(c => c + 1);
      coilTimer.current = 0;
    }

    // ── trend data ────────────────────────────────────────────────
    setTrendData(prev => {
      const pt = {
        t: tick,
        exitTemp,
        exitThick: exitThickness,
        exitSpeed: exitSpeed / 100, // scaled: divide by 100 so visible on same axis as thickness
      };
      const next = [...prev, pt];
      return next.length > MAX_TREND ? next.slice(-MAX_TREND) : next;
    });
  }, TICK_MS);

  // Reset meters/coils when mill stopped and restarted
  const handleStart = () => {
    setRunning(true);
    setTrendData([]);
  };
  const handleStop = () => {
    setRunning(false);
    setAlarms([]);
    setMetrics(null);
  };

  const hasFault = alarms.some(a => a.level === "FAULT");
  const hasWarn  = alarms.some(a => a.level === "WARN");

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: body, minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:0.15} }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div style={{
        height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", background: C.bgAlt, borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        {/* Left: plant ID */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: running ? C.run : C.idle, boxShadow: running ? `0 0 8px ${C.run}88` : "none" }} />
            <span style={{ fontFamily: heading, fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>
              Warmwalzwerk – Hot Rolling Mill HMI
            </span>
          </div>
          <div style={{ height: 24, width: 1, background: C.border }} />
          <div style={{ fontFamily: mono, fontSize: 10, color: running ? (hasFault ? C.fault : hasWarn ? C.warn : C.run) : C.textMuted, letterSpacing: "0.08em" }}>
            {running ? (hasFault ? "● FAULT" : hasWarn ? "▲ WARNING" : "● RUNNING") : "○ STOPPED"}
          </div>
        </div>

        {/* Center: production counter */}
        <div style={{ display: "flex", gap: 24 }}>
          {[
            { label: "COILS", value: fmt0(coilCount) },
            { label: "METERS", value: meterCount > 1000 ? `${(meterCount / 1000).toFixed(1)}k` : fmt0(meterCount) },
            { label: "SP SPEED", value: `${speedSP} m/min` },
            { label: "SP THICK", value: `${thicknessSP} mm` },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 8, color: C.textDim, letterSpacing: "0.1em" }}>{label}</div>
              <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: C.textSoft }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Right: clock + info button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, color: C.text, letterSpacing: "0.04em" }}>
              {time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>
              {time.toLocaleDateString("de-DE")}
            </div>
          </div>
          <button onClick={() => setShowInfo(v => !v)} style={{
            width: 32, height: 32, borderRadius: 8, border: `1px solid ${showInfo ? C.goldDim : C.border}`,
            background: showInfo ? C.goldSubtle : "transparent", cursor: "pointer",
            fontFamily: mono, fontSize: 13, color: showInfo ? C.gold : C.textDim,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
          }}>?</button>
        </div>
      </div>

      {/* Info panel */}
      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}

      {/* ── MAIN CONTENT ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: 10, overflow: "hidden" }}>

        {/* Row 1: Process flow (full width) */}
        <ProcessFlow running={running} metrics={metrics} faultType={faultType} />

        {/* Row 2: Stand table + Trend chart */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, minHeight: 0 }}>
          <StandTable running={running} metrics={metrics} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <MetricsPanel running={running} metrics={metrics} speedSP={speedSP} thicknessSP={thicknessSP} coilCount={coilCount} meterCount={meterCount} />
            <TrendPanel trendData={trendData} running={running} />
          </div>
        </div>

        {/* Row 3: Alarm log */}
        <AlarmLog alarms={alarms} alarmHistory={alarmHistory} running={running} />
      </div>

      {/* ── CONTROLS BAR ───────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        background: C.bgAlt, borderTop: `1px solid ${C.border}`,
        padding: "10px 20px", display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
      }}>
        {/* Start/Stop */}
        <button onClick={running ? handleStop : handleStart} style={{
          padding: "8px 22px", borderRadius: 8, border: "none", cursor: "pointer",
          fontFamily: mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
          background: running ? C.fault : C.run, color: "#fff",
          transition: "opacity 0.2s",
        }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}
        >
          {running ? "■ STOP MILL" : "▶ START MILL"}
        </button>

        <div style={{ height: 32, width: 1, background: C.border }} />

        {/* Presets */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em" }}>PRESET</span>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => { setSpeedSP(p.speed); setThicknessSP(p.thick); }} style={{
              padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontFamily: mono, fontSize: 10,
              background: speedSP === p.speed && thicknessSP === p.thick ? C.goldSubtle : "transparent",
              border: `1px solid ${speedSP === p.speed && thicknessSP === p.thick ? C.goldDim : C.border}`,
              color: speedSP === p.speed && thicknessSP === p.thick ? C.gold : C.textDim,
              transition: "all 0.2s",
            }}>{p.label}</button>
          ))}
        </div>

        <div style={{ height: 32, width: 1, background: C.border }} />

        {/* Speed setpoint */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>EXIT SPEED</span>
          <input type="range" min={60} max={900} step={30} value={speedSP} onChange={e => setSpeedSP(+e.target.value)}
            style={{ width: 90, accentColor: C.gold }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: C.textSoft, minWidth: 55 }}>{speedSP} m/min</span>
        </div>

        {/* Thickness setpoint */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>THICKNESS</span>
          <input type="range" min={2} max={12} step={0.5} value={thicknessSP} onChange={e => setThicknessSP(+e.target.value)}
            style={{ width: 80, accentColor: C.blue }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: C.textSoft, minWidth: 32 }}>{thicknessSP} mm</span>
        </div>

        <div style={{ height: 32, width: 1, background: C.border }} />

        {/* Fault injection */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>INJECT FAULT</span>
          <select value={faultType} onChange={e => setFaultType(e.target.value)} style={{
            background: C.card, border: `1px solid ${faultType !== "none" ? C.fault : C.border}`,
            borderRadius: 6, padding: "5px 10px", color: faultType !== "none" ? C.fault : C.textSoft,
            fontFamily: mono, fontSize: 10, cursor: "pointer", outline: "none",
          }}>
            {FAULT_OPTIONS.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", fontFamily: mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.06em" }}>
          SIM · ArcelorMittal Eisenhüttenstadt – Warmwalzwerk
        </div>
      </div>
    </div>
  );
}
