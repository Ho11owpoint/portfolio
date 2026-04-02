import { useState, useEffect, useRef } from "react";

// ══════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#161a22", bgAlt: "#1b2029", panel: "#1f242e", card: "#232933",
  border: "#2e3542",
  gold: "#c9a227", goldDim: "#c9a22733", goldSubtle: "#c9a22712",
  green: "#3d9e4f", blue: "#4a8fd4", orange: "#c47a2e", red: "#b54a4a",
  text: "#dce0e8", textSoft: "#a8aebb", textDim: "#6e7788",
  textMuted: "#454d5c", textFaint: "#2e3440",
};
const mono    = "'JetBrains Mono', 'Fira Code', monospace";
const heading = "'Syne', 'Inter', sans-serif";
const body    = "'Outfit', 'Inter', sans-serif";

// ══════════════════════════════════════════════════════════════════════
//  CANVAS GEOMETRY  (all drawing is in this coordinate space)
// ══════════════════════════════════════════════════════════════════════
const CW = 960;
const CH = 420;

const BELT_CY  = 178;   // belt centerline y
const BELT_TOP = 152;   // belt top edge
const BELT_BOT = 204;   // belt bottom edge

// Sensor x-positions (optical gate = two posts + beam)
const SENSORS  = [195, 420, 645];
// Diverter x-positions (pivot point of the deflector arm)
const DIVS     = [275, 500, 725];

// Output lane geometry
const LANE_Y   = 350;   // y of the top of output bins
const BIN_H    = 48;
const BIN_W    = 74;
// Bin center x for each lane (0=A, 1=B, 2=Reject, 3=End-of-line)
const BIN_CX   = [DIVS[0] + 85, DIVS[1] + 85, DIVS[2] + 85, CW - 30];

// Which package type does each diverter catch?
// D0 → 'A', D1 → 'B', D2 → 'X' (defective)
const SORT_TYPES = ["A", "B", "X"];

const LANE_COLORS = ["#4a8fd4", "#c9a227", "#b54a4a", "#6e7788"];
const LANE_LABELS = ["Lane A", "Lane B", "Reject",  "End-of-Line"];

// Package visual definitions
const PKG = {
  A: { bodyFill: "#1e5a8a", topFill: "#4aadee", label: "A",  name: "Profile A" },
  B: { bodyFill: "#7a5a08", topFill: "#d4a820", label: "B",  name: "Profile B" },
  C: { bodyFill: "#1a5a28", topFill: "#45b558", label: "C",  name: "Profile C" },
  X: { bodyFill: "#7a1a1a", topFill: "#cc4444", label: "✕", name: "Defective"  },
};

// ══════════════════════════════════════════════════════════════════════
//  PACKAGE FACTORY
// ══════════════════════════════════════════════════════════════════════
let _pkgId = 0;

function spawnPackage(defectRate) {
  _pkgId++;
  const r = Math.random();
  let type;
  if (Math.random() < defectRate) type = "X";
  else if (r < 0.32) type = "A";
  else if (r < 0.64) type = "B";
  else type = "C";

  const diverterIdx = SORT_TYPES.indexOf(type); // -1 for type C
  const lane = diverterIdx >= 0 ? diverterIdx : 3;

  return {
    id: _pkgId,
    x: -30,
    y: BELT_CY,
    type,
    lane,
    diverterIdx,
    divertAtX: diverterIdx >= 0 ? DIVS[diverterIdx] : 9999,
    phase: "belt", // 'belt' | 'divert' | 'done'
    vx: 0,
    vy: 0,
    w: 44,
    h: 28,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  CANVAS DRAW HELPERS
// ══════════════════════════════════════════════════════════════════════

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

function drawBackground(ctx) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CW, CH);
  // subtle grid
  ctx.strokeStyle = "#ffffff05";
  ctx.lineWidth = 1;
  for (let x = 0; x <= CW; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke();
  }
  for (let y = 0; y <= CH; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke();
  }
}

