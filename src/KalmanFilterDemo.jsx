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
//  GEOMETRY (canvas world coords)
// ══════════════════════════════════════════════════════════════════════
const CW = 940;
const CH = 460;
const CX = 470;       // ellipse center x
const CY = 230;       // ellipse center y
const A_PATH = 330;   // semi-major axis
const B_PATH = 145;   // semi-minor axis
const OMEGA  = 0.5;   // path angular speed (rad/s)
const TRAIL_MAX = 1500;

// ══════════════════════════════════════════════════════════════════════
//  GAUSSIAN RANDOM (Box–Muller)
// ══════════════════════════════════════════════════════════════════════
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ══════════════════════════════════════════════════════════════════════
//  TRUE PATH — smooth ellipse with analytic vel/accel
// ══════════════════════════════════════════════════════════════════════
function truePath(t) {
  return {
    px: CX + A_PATH * Math.cos(t),
    py: CY + B_PATH * Math.sin(t),
    vx: -A_PATH * OMEGA * Math.sin(t),
    vy:  B_PATH * OMEGA * Math.cos(t),
    ax: -A_PATH * OMEGA * OMEGA * Math.cos(t),
    ay: -B_PATH * OMEGA * OMEGA * Math.sin(t),
  };
}

// ══════════════════════════════════════════════════════════════════════
//  KALMAN FILTER
//    Two independent 2-state filters, one per axis.
//    State per axis: x = [position, velocity]^T
//    F = [[1,dt],[0,1]],  B = [[dt²/2],[dt]],  H = [1,0]
//    u = IMU acceleration (used as control input)
//    z = GPS position (only for measurement update)
//    Q  ≈  σ_a² · [[dt⁴/4, dt³/2],[dt³/2, dt²]]
//    R  =  σ_gps²
// ══════════════════════════════════════════════════════════════════════
function newAxis(p0, v0, sigP0, sigV0) {
  return { x: [p0, v0], P: [[sigP0 * sigP0, 0], [0, sigV0 * sigV0]] };
}

function predictAxis(s, accel, dt, sigA) {
  // x_new = F x + B u
  const dt2 = dt * dt;
  const newX = [
    s.x[0] + s.x[1] * dt + 0.5 * accel * dt2,
    s.x[1] + accel * dt,
  ];
  // P_new = F P F^T  (closed-form for 2x2 F = [[1,dt],[0,1]])
  const a00 = s.P[0][0] + 2 * dt * s.P[0][1] + dt2 * s.P[1][1];
  const a01 = s.P[0][1] + dt * s.P[1][1];
  const a11 = s.P[1][1];
  // + Q  (white-noise acceleration model)
  const sa2 = sigA * sigA;
  const dt3 = dt2 * dt;
  const dt4 = dt2 * dt2;
  return {
    x: newX,
    P: [
      [a00 + sa2 * dt4 / 4, a01 + sa2 * dt3 / 2],
      [a01 + sa2 * dt3 / 2, a11 + sa2 * dt2],
    ],
  };
}

function updateAxis(s, z, R) {
  // y = z - H x;  S = H P H^T + R;  K = P H^T / S
  const y = z - s.x[0];
  const S = s.P[0][0] + R;
  const K0 = s.P[0][0] / S;
  const K1 = s.P[1][0] / S;
  const newX = [
    s.x[0] + K0 * y,
    s.x[1] + K1 * y,
  ];
  // P_new = (I - K H) P
  const newP = [
    [(1 - K0) * s.P[0][0], (1 - K0) * s.P[0][1]],
    [s.P[1][0] - K1 * s.P[0][0], s.P[1][1] - K1 * s.P[0][1]],
  ];
  return { x: newX, P: newP, innov: y };
}

