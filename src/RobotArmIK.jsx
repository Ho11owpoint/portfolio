import { useState, useEffect, useRef, useCallback } from "react";

// ══════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0b0d12", bgAlt: "#11141b", panel: "#151921", card: "#171b24",
  border: "#232833", borderLight: "#2e3440",
  gold: "#d4a847", goldDim: "#d4a84733", goldSubtle: "#d4a84712",
  green: "#4ec9b0", blue: "#6aa0e8", red: "#c25a5a", orange: "#d08a3a",
  text: "#e8eaf0", textSoft: "#a8aebb", textDim: "#6e7788",
  textMuted: "#454d5c", textFaint: "#2a2f3a",
};
const mono    = "'JetBrains Mono', 'Fira Code', monospace";
const heading = "'Syne', 'Inter', sans-serif";
const body    = "'Inter', 'Outfit', sans-serif";

// ══════════════════════════════════════════════════════════════════════
//  GEOMETRY (canvas world coords — y increases downward)
// ══════════════════════════════════════════════════════════════════════
const CW = 960;
const CH = 480;

const BASE   = { x: 540, y: 420 };
const L1     = 130;
const L2     = 110;
const L3     = 80;
const REACH  = L1 + L2 + L3;

const HOME_EE = { x: 540, y: 230 };  // ee parked above base
const HOME_PHI = Math.PI / 2;        // gripper pointing down

const FLOOR_Y = 460;

// Bins on left
const BINS = [
  { id: "red",   color: C.red,   cx: 230 },
  { id: "blue",  color: C.blue,  cx: 330 },
  { id: "green", color: C.green, cx: 430 },
];
const BIN_W = 70;
const BIN_H = 56;

// Conveyor on right
const BELT_X1 = 690;
const BELT_X2 = 950;
const BELT_TOP = 380;
const BELT_H = 18;
const BELT_SPEED = 60;       // px/sec at speed=1
const PICK_X_MIN = 695;
const PICK_X_MAX = 740;
const BOX = 22;

// Pickup z-offset (hover above box)
const HOVER_DZ = 36;
const TRAVEL_Y = 250;

// ══════════════════════════════════════════════════════════════════════
//  KINEMATICS
// ══════════════════════════════════════════════════════════════════════
function fk(a) {
  const j1 = { x: BASE.x, y: BASE.y };
  const j2 = { x: j1.x + L1 * Math.cos(a.t1), y: j1.y + L1 * Math.sin(a.t1) };
  const j3 = { x: j2.x + L2 * Math.cos(a.t1 + a.t2), y: j2.y + L2 * Math.sin(a.t1 + a.t2) };
  const ee = { x: j3.x + L3 * Math.cos(a.t1 + a.t2 + a.t3), y: j3.y + L3 * Math.sin(a.t1 + a.t2 + a.t3) };
  return { j1, j2, j3, ee };
}