function drawChutes(ctx) {
  DIVS.forEach((dx, i) => {
    const bx = BIN_CX[i];
    const col = LANE_COLORS[i];
    // Left wall of chute
    ctx.strokeStyle = col + "44";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx + 2,  BELT_BOT + 4);
    ctx.lineTo(bx - BIN_W / 2, LANE_Y);
    ctx.stroke();
    // Right wall
    ctx.beginPath();
    ctx.moveTo(dx + 22, BELT_BOT + 4);
    ctx.lineTo(bx + BIN_W / 2, LANE_Y);
    ctx.stroke();
    // Diverter label
    ctx.fillStyle = "#454d5c";
    ctx.font = `9px ${mono}`;
    ctx.textAlign = "center";
    ctx.fillText(`D${i + 1}`, dx + 12, BELT_BOT + 18);
  });
}

function drawBins(ctx, counts) {
  BIN_CX.forEach((bx, i) => {
    const col = LANE_COLORS[i];
    const by  = LANE_Y;
    const bx0 = bx - BIN_W / 2;

    // Shadow
    ctx.fillStyle = "#00000055";
    ctx.fillRect(bx0 + 3, by + 3, BIN_W, BIN_H);

    // Body
    ctx.fillStyle = C.card;
    ctx.strokeStyle = col + "88";
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx0, by, BIN_W, BIN_H);
    ctx.strokeRect(bx0, by, BIN_W, BIN_H);

    // Top accent bar
    ctx.fillStyle = col + "55";
    ctx.fillRect(bx0, by, BIN_W, 5);

    // Count
    ctx.fillStyle = col;
    ctx.font = `700 20px ${mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(counts[i] ?? 0, bx, by + 26);

    // Label
    ctx.fillStyle = "#6e7788";
    ctx.font = `9px ${mono}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(LANE_LABELS[i], bx, by + BIN_H - 5);
  });
  ctx.textAlign = "left";
}

function drawBelt(ctx, offset) {
  // Main belt body
  ctx.fillStyle = "#1c2230";
  ctx.fillRect(0, BELT_TOP, CW, BELT_BOT - BELT_TOP);

  // Top and bottom edges
  ctx.fillStyle = "#252d3a";
  ctx.fillRect(0, BELT_TOP, CW, 5);
  ctx.fillRect(0, BELT_BOT - 5, CW, 5);

  // Animated belt surface dashes
  ctx.save();
  ctx.strokeStyle = "#ffffff10";
  ctx.lineWidth = 3;
  ctx.setLineDash([22, 16]);
  ctx.lineDashOffset = -offset;
  ctx.beginPath();
  ctx.moveTo(0, BELT_CY - 8);
  ctx.lineTo(CW, BELT_CY - 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, BELT_CY + 8);
  ctx.lineTo(CW, BELT_CY + 8);
  ctx.stroke();
  ctx.restore();

  // Left and right drive rollers
  for (const rx of [18, CW - 18]) {
    const ry = BELT_CY;
    const rr = (BELT_BOT - BELT_TOP) / 2 + 2;
    ctx.fillStyle = "#252d3a";
    ctx.beginPath();
    ctx.ellipse(rx, ry, 18, rr, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a4250";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Hub
    ctx.fillStyle = "#3a4250";
    ctx.beginPath();
    ctx.arc(rx, ry, 5, 0, Math.PI * 2);
    ctx.fill();
    // Spokes hint
    for (let a = 0; a < 4; a++) {
      const ang = (a / 4) * Math.PI * 2 + offset * 0.04;
      ctx.strokeStyle = "#3a425066";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx + Math.cos(ang) * 5, ry + Math.sin(ang) * 5);
      ctx.lineTo(rx + Math.cos(ang) * 14, ry + Math.sin(ang) * 14);
      ctx.stroke();
    }
  }
}