// ══════════════════════════════════════════════════════════════════════
//  INITIAL STATE
// ══════════════════════════════════════════════════════════════════════
function makeInitial() {
  const tp = truePath(0);
  return {
    simTime: 0,
    t: 0,
    truthHist: [],
    estHist: [],
    drHist: [],
    gpsHist: [],            // visualised dots, fade out
    drState: { px: tp.px, py: tp.py, vx: tp.vx, vy: tp.vy },
    kfX: newAxis(tp.px, 0, 6, 30),
    kfY: newAxis(tp.py, 0, 6, 30),
    gpsTimer: 0,
    blackoutUntil: 0,
    lastGpsTime: -999,
    sumSqErr: 0,
    rmsCount: 0,
    lastInnovX: 0,
    lastInnovY: 0,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function KalmanFilterDemo() {
  const canvasRef = useRef(null);
  const stateRef  = useRef(makeInitial());

  const [imuSigma, setImuSigma] = useState(8);     // accel std (units²/s²)
  const [gpsSigma, setGpsSigma] = useState(14);    // pos std
  const [gpsHz,    setGpsHz]    = useState(1.5);   // GPS rate (Hz)
  const [speed,    setSpeed]    = useState(1.0);
  const [running,  setRunning]  = useState(true);
  const [showGps,  setShowGps]  = useState(false);
  const [showDR,   setShowDR]   = useState(false);
  const [showCov,  setShowCov]  = useState(false);
  const [_tick,    setTick]     = useState(0);
  const [blackedOut, setBlackedOut] = useState(false);

  // Latest config in a ref so the RAF closure stays current
  const cfg = useRef({});
  useEffect(() => {
    cfg.current = { imuSigma, gpsSigma, gpsHz, speed, running, showGps, showDR, showCov };
  }, [imuSigma, gpsSigma, gpsHz, speed, running, showGps, showDR, showCov]);

  const reset = useCallback(() => {
    stateRef.current = makeInitial();
    setBlackedOut(false);
    setTick(t => t + 1);
  }, []);

  const triggerBlackout = useCallback(() => {
    const st = stateRef.current;
    st.blackoutUntil = st.simTime + 5;
    setBlackedOut(true);
  }, []);

  // ─── SIMULATION STEP ──────────────────────────────────────────────────
  const step = useCallback((dt) => {
    const st = stateRef.current;
    const { imuSigma, gpsSigma, gpsHz } = cfg.current;
    if (dt <= 0) return;

    // Advance time + true path
    st.simTime += dt;
    st.t = st.simTime * OMEGA;
    const tp = truePath(st.t);

    // IMU measurement = true accel + Gaussian noise
    const imuAx = tp.ax + randn() * imuSigma;
    const imuAy = tp.ay + randn() * imuSigma;

    // ─── PREDICT ──────────────────────────────────────────────────────
    st.kfX = predictAxis(st.kfX, imuAx, dt, imuSigma);
    st.kfY = predictAxis(st.kfY, imuAy, dt, imuSigma);

    // Dead-reckoning (IMU-only integration, no fusion)
    st.drState.vx += imuAx * dt;
    st.drState.vy += imuAy * dt;
    st.drState.px += st.drState.vx * dt;
    st.drState.py += st.drState.vy * dt;

    // ─── GPS UPDATE ───────────────────────────────────────────────────
    st.gpsTimer -= dt;
    const gpsLive = st.simTime >= st.blackoutUntil;
    if (!gpsLive && blackedOut === false) setBlackedOut(true);
    if ( gpsLive && blackedOut === true ) setBlackedOut(false);

    if (st.gpsTimer <= 0 && gpsLive) {
      const z_x = tp.px + randn() * gpsSigma;
      const z_y = tp.py + randn() * gpsSigma;
      const R = gpsSigma * gpsSigma;
      const ux = updateAxis(st.kfX, z_x, R);
      const uy = updateAxis(st.kfY, z_y, R);
      st.kfX = { x: ux.x, P: ux.P };
      st.kfY = { x: uy.x, P: uy.P };
      st.lastInnovX = ux.innov;
      st.lastInnovY = uy.innov;
      st.gpsHist.push({ x: z_x, y: z_y, age: 0 });
      st.lastGpsTime = st.simTime;
      st.gpsTimer = 1 / Math.max(0.1, gpsHz);
    }

    // Age GPS dots
    for (const g of st.gpsHist) g.age += dt;
    if (st.gpsHist.length > 80) st.gpsHist = st.gpsHist.slice(-80);
    st.gpsHist = st.gpsHist.filter(g => g.age < 6);

    // Trail history
    st.truthHist.push({ x: tp.px, y: tp.py });
    st.estHist.push({ x: st.kfX.x[0], y: st.kfY.x[0] });
    st.drHist.push({ x: st.drState.px, y: st.drState.py });
    if (st.truthHist.length > TRAIL_MAX) st.truthHist.shift();
    if (st.estHist.length > TRAIL_MAX) st.estHist.shift();
    if (st.drHist.length > TRAIL_MAX) st.drHist.shift();

    // RMS error (running average)
    const ex = st.kfX.x[0] - tp.px;
    const ey = st.kfY.x[0] - tp.py;
    st.sumSqErr += ex * ex + ey * ey;
    st.rmsCount++;
  }, [blackedOut]);

  // ─── DRAW ─────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const st = stateRef.current;
    const { showGps, showDR, showCov } = cfg.current;

    // Background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, CW, CH);

    // Subtle grid
    ctx.strokeStyle = "#15191f";
    ctx.lineWidth = 1;
    for (let x = 0; x < CW; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CH); ctx.stroke(); }
    for (let y = 0; y < CH; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CW, y); ctx.stroke(); }

    // True path — full elliptical track, dashed
    ctx.strokeStyle = "#2a3140";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.ellipse(CX, CY, A_PATH, B_PATH, 0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.setLineDash([]);

    // Track centerline label
    ctx.fillStyle = C.textMuted;
    ctx.font = `9px ${mono}`;
    ctx.textAlign = "center";
    ctx.fillText("TRUE PATH", CX, CY + B_PATH + 18);

    // GPS measurement dots (toggle)
    if (showGps) {
      for (const g of st.gpsHist) {
        const alpha = Math.max(0, 1 - g.age / 6);
        ctx.fillStyle = `rgba(106,160,232,${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // Dead-reckoning trail (toggle)
    if (showDR && st.drHist.length > 1) {
      ctx.strokeStyle = "rgba(194,90,90,0.7)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(st.drHist[0].x, st.drHist[0].y);
      for (let i = 1; i < st.drHist.length; i++) ctx.lineTo(st.drHist[i].x, st.drHist[i].y);
      ctx.stroke();
    }

    // Kalman estimate trail
    if (st.estHist.length > 1) {
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(st.estHist[0].x, st.estHist[0].y);
      for (let i = 1; i < st.estHist.length; i++) ctx.lineTo(st.estHist[i].x, st.estHist[i].y);
      ctx.stroke();
    }

    // True vehicle (green triangle along velocity)
    const tp = truePath(st.t);
    const heading = Math.atan2(tp.vy, tp.vx);
    ctx.save();
    ctx.translate(tp.px, tp.py);
    ctx.rotate(heading);
    ctx.fillStyle = C.green;
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Estimated position (gold dot)
    const ex = st.kfX.x[0], ey = st.kfY.x[0];
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.arc(ex, ey, 5.5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Covariance ellipse (toggle)
    if (showCov) {
      const sx = Math.sqrt(Math.max(0, st.kfX.P[0][0]));
      const sy = Math.sqrt(Math.max(0, st.kfY.P[0][0]));
      ctx.strokeStyle = "rgba(212,168,71,0.5)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(ex, ey, sx, sy, 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = "rgba(212,168,71,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(ex, ey, sx * 2, sy * 2, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Blackout banner
    const gpsLive = st.simTime >= st.blackoutUntil;
    if (!gpsLive) {
      const bw = 240, bh = 30;
      ctx.fillStyle = "rgba(194,90,90,0.92)";
      ctx.fillRect((CW - bw) / 2, 14, bw, bh);
      ctx.fillStyle = "#fff";
      ctx.font = `bold 12px ${mono}`;
      ctx.textAlign = "center";
      ctx.fillText("⚠ GPS BLACKED OUT", CW / 2, 33);
      ctx.font = `10px ${mono}`;
      ctx.fillText(`${(st.blackoutUntil - st.simTime).toFixed(1)}s`, CW / 2, 48);
    }

    // HUD
    ctx.font = `10px ${mono}`;
    ctx.textAlign = "left";
    ctx.fillStyle = C.textDim;
    ctx.fillText(`SIM TIME  ${st.simTime.toFixed(1)} s`, 14, 20);
    const gpsAge = st.simTime - st.lastGpsTime;
    ctx.fillStyle = !gpsLive ? C.red : (gpsAge > 1.5 ? C.orange : C.green);
    ctx.fillText(`LAST GPS  ${st.lastGpsTime < 0 ? "—" : gpsAge.toFixed(2) + " s ago"}`, 14, 36);

    ctx.textAlign = "right";
    const rms = st.rmsCount > 0 ? Math.sqrt(st.sumSqErr / st.rmsCount) : 0;
    ctx.fillStyle = C.gold;
    ctx.fillText(`RMS ERR  ${rms.toFixed(2)} u`, CW - 14, 20);
    const sigPos = Math.sqrt(Math.max(0, st.kfX.P[0][0]) + Math.max(0, st.kfY.P[0][0]));
    ctx.fillStyle = C.textSoft;
    ctx.fillText(`σ_pos  ${sigPos.toFixed(2)} u`, CW - 14, 36);

    // Legend
    const lx = 14, ly = CH - 60;
    ctx.font = `10px ${mono}`;
    ctx.textAlign = "left";
    function legend(y, color, lab) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + 22, y); ctx.stroke();
      ctx.fillStyle = C.textSoft;
      ctx.fillText(lab, lx + 30, y + 3);
    }
    function legendDot(y, color, lab) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(lx + 11, y, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = C.textSoft;
      ctx.fillText(lab, lx + 30, y + 3);
    }
    legend(ly,      "#2a3140", "True path (ground truth)");
    legend(ly + 16, C.gold,    "Kalman estimate");
    legendDot(ly + 32, C.green, "True vehicle pose");
  }, []);

  // ─── ANIMATION LOOP ───────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    let last = performance.now();
    let renderAcc = 0;
    const loop = (now) => {
      const realDt = (now - last) / 1000;
      last = now;
      if (cfg.current.running) {
        const dt = Math.min(0.04, realDt) * cfg.current.speed;
        // Sub-step at high speed
        const subs = Math.max(1, Math.ceil(cfg.current.speed));
        for (let i = 0; i < subs; i++) step(dt / subs);
      }
      draw();
      renderAcc += realDt;
      if (renderAcc > 0.18) {
        renderAcc = 0;
        setTick(t => (t + 1) % 1000000);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step, draw]);

  // ─── RENDER ──────────────────────────────────────────────────────────
  const st = stateRef.current;
  const rms = st.rmsCount > 0 ? Math.sqrt(st.sumSqErr / st.rmsCount) : 0;
  const sigPos = Math.sqrt(Math.max(0, st.kfX.P[0][0]) + Math.max(0, st.kfY.P[0][0]));
  const lastGpsAge = st.simTime - st.lastGpsTime;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", padding: "32px 24px 60px", fontFamily: body, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');
      `}</style>

      <div style={{ maxWidth: 1080, margin: "0 auto" }}>

        {/* HEADER */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
            State Estimation · Sensor Fusion
          </div>
          <h1 style={{ fontFamily: heading, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            Kalman Filter — IMU + GPS
          </h1>
          <p style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.6, margin: "8px 0 0", maxWidth: 760 }}>
            A vehicle drives a closed loop. The simulator generates a noisy IMU signal (high-rate accelerometer)
            and slow noisy GPS fixes. A linear Kalman filter fuses both — using the IMU as a control input
            during the predict step and folding GPS in during the update step.
            Hit <span style={{ color: C.gold }}>GPS BLACKOUT</span> to cut GPS for 5 seconds and watch the
            uncertainty grow until the filter regains a fix.
          </p>
        </div>

        {/* CONTROLS */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center",
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          padding: "12px 16px", marginBottom: 10,
        }}>
          <Slider label="IMU σ" value={imuSigma} min={1} max={30} step={0.5} onChange={setImuSigma} unit=" u/s²" />
          <Slider label="GPS σ" value={gpsSigma} min={1} max={50} step={1} onChange={setGpsSigma} unit=" u" />
          <Slider label="GPS RATE" value={gpsHz} min={0.2} max={5} step={0.1} onChange={setGpsHz} unit=" Hz" />
          <Slider label="SPEED" value={speed} min={0.25} max={3} step={0.05} onChange={setSpeed} unit="×" />

          <div style={{ flex: 1 }} />

          <button onClick={triggerBlackout} disabled={blackedOut} style={{
            background: blackedOut ? C.bgAlt : `${C.red}33`,
            color: blackedOut ? C.textDim : C.red,
            border: `1px solid ${blackedOut ? C.border : C.red + "88"}`,
            padding: "8px 14px", borderRadius: 7, cursor: blackedOut ? "default" : "pointer",
            fontFamily: mono, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
          }}>{blackedOut ? "⚠ BLACKED OUT" : "GPS BLACKOUT 5s"}</button>

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

        {/* LAYER TOGGLES */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14,
        }}>
          <Toggle label="GPS measurements" on={showGps} onChange={setShowGps} swatch={C.blue} />
          <Toggle label="IMU dead-reckoning (no fusion)" on={showDR} onChange={setShowDR} swatch={C.red} />
          <Toggle label="1σ + 2σ uncertainty ellipse" on={showCov} onChange={setShowCov} swatch={C.gold} />
        </div>

        {/* CANVAS */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden",
          marginBottom: 14,
        }}>
          <canvas ref={canvasRef} width={CW} height={CH}
            style={{ width: "100%", height: "auto", display: "block" }} />
        </div>

        {/* STATS */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14,
        }}>
          <Stat label="RMS ERROR"     value={`${rms.toFixed(2)} u`} accent={rms < 5 ? C.green : rms < 15 ? C.gold : C.red} />
          <Stat label="POSITION σ"    value={`${sigPos.toFixed(2)} u`} accent={C.gold} />
          <Stat label="LAST GPS"      value={st.lastGpsTime < 0 ? "—" : `${lastGpsAge.toFixed(2)}s`}
                accent={blackedOut ? C.red : lastGpsAge > 1.5 ? C.orange : C.green} />
          <Stat label="SIM TIME"      value={`${st.simTime.toFixed(1)}s`} accent={C.textSoft} />
        </div>

        {/* EXPLAINER */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14,
        }}>
          <Explain title="Predict step" mark="60 Hz · IMU" color={C.green}
            text={
              <>
                Each frame, the IMU acceleration is treated as the control input
                <code style={{ fontFamily: mono, color: C.gold }}> u = a_imu</code>.
                The state propagates as <code style={{ fontFamily: mono, color: C.gold }}>x ← F·x + B·u</code>
                {" "}with <code style={{ fontFamily: mono, color: C.gold }}>F=[[1,Δt],[0,1]]</code>,
                {" "}<code style={{ fontFamily: mono, color: C.gold }}>B=[Δt²/2, Δt]ᵀ</code>.
                The covariance grows: <code style={{ fontFamily: mono, color: C.gold }}>P ← F·P·Fᵀ + Q</code>,
                where Q comes from the IMU noise σ_a.
              </>
            }
          />
          <Explain title="Update step" mark="≈1.5 Hz · GPS" color={C.blue}
            text={
              <>
                When a GPS fix arrives, the filter computes the innovation
                <code style={{ fontFamily: mono, color: C.gold }}> y = z − H·x</code> and the
                Kalman gain <code style={{ fontFamily: mono, color: C.gold }}>K = P·Hᵀ·(H·P·Hᵀ + R)⁻¹</code>.
                State and covariance are corrected by
                <code style={{ fontFamily: mono, color: C.gold }}> x ← x + K·y</code>,
                <code style={{ fontFamily: mono, color: C.gold }}> P ← (I − K·H)·P</code>.
                R = σ_gps². With slower / noisier GPS, K shrinks and the IMU prediction dominates.
              </>
            }
          />
        </div>

        <div style={{
          fontFamily: mono, fontSize: 11, color: C.textDim, lineHeight: 1.7,
          padding: "12px 16px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        }}>
          MODEL: 2-state filter per axis · <span style={{ color: C.gold }}>x = [position, velocity]ᵀ</span> ·
          IMU drives the predict step at 60 Hz · GPS supplies a position measurement at the configured rate.
          Try: turn on dead-reckoning to see how fast IMU integration drifts, then turn it off and run a
          GPS BLACKOUT — the filter coasts on the predict step alone, the σ ellipse grows, and the moment
          GPS comes back the estimate snaps to the new fix.
        </div>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  SMALL UI
// ══════════════════════════════════════════════════════════════════════
function Slider({ label, value, min, max, step, onChange, unit }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: C.textDim, letterSpacing: "0.06em" }}>
        {label}
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: 90, accentColor: C.gold }} />
      <span style={{ fontFamily: mono, fontSize: 11, color: C.gold, minWidth: 56, textAlign: "right" }}>
        {value.toFixed(value < 10 ? 2 : 1)}{unit}
      </span>
    </label>
  );
}

function Toggle({ label, on, onChange, swatch }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      background: on ? C.card : "transparent",
      color: on ? C.text : C.textDim,
      border: `1px solid ${on ? swatch + "88" : C.border}`,
      padding: "8px 14px", borderRadius: 7, cursor: "pointer",
      fontFamily: mono, fontSize: 11, fontWeight: 500, letterSpacing: "0.03em",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <span style={{
        width: 10, height: 10, borderRadius: 2,
        background: on ? swatch : "transparent",
        border: `1px solid ${swatch}`,
      }} />
      {label}
    </button>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 14px",
    }}>
      <div style={{ fontFamily: mono, fontSize: 9, color: C.textDim, letterSpacing: "0.12em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, color: accent, letterSpacing: "0.04em" }}>
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
      <div style={{ fontFamily: body, fontSize: 12, color: C.textSoft, lineHeight: 1.7 }}>
        {text}
      </div>
    </div>
  );
}
