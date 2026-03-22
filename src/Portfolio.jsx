import { useState, useEffect, useRef, useCallback } from "react";

// ══════════════════════════════════════════════════════════════════════
//  SCROLL ANIMATION HOOK
// ══════════════════════════════════════════════════════════════════════
function useReveal(threshold = 0.15) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

function Reveal({ children, delay = 0, direction = "up", style = {} }) {
  const [ref, visible] = useReveal(0.1);
  const transforms = { up: "translateY(40px)", down: "translateY(-40px)", left: "translateX(40px)", right: "translateX(-40px)", none: "none" };
  return (
    <div ref={ref} style={{
      ...style,
      opacity: visible ? 1 : 0,
      transform: visible ? "none" : transforms[direction],
      transition: `opacity 0.7s ease ${delay}s, transform 0.7s ease ${delay}s`,
    }}>{children}</div>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════
const C = {
  bg: "#09090a", bgAlt: "#0e0e10", panel: "#131315", card: "#17171a",
  border: "#1f1f23", borderLight: "#2a2a30",
  gold: "#c9a227", goldBright: "#e0b830", goldDim: "#c9a22733", goldSubtle: "#c9a22712",
  green: "#3d9e4f", blue: "#3d7eb5", orange: "#c47a2e", red: "#b54a4a",
  text: "#d0d0c4", textSoft: "#a0a094", textDim: "#6a6a60", textMuted: "#3e3e38", textFaint: "#252524",
};
const mono = "'JetBrains Mono', 'Fira Code', monospace";
const heading = "'Syne', 'Inter', sans-serif";
const body = "'Outfit', 'Inter', sans-serif";

// ══════════════════════════════════════════════════════════════════════
//  DATA
// ══════════════════════════════════════════════════════════════════════
const SKILLS = {
  "Automation & Control": [
    { name: "Siemens S7 PLCs", level: 95 },
    { name: "TIA Portal / WinCC", level: 90 },
    { name: "ABB ACS880/ACS480", level: 92 },
    { name: "Drive Composer Pro", level: 88 },
    { name: "SCADA Systems", level: 80 },
    { name: "Motor Control", level: 93 },
    { name: "EPLAN P8.28", level: 85 },
  ],
  "Programming & AI": [
    { name: "Python", level: 88 },
    { name: "MATLAB", level: 82 },
    { name: "C++ / C#", level: 75 },
    { name: "Machine Learning", level: 78 },
    { name: "Reinforcement Learning", level: 72 },
    { name: "LabView", level: 70 },
    { name: "Embedded / Arduino", level: 80 },
  ],
  "Design & Engineering": [
    { name: "SolidWorks", level: 75 },
    { name: "Eagle / Proteus", level: 72 },
    { name: "pSim / pSpice", level: 70 },
    { name: "Technical Documentation", level: 88 },
    { name: "PCB Design", level: 68 },
  ],
};

const EXPERIENCE = [
  {
    title: "Electrical & Electronics Operations Engineer",
    company: "ArcelorMittal Eisenhüttenstadt",
    location: "Hot Rolling Factory (Warmwalzwerk)",
    period: "Nov 2023 – Nov 2024",
    description: "Part of the automation team running the electrical side of the hot rolling line. Day to day, that meant PLC programming, commissioning inverters, troubleshooting motor control issues, and keeping documentation up to date.",
    highlights: [
      {
        title: "Downcoiler Motor Adjustment",
        text: "Found a speed sync issue between the main roller and compression motor that was hurting product quality. Pulled Motor M101 out of the existing system, built a standalone control cabinet with an ABB ACS880, dialed in the speed parameters, and documented the whole thing in EPLAN P8.28.",
      },
      {
        title: "Roller Ferry Modernization",
        text: "Replaced an ABB ACS880 with ACS480 to better match the load profile, upgraded the switching power supply, and fixed several issues from the original install. This cut down on unplanned stops.",
      },
      {
        title: "PLC Configuration & Motor Programming",
        text: "Set up Siemens PLCs through TIA Portal across the mill, assigned IPs to around 50 auxiliary motors so everything could be monitored from one place.",
      },
      {
        title: "Shift Rotation Program",
        text: "Spent a month rotating through every station in the hot rolling mill, working side by side with operators during roll changes to really understand how the production line works end to end.",
      },
    ],
  },
  {
    title: "Electrical Engineering Intern",
    company: "Casa Tekstil San. ve Tic. A.Ş.",
    location: "Turkey",
    period: "Jan 2022 – Apr 2023",
    description: "Helped troubleshoot electrical faults on textile production machines, traced issues through schematics, and worked alongside senior engineers on hardware debugging. Picked up solid hands-on skills in PCB soldering, component testing, and repair.",
    highlights: [],
  },
];

const EDUCATION = [
  { degree: "M.Sc. Artificial Intelligence", school: "International University of Applied Sciences", period: "2025 – 2027", status: "In Progress", note: "" },
  { degree: "B.Sc. Electrical & Electronics Engineering", school: "Izmir University of Economics", period: "2018 – 2023", status: "Completed", note: "High Honor Student, Final Year" },
];

const PROJECTS = [
  {
    title: "AI Motor Control Tuner",
    tags: ["React", "Reinforcement Learning", "Evolution Strategy", "PID Control", "Neural Networks"],
    description: "Interactive DC motor PID simulator with a built-in RL auto-tuner. A small neural network (4→32→16→3) learns to find optimal PID gains through an Evolution Strategy, evaluated against real motor dynamics. You can watch it train in real time, explore the search space it covers, and compare its solution against your own manual tuning. Includes presets based on real ABB drive setups I worked with.",
    status: "Live Demo",
    link: "#",
  },
  {
    title: "VOTEMAT: Blockchain Voting System",
    tags: ["Blockchain", "RSA Encryption", "Security", "Testing"],
    description: "A secure electronic voting platform built on blockchain with RSA encryption. I handled the encryption/decryption layer, wrote unit tests for vote integrity, and ran system testing throughout the dev cycle.",
    status: "Capstone Project",
    link: null,
  },
  {
    title: "Temperature-Controlled Watering System",
    tags: ["Arduino", "LabView", "Sensors", "Embedded"],
    description: "An Arduino-based setup that reads soil temperature through a thermistor and decides when to water automatically. Hooked it up to LabView for live data monitoring and easy threshold tweaking.",
    status: "Capstone Project",
    link: null,
  },
];

const LANGUAGES = [
  { lang: "Turkish", level: "Native", pct: 100 },
  { lang: "English", level: "C1+", pct: 90 },
  { lang: "German", level: "B2", pct: 65 },
];

// ══════════════════════════════════════════════════════════════════════
//  COMPONENTS
// ══════════════════════════════════════════════════════════════════════
function Nav({ active, onNav }) {
  const items = ["About", "Skills", "Projects", "Experience", "Education", "Contact"];
  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      borderBottom: `1px solid ${C.border}`,
      background: `${C.bg}dd`, backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px", display: "flex", justifyContent: "space-between", alignItems: "center", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: C.goldSubtle, border: `1px solid ${C.goldDim}` }}>
            <span style={{ fontFamily: heading, fontWeight: 700, fontSize: 13, color: C.gold }}>EB</span>
          </div>
          <span style={{ fontFamily: heading, fontWeight: 600, fontSize: 13, color: C.textSoft, letterSpacing: "-0.02em" }}>Egemen Birol</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {items.map(item => (
            <button key={item} onClick={() => onNav(item.toLowerCase())} style={{
              background: active === item.toLowerCase() ? C.goldSubtle : "transparent",
              border: `1px solid ${active === item.toLowerCase() ? C.goldDim : "transparent"}`,
              borderRadius: 6, padding: "5px 12px", cursor: "pointer",
              fontFamily: mono, fontSize: 10, letterSpacing: "0.04em",
              color: active === item.toLowerCase() ? C.gold : C.textDim,
              transition: "all 0.2s ease",
            }}>{item}</button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function SectionTitle({ label, title }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: C.gold, textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 8 }}>{label}</div>
      <h2 style={{ fontFamily: heading, fontSize: 32, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.03em", lineHeight: 1.2 }}>{title}</h2>
      <div style={{ width: 48, height: 2, background: C.gold, marginTop: 16, borderRadius: 1 }} />
    </div>
  );
}

function SkillBar({ name, level, delay, color }) {
  const [ref, visible] = useReveal(0.05);
  return (
    <div ref={ref} style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontFamily: mono, fontSize: 11, color: C.textSoft }}>{name}</span>
        <span style={{ fontFamily: mono, fontSize: 10, color: C.textDim }}>{level}%</span>
      </div>
      <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: visible ? `${level}%` : "0%",
          background: color || C.gold, borderRadius: 2,
          transition: `width 1s ease ${delay}s`,
        }} />
      </div>
    </div>
  );
}

function ExperienceCard({ exp, index }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Reveal delay={index * 0.1}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: "28px 28px", marginBottom: 16, position: "relative", overflow: "hidden",
        transition: "border-color 0.3s ease",
      }}
        onMouseEnter={e => e.currentTarget.style.borderColor = C.goldDim}
        onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
      >
        <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: C.gold, borderRadius: "0 2px 2px 0" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <h3 style={{ fontFamily: heading, fontSize: 18, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.02em" }}>{exp.title}</h3>
            <div style={{ fontFamily: body, fontSize: 14, color: C.gold, marginTop: 4 }}>{exp.company}</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, marginTop: 2 }}>{exp.location}</div>
          </div>
          <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, textAlign: "right", whiteSpace: "nowrap", marginLeft: 16 }}>
            {exp.period}
          </div>
        </div>
        <p style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.7, margin: "12px 0" }}>{exp.description}</p>

        {exp.highlights.length > 0 && (
          <>
            <button onClick={() => setExpanded(!expanded)} style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: mono, fontSize: 10, color: C.gold, padding: 0,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              <span style={{ transition: "transform 0.3s", transform: expanded ? "rotate(90deg)" : "rotate(0)", display: "inline-block" }}>▸</span>
              {expanded ? "Hide" : "Show"} Key Projects ({exp.highlights.length})
            </button>
            {expanded && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                {exp.highlights.map((h, i) => (
                  <div key={i} style={{ padding: "14px 16px", background: C.bgAlt, borderRadius: 8, borderLeft: `2px solid ${C.goldDim}` }}>
                    <div style={{ fontFamily: heading, fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 }}>{h.title}</div>
                    <div style={{ fontFamily: body, fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>{h.text}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Reveal>
  );
}

function ProjectCard({ project, index }) {
  return (
    <Reveal delay={index * 0.12}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: "24px 24px", height: "100%", display: "flex", flexDirection: "column",
        transition: "border-color 0.3s ease, transform 0.3s ease",
        cursor: "default",
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.goldDim; e.currentTarget.style.transform = "translateY(-3px)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "translateY(0)"; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <h3 style={{ fontFamily: heading, fontSize: 17, fontWeight: 700, color: C.text, margin: 0, letterSpacing: "-0.02em", flex: 1 }}>{project.title}</h3>
          <span style={{
            fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 4, marginLeft: 10, whiteSpace: "nowrap",
            background: project.status === "Live Demo" ? `${C.green}18` : C.goldSubtle,
            color: project.status === "Live Demo" ? C.green : C.gold,
            border: `1px solid ${project.status === "Live Demo" ? C.green + "33" : C.goldDim}`,
          }}>{project.status}</span>
        </div>
        <p style={{ fontFamily: body, fontSize: 13, color: C.textSoft, lineHeight: 1.7, margin: "0 0 16px 0", flex: 1 }}>
          {project.description}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {project.tags.map(tag => (
            <span key={tag} style={{
              fontFamily: mono, fontSize: 9, padding: "3px 8px",
              background: C.bgAlt, border: `1px solid ${C.border}`,
              borderRadius: 4, color: C.textDim,
            }}>{tag}</span>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN PORTFOLIO
// ══════════════════════════════════════════════════════════════════════
export default function Portfolio() {
  const [activeSection, setActiveSection] = useState("about");
  const sectionRefs = useRef({});

  const setRef = useCallback((id) => (el) => { sectionRefs.current[id] = el; }, []);

  const scrollTo = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const handleScroll = () => {
      const sections = ["about", "skills", "projects", "experience", "education", "contact"];
      for (const id of sections) {
        const el = sectionRefs.current[id];
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 120 && rect.bottom > 120) { setActiveSection(id); break; }
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: body, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Syne:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; scroll-padding-top: 72px; }
        body { background: ${C.bg}; }
        ::selection { background: ${C.goldDim}; color: ${C.goldBright}; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        a { color: ${C.gold}; text-decoration: none; transition: opacity 0.2s; }
        a:hover { opacity: 0.8; }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes lineGrow { from { width: 0; } to { width: 48px; } }
        @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>

      <Nav active={activeSection} onNav={scrollTo} />

      {/* ═══ HERO / ABOUT ══════════════════════════════════════════ */}
      <section ref={setRef("about")} id="about" style={{ minHeight: "100vh", display: "flex", alignItems: "center", position: "relative", overflow: "hidden" }}>
        {/* Grid background */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.03,
          backgroundImage: `linear-gradient(${C.textDim} 1px, transparent 1px), linear-gradient(90deg, ${C.textDim} 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }} />
        {/* Gradient orb */}
        <div style={{
          position: "absolute", top: "15%", right: "10%", width: 400, height: 400,
          background: `radial-gradient(circle, ${C.gold}08, transparent 70%)`,
          borderRadius: "50%", filter: "blur(60px)", pointerEvents: "none",
        }} />

        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "120px 32px 80px", width: "100%", position: "relative" }}>
          <div style={{ maxWidth: 720 }}>
            <div style={{ animation: "fadeIn 0.8s ease both" }}>
              <div style={{ fontFamily: mono, fontSize: 12, color: C.gold, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, boxShadow: `0 0 8px ${C.green}66` }} />
                Open to opportunities
              </div>
            </div>

            <div style={{ animation: "fadeIn 0.8s ease 0.15s both" }}>
              <h1 style={{ fontFamily: heading, fontSize: 56, fontWeight: 800, color: C.text, lineHeight: 1.1, letterSpacing: "-0.04em", marginBottom: 16 }}>
                Egemen<br />
                <span style={{ color: C.gold }}>Birol</span>
              </h1>
            </div>

            <div style={{ animation: "fadeIn 0.8s ease 0.3s both" }}>
              <div style={{ fontFamily: mono, fontSize: 14, color: C.textSoft, marginBottom: 28, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>Electrical & Electronics Engineer</span>
                <span style={{ color: C.textMuted }}>·</span>
                <span>M.Sc. Artificial Intelligence</span>
              </div>
            </div>

            <div style={{ animation: "fadeIn 0.8s ease 0.45s both" }}>
              <p style={{ fontFamily: body, fontSize: 17, color: C.textSoft, lineHeight: 1.8, maxWidth: 600, marginBottom: 36 }}>
                I've spent the last year programming Siemens PLCs, commissioning ABB inverters, and keeping motor control systems running at ArcelorMittal's hot rolling mill. Now I'm doing my M.Sc. in AI, because I want to bring data-driven thinking into the industrial automation world I already know.
              </p>
            </div>

            <div style={{ animation: "fadeIn 0.8s ease 0.6s both", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => scrollTo("projects")} style={{
                background: C.gold, color: C.bg, border: "none", borderRadius: 8,
                padding: "12px 28px", fontFamily: mono, fontSize: 12, fontWeight: 600,
                cursor: "pointer", letterSpacing: "0.03em",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${C.goldDim}`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
              >View Projects</button>
              <button onClick={() => scrollTo("contact")} style={{
                background: "transparent", color: C.textSoft, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "12px 28px", fontFamily: mono, fontSize: 12,
                cursor: "pointer", transition: "all 0.2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.goldDim; e.currentTarget.style.color = C.gold; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSoft; }}
              >Get in Touch</button>
            </div>

            {/* Quick stats */}
            <div style={{ animation: "fadeIn 0.8s ease 0.75s both", display: "flex", gap: 32, marginTop: 56 }}>
              {[
                { label: "Years of Experience", value: "2+" },
                { label: "Industrial Projects", value: "4" },
                { label: "Motors Configured", value: "50+" },
              ].map((s, i) => (
                <div key={i}>
                  <div style={{ fontFamily: heading, fontSize: 28, fontWeight: 700, color: C.gold }}>{s.value}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SKILLS ════════════════════════════════════════════════ */}
      <section ref={setRef("skills")} id="skills" style={{ padding: "100px 0", background: C.bgAlt, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
          <Reveal><SectionTitle label="01" title="Technical Skills" /></Reveal>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
            {Object.entries(SKILLS).map(([category, skills], ci) => (
              <Reveal key={category} delay={ci * 0.15}>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "24px" }}>
                  <div style={{ fontFamily: heading, fontSize: 14, fontWeight: 600, color: C.gold, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 4, height: 16, background: C.gold, borderRadius: 2 }} />
                    {category}
                  </div>
                  {skills.map((skill, si) => (
                    <SkillBar key={skill.name} name={skill.name} level={skill.level} delay={ci * 0.15 + si * 0.05}
                      color={ci === 0 ? C.gold : ci === 1 ? C.blue : C.orange} />
                  ))}
                </div>
              </Reveal>
            ))}
          </div>

          {/* Languages */}
          <Reveal delay={0.3}>
            <div style={{ marginTop: 32, display: "flex", gap: 16 }}>
              {LANGUAGES.map((l, i) => (
                <div key={l.lang} style={{ flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontFamily: heading, fontSize: 14, fontWeight: 600, color: C.text }}>{l.lang}</div>
                    <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim, marginTop: 2 }}>{l.level}</div>
                  </div>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", border: `2px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                    <svg width="48" height="48" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
                      <circle cx="24" cy="24" r="20" fill="none" stroke={C.border} strokeWidth="2" />
                      <circle cx="24" cy="24" r="20" fill="none" stroke={C.gold} strokeWidth="2"
                        strokeDasharray={`${(l.pct / 100) * 125.6} 125.6`}
                        strokeLinecap="round" style={{ transition: "stroke-dasharray 1s ease" }} />
                    </svg>
                    <span style={{ fontFamily: mono, fontSize: 10, color: C.gold, fontWeight: 600, zIndex: 1 }}>{l.pct}</span>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ PROJECTS ══════════════════════════════════════════════ */}
      <section ref={setRef("projects")} id="projects" style={{ padding: "100px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
          <Reveal><SectionTitle label="02" title="Projects" /></Reveal>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            {PROJECTS.map((p, i) => <ProjectCard key={p.title} project={p} index={i} />)}
          </div>
        </div>
      </section>

      {/* ═══ EXPERIENCE ════════════════════════════════════════════ */}
      <section ref={setRef("experience")} id="experience" style={{ padding: "100px 0", background: C.bgAlt, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
          <Reveal><SectionTitle label="03" title="Professional Experience" /></Reveal>
          <div style={{ maxWidth: 860 }}>
            {EXPERIENCE.map((exp, i) => <ExperienceCard key={i} exp={exp} index={i} />)}
          </div>
        </div>
      </section>

      {/* ═══ EDUCATION ═════════════════════════════════════════════ */}
      <section ref={setRef("education")} id="education" style={{ padding: "100px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
          <Reveal><SectionTitle label="04" title="Education" /></Reveal>
          <div style={{ display: "flex", gap: 20, maxWidth: 860 }}>
            {EDUCATION.map((edu, i) => (
              <Reveal key={i} delay={i * 0.15} style={{ flex: 1 }}>
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                  padding: "28px", position: "relative", overflow: "hidden",
                  transition: "border-color 0.3s",
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.goldDim}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                >
                  <div style={{
                    position: "absolute", top: 12, right: 12,
                    fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 4,
                    background: edu.status === "In Progress" ? `${C.gold}15` : `${C.green}15`,
                    color: edu.status === "In Progress" ? C.gold : C.green,
                    border: `1px solid ${edu.status === "In Progress" ? C.goldDim : C.green + "33"}`,
                  }}>{edu.status}</div>
                  <h3 style={{ fontFamily: heading, fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 6px", letterSpacing: "-0.02em", paddingRight: 80 }}>{edu.degree}</h3>
                  <div style={{ fontFamily: body, fontSize: 14, color: C.gold, marginBottom: 4 }}>{edu.school}</div>
                  <div style={{ fontFamily: mono, fontSize: 11, color: C.textDim }}>{edu.period}</div>
                  {edu.note && <div style={{ fontFamily: mono, fontSize: 11, color: C.green, marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>★</span> {edu.note}
                  </div>}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ CONTACT ═══════════════════════════════════════════════ */}
      <section ref={setRef("contact")} id="contact" style={{ padding: "100px 0 80px", background: C.bgAlt, borderTop: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
          <Reveal><SectionTitle label="05" title="Get in Touch" /></Reveal>
          <Reveal delay={0.15}>
            <p style={{ fontFamily: body, fontSize: 16, color: C.textSoft, lineHeight: 1.7, maxWidth: 520, marginBottom: 40 }}>
              I'm looking for roles where industrial automation meets AI. Think Industry 4.0, smart manufacturing, predictive maintenance, control systems. If that sounds like what you're building, I'd love to hear from you.
            </p>
          </Reveal>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {[
              { label: "Email", value: "egemenbirol5@gmail.com", href: "mailto:egemenbirol5@gmail.com", icon: "✉" },
              { label: "Location", value: "Germany", href: null, icon: "◉" },
            ].map((item, i) => (
              <Reveal key={item.label} delay={0.2 + i * 0.1}>
                <div style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                  padding: "18px 24px", display: "flex", alignItems: "center", gap: 14,
                  cursor: item.href ? "pointer" : "default",
                  transition: "border-color 0.3s",
                  minWidth: 260,
                }}
                  onClick={() => item.href && window.open(item.href, "_blank")}
                  onMouseEnter={e => item.href && (e.currentTarget.style.borderColor = C.goldDim)}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                    background: C.goldSubtle, border: `1px solid ${C.goldDim}`, fontSize: 16,
                  }}>{item.icon}</div>
                  <div>
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontFamily: mono, fontSize: 12, color: item.href ? C.gold : C.textSoft }}>{item.value}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ════════════════════════════════════════════════ */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "24px 32px", background: C.bg }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 10, color: C.textMuted }}>
            © {new Date().getFullYear()} Egemen Birol
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: C.textFaint }}>
            Industrial Automation × Artificial Intelligence
          </div>
        </div>
      </footer>
    </div>
  );
}