function drawSensors(ctx, sensorActive, tick) {
  SENSORS.forEach((sx, i) => {
    const active = sensorActive[i];
    const gateCol = active ? C.gold : "#3a4250";

    // Gate posts
    ctx.fillStyle = gateCol;
    ctx.fillRect(sx - 3, BELT_TOP - 26, 6, 26);
    ctx.fillRect(sx - 3, BELT_BOT, 6, 26);

    // Bracket tops
    ctx.fillRect(sx - 10, BELT_TOP - 30, 20, 6);
    ctx.fillRect(sx - 10, BELT_BOT + 22, 20, 6);

    // Light beam
    const alpha = active ? 0.45 : 0.12;
    ctx.fillStyle = active
      ? `rgba(201,162,39,${alpha})`
      : `rgba(74,143,212,${alpha})`;
    ctx.fillRect(sx - 1, BELT_TOP, 2, BELT_BOT - BELT_TOP);

    // LED indicator (pulsing when idle, solid when active)
    const pulse = active ? 1 : 0.4 + 0.2 * Math.sin(tick * 0.12 + i * 1.2);
    ctx.fillStyle = active
      ? `rgba(201,162,39,${pulse})`
      : `rgba(74,143,212,${pulse})`;
    ctx.beginPath();
    ctx.arc(sx, BELT_TOP - 22, 5, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = `rgba(201,162,39,0.4)`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Label
    ctx.fillStyle = "#454d5c";
    ctx.font = `9px ${mono}`;
    ctx.textAlign = "center";
    ctx.fillText(`S${i + 1}`, sx, BELT_TOP - 34);
  });
  ctx.textAlign = "left";
}

function drawDiverters(ctx, diverterActive) {
  DIVS.forEach((dx, i) => {
    const active = diverterActive[i];

    // Base indicator dot
    ctx.fillStyle = active ? C.gold : "#2e3542";
    ctx.beginPath();
    ctx.arc(dx + 6, BELT_CY, 5, 0, Math.PI * 2);
    ctx.fill();
    if (active) {
      ctx.strokeStyle = C.gold + "55";
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // Deflector arm
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    if (active) {
      // Rotated ~40° down-right to guide package off belt
      ctx.strokeStyle = C.gold;
      ctx.shadowColor = C.gold;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(dx + 6, BELT_CY - 12);
      ctx.lineTo(dx + 38, BELT_CY + 18);
      ctx.stroke();
      ctx.shadowBlur = 0;
    } else {
      // Flat (neutral) position
      ctx.strokeStyle = "#2e3542";
      ctx.beginPath();
      ctx.moveTo(dx + 6, BELT_CY - 14);
      ctx.lineTo(dx + 6, BELT_CY + 14);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  });
}

function drawPackages(ctx, packages) {
  packages.forEach((p) => {
    if (p.phase === "done") return;
    const info = PKG[p.type];
    const { x, y, w, h } = p;
    const r = 4;

    // Drop shadow
    ctx.fillStyle = "#00000060";
    roundRect(ctx, x - w / 2 + 2, y - h / 2 + 3, w, h, r);
    ctx.fill();

    // Body
    ctx.fillStyle = info.bodyFill;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, r);
    ctx.fill();

    // Top highlight strip
    ctx.fillStyle = info.topFill;
    roundRect(ctx, x - w / 2, y - h / 2, w, 7, [r, r, 0, 0]);
    ctx.fill();

    // Label
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 13px ${mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(info.label, x, y + 2);
    ctx.textBaseline = "alphabetic";
  });
  ctx.textAlign = "left";
}

function drawJamOverlay(ctx) {
  ctx.fillStyle = "#b54a4a18";
  ctx.fillRect(0, BELT_TOP, CW, BELT_BOT - BELT_TOP);
  ctx.strokeStyle = "#b54a4a66";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(2, BELT_TOP + 2, CW - 4, BELT_BOT - BELT_TOP - 4);
  ctx.setLineDash([]);
  ctx.fillStyle = "#b54a4a";
  ctx.font = `700 11px ${mono}`;
  ctx.textAlign = "center";
  ctx.fillText("⚠ BELT JAM", CW / 2, BELT_CY + 4);
  ctx.textAlign = "left";
}

// ══════════════════════════════════════════════════════════════════════
//  INFO PANEL
// ══════════════════════════════════════════════════════════════════════
function InfoPanel({ onClose }) {
  const [tab, setTab] = useState(0);
  const tabs = ["About", "How It Works", "Built By"];
  return (
    <div style={{
      position: "absolute", top: 62, right: 16, width: 360, zIndex: 300,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: "0 24px 64px #000a", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontFamily: heading, fontSize: 15, fontWeight: 700, color: C.text }}>Industrial Digital Twin</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.textDim, fontSize: 18, cursor: "pointer" }}>×</button>
      </div>
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
        {tabs.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} style={{
            flex: 1, padding: "9px 0", background: tab === i ? C.goldSubtle : "transparent",
            border: "none", borderBottom: tab === i ? `2px solid ${C.gold}` : "2px solid transparent",
            color: tab === i ? C.gold : C.textDim, fontFamily: mono, fontSize: 10,
            cursor: "pointer", letterSpacing: "0.05em",
          }}>{t}</button>
        ))}
      </div>
      <div style={{ padding: "16px 18px", fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.7 }}>
        {tab === 0 && (
          <>
            <p style={{ marginBottom: 10 }}>A real-time digital twin of an industrial conveyor sorting line. Packages travel along a belt, get identified by optical sensors, and are routed to output lanes by pneumatic diverter arms.</p>
            <p>This is the kind of system you'd see in steel coil tagging lines, automotive part sorting, or logistics hubs. Adjust speed, package rate, defect rate, and inject faults to see how the system responds.</p>
          </>
        )}
        {tab === 1 && (
          <>
            <p style={{ marginBottom: 10 }}>Three optical sensors (S1–S3) detect packages as they pass. Each sensor triggers the diverter downstream if the package type matches the sort rule for that diverter.</p>
            <p style={{ marginBottom: 10 }}>Sort rules: D1 → Profile A → Lane A, D2 → Profile B → Lane B, D3 → Defective → Reject. Profile C passes all diverters and reaches End-of-Line.</p>
            <p>Inject faults to test system behavior: a belt jam stops all movement, a stuck diverter misroutes packages and inflates the reject count.</p>
          </>
        )}
        {tab === 2 && (
          <>
            <p style={{ marginBottom: 10 }}>Built by <span style={{ color: C.gold }}>Egemen Birol</span> – electrical engineer, M.Sc. AI candidate in Germany.</p>
            <p>Built with React 18 + Canvas API. All simulation runs client-side with requestAnimationFrame for smooth 60fps animation. No physics engine or external libraries used.</p>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              React 18 · Canvas API · 60fps rAF loop · No dependencies
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function DigitalTwin() {
  const canvasRef     = useRef(null);

  // "Game state" ref – mutable values the animation loop reads directly
  const gsRef = useRef({
    running:      false,
    speedPx:      2.2,    // pixels per frame at 60fps
    spawnFrames:  110,    // frames between package spawns
    defectRate:   0.08,
    faultType:    "none",
  });

  // Mutable simulation data
  const packagesRef      = useRef([]);
  const countsRef        = useRef([0, 0, 0, 0]);
  const totalRef         = useRef(0);
  const beltOffsetRef    = useRef(0);
  const spawnTimerRef    = useRef(0);
  const sensorActiveRef  = useRef([false, false, false]);
  const diverterActiveRef = useRef([false, false, false]);
  const tickRef          = useRef(0);
  const rafRef           = useRef(null);
  const tpRef            = useRef({ lastT: Date.now(), lastTotal: 0, rate: 0 });

  // React state (UI only)
  const [running,     setRunning]     = useState(false);
  const [speed,       setSpeed]       = useState(2.2);
  const [spawnFrames, setSpawnFrames] = useState(110);
  const [defectRate,  setDefectRate]  = useState(0.08);
  const [faultType,   setFaultType]   = useState("none");
  const [showInfo,    setShowInfo]    = useState(false);
  const [stats, setStats] = useState({ counts: [0, 0, 0, 0], total: 0, tph: 0 });

  // Sync React state → gsRef
  useEffect(() => { gsRef.current.running     = running;    }, [running]);
  useEffect(() => { gsRef.current.speedPx     = speed;      }, [speed]);
  useEffect(() => { gsRef.current.spawnFrames = spawnFrames;}, [spawnFrames]);
  useEffect(() => { gsRef.current.defectRate  = defectRate; }, [defectRate]);
  useEffect(() => { gsRef.current.faultType   = faultType;  }, [faultType]);

  // ── ANIMATION LOOP ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let lastStatsT = Date.now();

    function frame() {
      rafRef.current = requestAnimationFrame(frame);
      const gs = gsRef.current;
      tickRef.current++;
      const tick = tickRef.current;

      // ── UPDATE ──────────────────────────────────────────────
      const jammed = gs.faultType === "belt_jam";
      const stuckDiv = gs.faultType === "diverter_stuck" ? 1 : -1; // D2 stuck open

      if (gs.running) {
        // Belt texture offset
        if (!jammed) beltOffsetRef.current = (beltOffsetRef.current + gs.speedPx * 0.55) % 38;

        // Spawn packages
        spawnTimerRef.current++;
        if (spawnTimerRef.current >= gs.spawnFrames) {
          spawnTimerRef.current = 0;
          packagesRef.current.push(spawnPackage(gs.defectRate));
        }

        // Reset per-frame booleans
        sensorActiveRef.current  = [false, false, false];
        diverterActiveRef.current = [false, false, false];

        packagesRef.current = packagesRef.current.filter((p) => {
          if (p.phase === "done") return false;

          if (p.phase === "belt") {
            if (!jammed) p.x += gs.speedPx;

            // Sensor beam detection
            SENSORS.forEach((sx, i) => {
              if (Math.abs(p.x - sx) < p.w / 2 + 2) {
                sensorActiveRef.current[i] = true;
              }
            });

            // Check divert condition
            if (!jammed && p.x >= p.divertAtX && p.diverterIdx >= 0) {
              const stuck = p.diverterIdx === stuckDiv;
              if (!stuck) {
                // Kick off divert: compute velocity toward bin
                p.phase = "divert";
                const tx = BIN_CX[p.lane];
                const ty = LANE_Y + BIN_H / 2;
                const frames = 32;
                p.vx = (tx - p.x) / frames;
                p.vy = (ty - p.y) / frames;
                diverterActiveRef.current[p.diverterIdx] = true;
              }
            }

            // Fell off the end of belt
            if (p.x > CW + 40) {
              p.phase = "done";
              countsRef.current[3]++;
              totalRef.current++;
            }
          } else if (p.phase === "divert") {
            p.x += p.vx;
            p.y += p.vy;
            diverterActiveRef.current[p.diverterIdx] = true;

            // Arrived at bin?
            const tx = BIN_CX[p.lane];
            const ty = LANE_Y + BIN_H / 2;
            const d  = Math.hypot(p.x - tx, p.y - ty);
            if (d < 12 || p.y > CH + 10) {
              p.phase = "done";
              if (d < 12) {
                countsRef.current[p.lane]++;
                totalRef.current++;
              }
            }
          }

          return true;
        });
      }

      // ── DRAW ────────────────────────────────────────────────
      drawBackground(ctx);
      drawChutes(ctx);
      drawBins(ctx, countsRef.current);
      drawBelt(ctx, beltOffsetRef.current);
      if (jammed && gs.running) drawJamOverlay(ctx);
      drawSensors(ctx, sensorActiveRef.current, tick);
      drawDiverters(ctx, diverterActiveRef.current);
      drawPackages(ctx, packagesRef.current);

      // Stopped overlay
      if (!gs.running) {
        ctx.fillStyle = "#00000055";
        ctx.fillRect(0, 0, CW, CH);
        ctx.fillStyle = "#6e7788";
        ctx.font = `500 15px ${body}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Press  ▶ START  to begin simulation", CW / 2, CH / 2);
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }

      // Sync stats to React every 500ms (avoids re-render storm)
      const now = Date.now();
      if (now - lastStatsT > 500) {
        const elapsed = (now - tpRef.current.lastT) / 1000;
        const added   = totalRef.current - tpRef.current.lastTotal;
        const rate    = elapsed > 0 ? added / elapsed : 0;
        tpRef.current = { lastT: now, lastTotal: totalRef.current, rate };
        setStats({
          counts: [...countsRef.current],
          total:  totalRef.current,
          tph:    Math.round(rate * 60),
        });
        lastStatsT = now;
      }
    }

    frame();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── CONTROLS ────────────────────────────────────────────────────
  function handleStart() {
    packagesRef.current    = [];
    countsRef.current      = [0, 0, 0, 0];
    totalRef.current       = 0;
    spawnTimerRef.current  = 0;
    tpRef.current          = { lastT: Date.now(), lastTotal: 0, rate: 0 };
    setStats({ counts: [0, 0, 0, 0], total: 0, tph: 0 });
    setRunning(true);
  }
  function handleStop() {
    setRunning(false);
  }

  const total   = stats.total;
  const pctRej  = total > 0 ? Math.round(stats.counts[2] / total * 100) : 0;
  const pctGood = total > 0 ? 100 - pctRej : 0;
  const hasFault = faultType !== "none";

  return (
    <div style={{
      background: C.bg, color: C.text, fontFamily: body,
      height: "100vh", display: "flex", flexDirection: "column",
      overflow: "hidden", position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@700;800&family=Outfit:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────── */}
      <div style={{
        height: 56, flexShrink: 0, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 20px",
        background: C.bgAlt, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: running ? C.green : C.textMuted,
              boxShadow: running ? `0 0 8px ${C.green}99` : "none",
            }} />
            <span style={{ fontFamily: heading, fontSize: 13, fontWeight: 700, color: C.text }}>
              Conveyor Sorting Line – Industrial Digital Twin
            </span>
          </div>
          <div style={{ height: 24, width: 1, background: C.border }} />
          <span style={{
            fontFamily: mono, fontSize: 10,
            color: hasFault && running ? C.red : running ? C.green : C.textMuted,
          }}>
            {!running ? "○ STOPPED" : hasFault ? "▲ FAULT ACTIVE" : "● RUNNING"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {[
            { label: "TOTAL SORTED",  val: total },
            { label: "THROUGHPUT",    val: `${stats.tph}/min` },
            { label: "QUALITY",       val: `${pctGood}%` },
          ].map(({ label, val }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 8, color: C.textDim, letterSpacing: "0.1em" }}>{label}</div>
              <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: C.textSoft }}>{val}</div>
            </div>
          ))}
          <button onClick={() => setShowInfo(v => !v)} style={{
            width: 32, height: 32, borderRadius: 8, cursor: "pointer",
            border: `1px solid ${showInfo ? C.goldDim : C.border}`,
            background: showInfo ? C.goldSubtle : "transparent",
            fontFamily: mono, fontSize: 13,
            color: showInfo ? C.gold : C.textDim,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
          }}>?</button>
        </div>
      </div>

      {showInfo && <InfoPanel onClose={() => setShowInfo(false)} />}

      {/* ── MAIN CONTENT ───────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", gap: 10, padding: 10, minHeight: 0 }}>

        {/* Canvas viewport */}
        <div style={{
          flex: 1, background: C.panel, border: `1px solid ${C.border}`,
          borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column",
        }}>
          {/* Legend bar */}
          <div style={{
            padding: "8px 14px", borderBottom: `1px solid ${C.border}`,
            display: "flex", gap: 20, alignItems: "center", flexShrink: 0,
          }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>
              LIVE SIMULATION
            </span>
            {Object.entries(PKG).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 12, height: 10, borderRadius: 2, background: v.topFill }} />
                <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>{v.name}</span>
              </div>
            ))}
          </div>
          {/* Canvas */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              style={{ width: "100%", height: "auto", maxHeight: "100%", display: "block", borderRadius: 6 }}
            />
          </div>
        </div>

        {/* Side panel */}
        <div style={{ width: 210, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>

          {/* Lane counters */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>OUTPUT LANES</span>
            </div>
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 9 }}>
              {LANE_LABELS.map((label, i) => (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontFamily: mono, fontSize: 10, color: LANE_COLORS[i] }}>{label}</span>
                    <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: C.text }}>{stats.counts[i]}</span>
                  </div>
                  <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                    <div style={{
                      height: "100%",
                      width: total > 0 ? `${(stats.counts[i] / total) * 100}%` : "0%",
                      background: LANE_COLORS[i], borderRadius: 2,
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sort rules */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em" }}>SORT RULES</span>
            </div>
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                { d: "D1", rule: "Profile A → Lane A", col: LANE_COLORS[0] },
                { d: "D2", rule: "Profile B → Lane B", col: LANE_COLORS[1] },
                { d: "D3", rule: "Defective → Reject",  col: LANE_COLORS[2] },
                { d: "–",  rule: "Profile C → End-of-Line", col: C.textMuted },
              ].map(({ d, rule, col }) => (
                <div key={d} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ fontFamily: mono, fontSize: 9, color: col, minWidth: 18, marginTop: 1 }}>{d}</span>
                  <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, lineHeight: 1.6 }}>{rule}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quality meter */}
          <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, flex: 1 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.1em", marginBottom: 12 }}>QUALITY</div>
            <div style={{ textAlign: "center", marginBottom: 12 }}>
              <div style={{
                fontFamily: mono, fontSize: 30, fontWeight: 700, lineHeight: 1,
                color: pctRej > 20 ? C.red : pctRej > 10 ? C.gold : C.green,
              }}>
                {total > 0 ? `${pctGood}%` : "–"}
              </div>
              <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, marginTop: 4 }}>GOOD PARTS</div>
            </div>
            {[
              { label: "REJECTED",   val: stats.counts[2], col: C.red   },
              { label: "SORTED OK",  val: stats.counts[0] + stats.counts[1], col: C.green },
              { label: "END-OF-LINE", val: stats.counts[3], col: C.textDim },
            ].map(({ label, val, col }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim }}>{label}</span>
                <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: col }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTROLS BAR ───────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        background: C.bgAlt, borderTop: `1px solid ${C.border}`,
        padding: "10px 20px", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap",
      }}>

        {/* Start / Stop */}
        <button
          onClick={running ? handleStop : handleStart}
          style={{
            padding: "8px 22px", borderRadius: 8, border: "none", cursor: "pointer",
            fontFamily: mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em",
            background: running ? C.red : C.green, color: "#fff",
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}
        >
          {running ? "■ STOP" : "▶ START"}
        </button>

        <div style={{ height: 32, width: 1, background: C.border }} />

        {/* Belt speed */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>BELT SPEED</span>
          <input type="range" min={0.8} max={4.5} step={0.1} value={speed}
            onChange={e => setSpeed(+e.target.value)}
            style={{ width: 80, accentColor: C.gold }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: C.textSoft, minWidth: 32 }}>{speed.toFixed(1)}×</span>
        </div>

        {/* Package rate */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>PKG RATE</span>
          <input type="range" min={50} max={220} step={10} value={spawnFrames}
            onChange={e => setSpawnFrames(+e.target.value)}
            style={{ width: 80, accentColor: C.blue }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: C.textSoft, minWidth: 40 }}>
            {spawnFrames <= 70 ? "High" : spawnFrames <= 130 ? "Normal" : "Low"}
          </span>
        </div>

        {/* Defect rate */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>DEFECT RATE</span>
          <input type="range" min={0} max={0.45} step={0.01} value={defectRate}
            onChange={e => setDefectRate(+e.target.value)}
            style={{ width: 80, accentColor: C.red }} />
          <span style={{ fontFamily: mono, fontSize: 11, color: defectRate > 0.2 ? C.red : C.textSoft, minWidth: 32 }}>
            {Math.round(defectRate * 100)}%
          </span>
        </div>

        <div style={{ height: 32, width: 1, background: C.border }} />

        {/* Fault injection */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>INJECT FAULT</span>
          <select
            value={faultType}
            onChange={e => setFaultType(e.target.value)}
            style={{
              background: C.card,
              border: `1px solid ${hasFault ? C.red : C.border}`,
              borderRadius: 6, padding: "5px 10px",
              color: hasFault ? C.red : C.textSoft,
              fontFamily: mono, fontSize: 10, cursor: "pointer", outline: "none",
            }}
          >
            <option value="none">Normal Operation</option>
            <option value="belt_jam">Belt Jam</option>
            <option value="diverter_stuck">Diverter 2 Stuck Open</option>
          </select>
        </div>

        <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 9, color: C.textFaint }}>
          Canvas API · rAF 60fps · client-side only
        </span>
      </div>
    </div>
  );
}