// Closed-form analytical IK for 3-link planar arm with prescribed end-effector orientation phi.
// Strategy: compute wrist (joint 3) position by stepping back L3 from target along -phi,
// then solve standard 2-link IK for the remaining arm.
function analyticalIK(target, phi, elbowSign = -1) {
  const wx = target.x - L3 * Math.cos(phi);
  const wy = target.y - L3 * Math.sin(phi);
  const dx = wx - BASE.x;
  const dy = wy - BASE.y;
  const r2 = dx * dx + dy * dy;
  const r = Math.sqrt(r2);
  if (r > L1 + L2 - 1e-3 || r < Math.abs(L1 - L2) + 1e-3) return null;
  const c2 = (r2 - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const cc = Math.max(-1, Math.min(1, c2));
  const t2 = elbowSign * Math.acos(cc);
  const t1 = Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
  const t3 = phi - t1 - t2;
  return { t1, t2, t3 };
}

// Damped least squares Jacobian step. Returns delta angles to apply this iteration.
// Penalises orientation error too so the gripper trends toward phi.
function jacobianStep(a, target, phi, lambda = 0.18) {
  const t1 = a.t1, t12 = a.t1 + a.t2, t123 = a.t1 + a.t2 + a.t3;
  const { ee } = fk(a);
  // 3x3 Jacobian (x,y,phi) — rows: ex, ey, ephi; cols: dt1, dt2, dt3
  const J = [
    [-L1*Math.sin(t1) - L2*Math.sin(t12) - L3*Math.sin(t123),
     -L2*Math.sin(t12) - L3*Math.sin(t123),
     -L3*Math.sin(t123)],
    [ L1*Math.cos(t1) + L2*Math.cos(t12) + L3*Math.cos(t123),
      L2*Math.cos(t12) + L3*Math.cos(t123),
      L3*Math.cos(t123)],
    [1, 1, 1],
  ];
  const ex = target.x - ee.x;
  const ey = target.y - ee.y;
  const eph = phi - t123;
  // Clamp position error (so a far target doesn't yank the arm)
  const m = Math.hypot(ex, ey);
  const cap = 12;
  const sx = m > cap ? ex * cap / m : ex;
  const sy = m > cap ? ey * cap / m : ey;
  // Damped least squares: dq = J^T (J J^T + lambda^2 I)^-1 e
  // Compute J J^T (3x3)
  const JJt = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    JJt[i][j] = J[i][0]*J[j][0] + J[i][1]*J[j][1] + J[i][2]*J[j][2];
  const lam2 = lambda * lambda;
  JJt[0][0] += lam2; JJt[1][1] += lam2; JJt[2][2] += lam2;
  // Invert 3x3 using cofactor expansion
  const inv = invert3(JJt);
  if (!inv) return { d1: 0, d2: 0, d3: 0 };
  // y = inv * e
  const e = [sx, sy, eph * 0.5];
  const y0 = inv[0][0]*e[0] + inv[0][1]*e[1] + inv[0][2]*e[2];
  const y1 = inv[1][0]*e[0] + inv[1][1]*e[1] + inv[1][2]*e[2];
  const y2 = inv[2][0]*e[0] + inv[2][1]*e[1] + inv[2][2]*e[2];
  // dq = J^T y
  const d1 = J[0][0]*y0 + J[1][0]*y1 + J[2][0]*y2;
  const d2 = J[0][1]*y0 + J[1][1]*y1 + J[2][1]*y2;
  const d3 = J[0][2]*y0 + J[1][2]*y1 + J[2][2]*y2;
  return { d1, d2, d3 };
}

function invert3(m) {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];
  const det = a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  return [
    [(e*i - f*h)*inv, (c*h - b*i)*inv, (b*f - c*e)*inv],
    [(f*g - d*i)*inv, (a*i - c*g)*inv, (c*d - a*f)*inv],
    [(d*h - e*g)*inv, (b*g - a*h)*inv, (a*e - b*d)*inv],
  ];
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function dist(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }

// ══════════════════════════════════════════════════════════════════════
//  SIMULATION SETUP
// ══════════════════════════════════════════════════════════════════════
let _boxId = 0;
function spawnBox() {
  _boxId++;
  const t = Math.random();
  const type = t < 0.34 ? "red" : t < 0.67 ? "blue" : "green";
  return {
    id: _boxId,
    type,
    x: CW + 8,                // start just off right edge
    y: BELT_TOP - BOX / 2,    // sits on belt
    phase: "belt",            // belt | held | placed | missed
    settle: 0,
  };
}

function makeInitialState() {
  // Pre-compute initial joint angles for HOME_EE so arm starts in a clean pose
  const ik = analyticalIK(HOME_EE, HOME_PHI, -1);
  const a = ik || { t1: -1.7, t2: 1.4, t3: -0.5 };
  return {
    angles: { ...a },
    targetAngles: { ...a },
    state: "idle",
    heldBox: null,
    cycleStartMs: 0,
    boxes: [],
    spawnTimer: 1.0,
    stats: { picked: 0, missed: 0, lastCycle: 0, avgCycle: 0, n: 0 },
    lastTarget: null,
    lastPhi: HOME_PHI,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function RobotArmIK() {
  const canvasRef = useRef(null);
  const stateRef = useRef(makeInitialState());

  const [mode, setMode] = useState("analytical"); // "analytical" | "jacobian"
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1.0);
  const [pickRate, setPickRate] = useState(0.7); // boxes/sec
  const [tick, setTick] = useState(0);  // forces re-render for stats

  // Refs that hold latest config (so RAF closure stays current)
  const cfg = useRef({ mode, speed, pickRate, running });
  useEffect(() => { cfg.current = { mode, speed, pickRate, running }; }, [mode, speed, pickRate, running]);

  const reset = useCallback(() => {
    stateRef.current = makeInitialState();
    _boxId = 0;
    setTick(t => t + 1);
  }, []);

  // ─── SIMULATION STEP ──────────────────────────────────────────────────
  const step = useCallback((dt) => {
    const st = stateRef.current;
    const { mode, pickRate } = cfg.current;

    // Spawn boxes
    st.spawnTimer -= dt;
    if (st.spawnTimer <= 0) {
      st.boxes.push(spawnBox());
      st.spawnTimer = 0.4 + (1 / Math.max(0.05, pickRate)) * 0.7;
    }

    // Move belt boxes
    for (const b of st.boxes) {
      if (b.phase === "belt") {
        b.x -= BELT_SPEED * dt;
        if (b.x < BELT_X1 - BOX) { b.phase = "missed"; st.stats.missed++; b.settle = 0; }
      } else if (b.phase === "placed" || b.phase === "missed") {
        b.settle += dt;
      }
    }
    // Cleanup old boxes
    st.boxes = st.boxes.filter(b => !((b.phase === "placed" || b.phase === "missed") && b.settle > 1.6));

    // Update held box position to follow ee
    if (st.heldBox) {
      const f = fk(st.angles);
      st.heldBox.x = f.ee.x;
      st.heldBox.y = f.ee.y + 12;
    }

    // ARM STATE MACHINE — produces a target ee position + phi each tick
    let target = null;
    let phi = HOME_PHI;
    const f = fk(st.angles);

    switch (st.state) {
      case "idle": {
        // Find earliest box in pickup zone
        const pickup = st.boxes
          .filter(b => b.phase === "belt" && b.x >= PICK_X_MIN && b.x <= PICK_X_MAX)
          .sort((a, b) => a.x - b.x)[0];
        if (pickup) {
          st.heldBox = pickup;
          st.cycleStartMs = performance.now();
          st.state = "approach";
        } else {
          target = HOME_EE; phi = HOME_PHI;
        }
        break;
      }
      case "approach": {
        const b = st.heldBox;
        target = { x: b.x, y: b.y - HOVER_DZ };
        if (dist(f.ee, target) < 5) st.state = "descend";
        break;
      }
      case "descend": {
        const b = st.heldBox;
        target = { x: b.x, y: b.y - 4 };
        if (dist(f.ee, target) < 4) st.state = "grasp";
        break;
      }
      case "grasp": {
        st.heldBox.phase = "held";
        st.state = "lift";
        break;
      }
      case "lift": {
        target = { x: st.heldBox.x, y: TRAVEL_Y };
        if (dist(f.ee, target) < 6) st.state = "travel";
        break;
      }
      case "travel": {
        const bin = BINS.find(b => b.id === st.heldBox.type);
        target = { x: bin.cx, y: TRAVEL_Y };
        if (dist(f.ee, target) < 6) st.state = "drop";
        break;
      }
      case "drop": {
        const bin = BINS.find(b => b.id === st.heldBox.type);
        target = { x: bin.cx, y: FLOOR_Y - BIN_H + 12 };
        if (dist(f.ee, target) < 5) st.state = "release";
        break;
      }
      case "release": {
        const b = st.heldBox;
        b.phase = "placed";
        b.x = BINS.find(x => x.id === b.type).cx;
        b.y = FLOOR_Y - BIN_H / 2;
        b.settle = 0;
        const cycMs = performance.now() - st.cycleStartMs;
        st.stats.picked++;
        st.stats.lastCycle = cycMs;
        st.stats.n++;
        st.stats.avgCycle = st.stats.avgCycle + (cycMs - st.stats.avgCycle) / st.stats.n;
        st.heldBox = null;
        st.state = "return";
        break;
      }
      case "return": {
        target = HOME_EE;
        if (dist(f.ee, target) < 8) st.state = "idle";
        break;
      }
      default:
        target = HOME_EE;
    }

    // ─── DRIVE THE ARM TO THE TARGET ──────────────────────────────────
    if (target) {
      st.lastTarget = target;
      st.lastPhi = phi;
      if (mode === "analytical") {
        const sol = analyticalIK(target, phi, -1);
        if (sol) {
          // Lerp current → target angles (simulates servo response)
          const sp = Math.min(1, 7 * dt);
          st.angles.t1 = lerpAngle(st.angles.t1, sol.t1, sp);
          st.angles.t2 = lerpAngle(st.angles.t2, sol.t2, sp);
          st.angles.t3 = lerpAngle(st.angles.t3, sol.t3, sp);
          st.targetAngles = sol;
        }
      } else {
        // Jacobian iterative — multiple sub-steps per frame for stability
        const subs = 8;
        for (let i = 0; i < subs; i++) {
          const d = jacobianStep(st.angles, target, phi);
          const k = 0.6;
          st.angles.t1 += d.d1 * k;
          st.angles.t2 += d.d2 * k;
          st.angles.t3 += d.d3 * k;
        }
        st.targetAngles = { ...st.angles };
      }
    }

  }, []);

  // ─── DRAW ─────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const st = stateRef.current;

    // Background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, CW, CH);

    // Subtle grid
    ctx.strokeStyle = "#15191f";
    ctx.lineWidth = 1;
    for (let x = 0; x < CW; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
    for (let y = 0; y < CH; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }

    // Floor
    ctx.fillStyle = C.bgAlt;
    ctx.fillRect(0, FLOOR_Y, CW, CH - FLOOR_Y);
    ctx.strokeStyle = C.border;
    ctx.beginPath(); ctx.moveTo(0, FLOOR_Y); ctx.lineTo(CW, FLOOR_Y); ctx.stroke();

    // Reach circle (subtle)
    ctx.beginPath();
    ctx.arc(BASE.x, BASE.y, REACH, 0, Math.PI * 2);
    ctx.strokeStyle = "#1a1f28";
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bins
    for (const bin of BINS) {
      // Body
      ctx.fillStyle = C.card;
      ctx.fillRect(bin.cx - BIN_W / 2, FLOOR_Y - BIN_H, BIN_W, BIN_H);
      // Coloured rim
      ctx.fillStyle = bin.color;
      ctx.fillRect(bin.cx - BIN_W / 2, FLOOR_Y - BIN_H, BIN_W, 4);
      // Walls
      ctx.strokeStyle = C.borderLight;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bin.cx - BIN_W / 2 + 0.5, FLOOR_Y - BIN_H + 0.5, BIN_W - 1, BIN_H - 1);
      // Label
      ctx.fillStyle = C.textDim;
      ctx.font = `9px ${mono}`;
      ctx.textAlign = "center";
      ctx.fillText(bin.id.toUpperCase(), bin.cx, FLOOR_Y - 5);
    }

    // Conveyor frame
    ctx.fillStyle = C.borderLight;
    ctx.fillRect(BELT_X1 - 6, BELT_TOP - 4, BELT_X2 - BELT_X1 + 12, 4);
    ctx.fillRect(BELT_X1 - 6, BELT_TOP + BELT_H, BELT_X2 - BELT_X1 + 12, 4);
    // Belt surface
    ctx.fillStyle = C.bgAlt;
    ctx.fillRect(BELT_X1 - 6, BELT_TOP, BELT_X2 - BELT_X1 + 12, BELT_H);
    // Belt motion stripes
    const stripeOff = (performance.now() / 30) % 16;
    ctx.strokeStyle = "#252a35";
    ctx.lineWidth = 1.5;
    for (let x = BELT_X1 - stripeOff; x < BELT_X2; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, BELT_TOP + 2);
      ctx.lineTo(x + 8, BELT_TOP + BELT_H - 2);
      ctx.stroke();
    }
    // Pickup zone marker
    ctx.fillStyle = C.goldSubtle;
    ctx.fillRect(PICK_X_MIN - 8, BELT_TOP - 18, (PICK_X_MAX - PICK_X_MIN) + 16, 6);
    ctx.font = `9px ${mono}`;
    ctx.fillStyle = C.gold;
    ctx.textAlign = "center";
    ctx.fillText("PICKUP", (PICK_X_MIN + PICK_X_MAX) / 2, BELT_TOP - 22);

    // Boxes
    for (const b of st.boxes) {
      const col = BINS.find(x => x.id === b.type).color;
      ctx.fillStyle = col;
      const alpha = b.phase === "missed" ? 0.4 : 1;
      ctx.globalAlpha = alpha;
      ctx.fillRect(b.x - BOX/2, b.y - BOX/2, BOX, BOX);
      ctx.strokeStyle = "#0006";
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x - BOX/2 + 0.5, b.y - BOX/2 + 0.5, BOX - 1, BOX - 1);
      ctx.fillStyle = "#fff8";
      ctx.fillRect(b.x - BOX/2 + 2, b.y - BOX/2 + 2, BOX - 4, 3);
      ctx.globalAlpha = 1;
    }

    // Target reticle
    if (st.lastTarget) {
      const t = st.lastTarget;
      ctx.strokeStyle = C.gold + "aa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(t.x - 12, t.y); ctx.lineTo(t.x - 4, t.y);
      ctx.moveTo(t.x + 4, t.y); ctx.lineTo(t.x + 12, t.y);
      ctx.moveTo(t.x, t.y - 12); ctx.lineTo(t.x, t.y - 4);
      ctx.moveTo(t.x, t.y + 4); ctx.lineTo(t.x, t.y + 12);
      ctx.stroke();
    }

    // Arm (FK)
    const f = fk(st.angles);
    // Base mount
    ctx.fillStyle = C.borderLight;
    ctx.fillRect(BASE.x - 28, BASE.y - 4, 56, 12);
    ctx.fillStyle = C.panel;
    ctx.beginPath();
    ctx.arc(BASE.x, BASE.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Links — drawn as thick lines with rounded caps
    function drawLink(a, b, w, col) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    drawLink(f.j1, f.j2, 14, C.text);
    drawLink(f.j2, f.j3, 12, C.textSoft);
    drawLink(f.j3, f.ee, 9, C.gold);

    // Joints
    function joint(p, r, col) {
      ctx.fillStyle = C.bg;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }
    joint(f.j2, 6, C.gold);
    joint(f.j3, 5, C.gold);

    // Gripper
    const phi = st.angles.t1 + st.angles.t2 + st.angles.t3;
    const gripOpen = st.heldBox ? 4 : 8;
    const px = Math.cos(phi + Math.PI / 2);
    const py = Math.sin(phi + Math.PI / 2);
    const gx = f.ee.x;
    const gy = f.ee.y;
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    // Two finger lines
    ctx.beginPath();
    ctx.moveTo(gx + px * gripOpen, gy + py * gripOpen);
    ctx.lineTo(gx + px * gripOpen + Math.cos(phi) * 10, gy + py * gripOpen + Math.sin(phi) * 10);
    ctx.moveTo(gx - px * gripOpen, gy - py * gripOpen);
    ctx.lineTo(gx - px * gripOpen + Math.cos(phi) * 10, gy - py * gripOpen + Math.sin(phi) * 10);
    ctx.stroke();
    // EE tip
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.arc(gx, gy, 3, 0, Math.PI * 2); ctx.fill();

    // HUD overlays
    ctx.font = `10px ${mono}`;
    ctx.textAlign = "left";
    ctx.fillStyle = C.textDim;
    ctx.fillText(`STATE: ${st.state.toUpperCase()}`, 16, 22);
    ctx.fillStyle = C.gold;
    ctx.fillText(`MODE: ${cfg.current.mode === "analytical" ? "ANALYTICAL IK" : "JACOBIAN IK"}`, 16, 38);

    // Joint angle bars (top-right)
    const HW = 130, HH = 8;
    const HX = CW - HW - 16, HY = 18;
    const labels = ["θ1", "θ2", "θ3"];
    const angles = [st.angles.t1, st.angles.t2, st.angles.t3];
    for (let i = 0; i < 3; i++) {
      const y = HY + i * 16;
      ctx.fillStyle = C.textDim;
      ctx.font = `10px ${mono}`;
      ctx.textAlign = "left";
      ctx.fillText(labels[i], HX - 24, y + 7);
      ctx.fillStyle = C.border;
      ctx.fillRect(HX, y, HW, HH);
      // map angle [-π, π] → [0, HW]
      const norm = ((angles[i] + Math.PI) / (2 * Math.PI));
      ctx.fillStyle = C.gold;
      ctx.fillRect(HX + norm * HW - 1, y - 1, 3, HH + 2);
      ctx.fillStyle = C.textDim;
      ctx.font = `9px ${mono}`;
      ctx.textAlign = "right";
      const deg = ((angles[i] * 180 / Math.PI) % 360).toFixed(0);
      ctx.fillText(`${deg}°`, HX + HW + 26, y + 7);
    }
  }, []);

  // ─── ANIMATION LOOP ───────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    let last = performance.now();
    let renderTimer = 0;
    const loop = (now) => {
      const realDt = (now - last) / 1000;
      last = now;
      if (cfg.current.running) {
        // Cap dt to avoid huge jumps when tab regains focus
        const dt = Math.min(0.035, realDt) * cfg.current.speed;
        // Sub-step for stability at high speed
        const subs = Math.max(1, Math.ceil(cfg.current.speed));
        for (let i = 0; i < subs; i++) step(dt / subs);
      }
      draw();
      // Force React re-render every ~150ms for stats panel
      renderTimer += realDt;
      if (renderTimer > 0.15) {
        renderTimer = 0;
        setTick(t => (t + 1) % 1000000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, draw]);

  // ──────────────────────────────────────────────────────────────────
  //  RENDER
  // ──────────────────────────────────────────────────────────────────
  const st = stateRef.current;
  const successRate = st.stats.picked + st.stats.missed > 0
    ? Math.round(100 * st.stats.picked / (st.stats.picked + st.stats.missed))
    : 100;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "32px 24px 60px", fontFamily: body, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
      `}</style>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>

        {/* HEADER */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
            Robotics · Inverse Kinematics
          </div>
          <h1 style={{ fontFamily: heading, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            Robotic Pick-and-Place Cell
          </h1>
          <p style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.6, margin: "8px 0 0", maxWidth: 720 }}>
            A 3-link planar manipulator picks colored boxes off a moving conveyor and sorts them into matching bins.
            Toggle between an <span style={{ color: C.gold }}>analytical closed-form IK</span> solver and an
            iterative <span style={{ color: C.gold }}>damped least-squares Jacobian</span> solver to see the same scene
            driven by two different inverse-kinematics strategies.
          </p>
        </div>

        {/* CONTROLS */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center",
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: "12px 16px", marginBottom: 14,
        }}>
          <div style={{ display: "flex", gap: 0, border: `1px solid ${C.border}`, borderRadius: 7, overflow: "hidden" }}>
            {[["analytical", "Analytical"], ["jacobian", "Jacobian"]].map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)} style={{
                background: mode === id ? C.gold : "transparent",
                color: mode === id ? C.bg : C.textSoft,
                border: "none", padding: "8px 14px",
                fontFamily: mono, fontSize: 11, fontWeight: 600, cursor: "pointer",
                letterSpacing: "0.04em",
              }}>{label}</button>
            ))}
          </div>

          <Slider label="SPEED" value={speed} min={0.25} max={2.5} step={0.05} onChange={setSpeed} unit="×" />
          <Slider label="SPAWN RATE" value={pickRate} min={0.2} max={1.4} step={0.05} onChange={setPickRate} unit="/s" />

          <div style={{ flex: 1 }} />

          <button onClick={() => setRunning(r => !r)} style={{
            background: running ? C.bgAlt : C.gold,
            color: running ? C.text : C.bg,
            border: `1px solid ${running ? C.border : C.gold}`,
            padding: "8px 14px", borderRadius: 7,
            fontFamily: mono, fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
          }}>{running ? "⏸ PAUSE" : "▶ PLAY"}</button>

          <button onClick={reset} style={{
            background: "transparent", color: C.textSoft,
            border: `1px solid ${C.border}`, padding: "8px 14px", borderRadius: 7,
            fontFamily: mono, fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
          }}>↻ RESET</button>
        </div>

        {/* CANVAS */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden",
          marginBottom: 14,
        }}>
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>

        {/* STATS GRID */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 14,
        }}>
          <Stat label="STATE" value={st.state.toUpperCase()} accent={C.gold} mono />
          <Stat label="PICKED" value={st.stats.picked} accent={C.green} />
          <Stat label="MISSED" value={st.stats.missed} accent={st.stats.missed > 0 ? C.red : C.textDim} />
          <Stat label="SUCCESS RATE" value={`${successRate}%`} accent={successRate >= 80 ? C.green : successRate >= 50 ? C.gold : C.red} />
          <Stat label="LAST CYCLE" value={st.stats.lastCycle ? `${(st.stats.lastCycle / 1000).toFixed(2)}s` : "—"} accent={C.textSoft} />
        </div>

        {/* EXPLAINER */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14,
        }}>
          <Explain
            title="Analytical IK"
            mark="closed-form"
            color={C.green}
            text={
              <>
                Steps the wrist back from the target by L₃ along the gripper-orientation vector φ, then
                solves the standard 2-link IK in closed form using the cosine law. One subtraction and
                two <code style={{ fontFamily: mono, color: C.gold }}>atan2</code> calls give exact joint
                angles in O(1) time. Fast, deterministic, but breaks down on singularities and on
                redundant arms.
              </>
            }
          />
          <Explain
            title="Jacobian IK"
            mark="iterative"
            color={C.blue}
            text={
              <>
                Builds the 3×3 manipulator Jacobian each frame and solves a damped least-squares step
                <code style={{ fontFamily: mono, color: C.gold }}> Δq = Jᵀ(JJᵀ + λ²I)⁻¹e</code>.
                Handles redundancy and stays stable near singularities thanks to the damping term λ.
                Generalises directly to higher-DOF arms where closed-form IK doesn't exist.
              </>
            }
          />
        </div>

        <div style={{
          fontFamily: mono, fontSize: 11, color: C.textDim, lineHeight: 1.7,
          padding: "12px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        }}>
          STATE MACHINE: <span style={{ color: C.gold }}>idle</span> → approach → descend → grasp → lift → travel → drop → release → return → idle.
          Boxes spawn on the right belt and travel left at {BELT_SPEED} px/s. The arm tracks each box that enters
          the highlighted PICKUP zone, lifts it to a clear travel height, then drops it into the bin matching its colour.
          Try jumping the SPEED slider to 2× — the analytical solver stays glued to the target while the Jacobian
          solver lags slightly because it converges over multiple frames.
        </div>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  SMALL UI COMPONENTS
// ══════════════════════════════════════════════════════════════════════
function Slider({ label, value, min, max, step, onChange, unit }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: C.textDim, letterSpacing: "0.06em" }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: 90, accentColor: C.gold }}
      />
      <span style={{ fontFamily: mono, fontSize: 11, color: C.gold, minWidth: 36, textAlign: "right" }}>
        {value.toFixed(2)}{unit}
      </span>
    </label>
  );
}

function Stat({ label, value, accent, mono: useMono }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 14px",
    }}>
      <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.12em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontFamily: useMono ? mono : heading, fontSize: 18, fontWeight: 600,
        color: accent, letterSpacing: useMono ? "0.04em" : "-0.01em",
      }}>
        {value}
      </div>
    </div>
  );
}

function Explain({ title, mark, color, text }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "16px 18px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h3 style={{ fontFamily: heading, fontSize: 14, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.01em" }}>
          {title}
        </h3>
        <span style={{
          fontFamily: mono, fontSize: 8, padding: "2px 7px", borderRadius: 3,
          background: color + "22", color, border: `1px solid ${color}55`, letterSpacing: "0.08em",
        }}>{mark}</span>
      </div>
      <div style={{ fontFamily: body, fontSize: 12, color: C.textSoft, lineHeight: 1.65 }}>
        {text}
      </div>
    </div>
  );
}
