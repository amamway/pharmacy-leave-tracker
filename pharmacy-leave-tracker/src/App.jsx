import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

// ─── constants ────────────────────────────────────────────────────────────────
const LT = {
  sick:           { label:"ลาป่วย (เต็มวัน)",      short:"ป่วย",       color:"#ef4444", days:1   },
  sick_half:      { label:"ลาป่วย (ครึ่งวัน)",     short:"ป่วย ½",     color:"#fca5a5", days:.5  },
  personal:       { label:"ลากิจ (เต็มวัน)",       short:"กิจ",        color:"#f59e0b", days:1   },
  personal_half:  { label:"ลากิจ (ครึ่งวัน)",      short:"กิจ ½",      color:"#fcd34d", days:.5  },
  vacation:       { label:"ลาพักผ่อน (เต็มวัน)",   short:"พักผ่อน",   color:"#3b82f6", days:1   },
  vacation_half:  { label:"ลาพักผ่อน (ครึ่งวัน)",  short:"พักผ่อน ½", color:"#93c5fd", days:.5  },
  maternity:      { label:"ลาคลอด (เต็มวัน)",      short:"คลอด",       color:"#ec4899", days:1   },
  maternity_half: { label:"ลาคลอด (ครึ่งวัน)",     short:"คลอด ½",     color:"#f9a8d4", days:.5  },
};
const LT_GROUPS = [
  { key:"sick",      full:"sick",      half:"sick_half",      label:"ลาป่วย",     color:"#ef4444" },
  { key:"personal",  full:"personal",  half:"personal_half",  label:"ลากิจ",      color:"#f59e0b" },
  { key:"vacation",  full:"vacation",  half:"vacation_half",  label:"ลาพักผ่อน", color:"#3b82f6" },
  { key:"maternity", full:"maternity", half:"maternity_half", label:"ลาคลอด",    color:"#ec4899" },
];
const DAYS_TH   = ["อา","จ","อ","พ","พฤ","ศ","ส"];
const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const ACCOUNTS  = [
  { username:"admin",  password:"0000", role:"admin"  },
  { username:"member", password:"1234", role:"viewer" },
];
const AVC = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ec4899","#8b5cf6","#14b8a6","#f97316"];
const VAC_BASE      = 10;
const VAC_CARRY_CAP = 10;
const F   = { fontFamily:"'Sarabun','Noto Sans Thai',sans-serif" };
const BG  = "linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)";

// ─── date/cycle helpers ───────────────────────────────────────────────────────
const today      = new Date();
const TODAY_STR  = today.toISOString().split("T")[0];
const CY         = today.getFullYear();
// รอบวันลา: 1 ต.ค. (cycleYear-1) → 30 ก.ย. (cycleYear)
const cycleOfDate  = d => { const [y,m] = d.split("-").map(Number); return m >= 10 ? y+1 : y; };
const currentCycle = () => cycleOfDate(TODAY_STR);
const inCycle      = (d, cy) => d >= `${cy-1}-10-01` && d <= `${cy}-09-30`;
const cycleLabel   = cy => `รอบวันลา ตุลาคม ${cy-1+543} – กันยายน ${cy+543}`;

// ─── data helpers ─────────────────────────────────────────────────────────────
let _id = Date.now();
const uid   = () => _id++;
const mkP   = n => ({ id: uid(), name: n, carryover: {}, leaves: {}, joinCycle: currentCycle() });
const avc   = id => AVC[id % AVC.length];
const dim   = (y,m) => new Date(y,m+1,0).getDate();
const fd    = (y,m) => new Date(y,m,1).getDay();
const ds    = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const fmtDays = n => Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`;

const getCarry  = (p, cy) => {
  const raw = p.carryover?.[cy];
  if (!raw && raw !== 0) return { whole:0, half:0 };
  if (typeof raw === "object") return { whole: raw.whole||0, half: raw.half||0 };
  return { whole: raw, half: 0 };
};
const carryDays = c => c.whole + c.half * 0.5;
const usedN     = (p, t, cy) => Object.entries(p.leaves).filter(([d,v]) => v===t && inCycle(d,cy)).length;
const vacUsed   = (p, cy) => usedN(p,"vacation",cy) + usedN(p,"vacation_half",cy)*0.5;
const mkCells   = (y,m) => {
  const c = []; for (let i=0; i<fd(y,m); i++) c.push(null);
  for (let d=1; d<=dim(y,m); d++) c.push(d); return c;
};

// ─── auto-carry logic (รันตอนโหลด Firestore) ─────────────────────────────────
function applyAutoCarry(pharmas) {
  const cur = currentCycle();
  return pharmas.map(p => {
    // หารอบที่มีการลาจริงๆ (ไม่รวม carryover keys เพื่อกันทับ)
    const leaveCycles = new Set();
    Object.keys(p.leaves||{}).forEach(d => leaveCycles.add(cycleOfDate(d)));
    if (p.joinCycle) leaveCycles.add(p.joinCycle);
    if (!leaveCycles.size) return p; // ไม่มีข้อมูลการลาเลย ไม่ต้องทำอะไร

    const earliest = Math.min(...leaveCycles);
    // เริ่ม loop จาก earliest → cur-1
    // carryover ของรอบ earliest ใช้ค่าที่มีอยู่แล้ว (admin กรอกเอง) ไม่แตะ
    // loop คำนวณ carry จาก earliest → ทบเข้า earliest+1 → earliest+2 → ... → cur
    const newCarry = { ...p.carryover };
    for (let cy = earliest; cy < cur; cy++) {
      const carry  = getCarry({ carryover: newCarry }, cy); // carryover ของรอบนี้ (รอบแรก = admin กรอก, รอบถัดไป = คำนวณ)
      const total  = VAC_BASE + carryDays(carry);
      const used   = vacUsed({ leaves: p.leaves, carryover: newCarry }, cy);
      const rem    = Math.max(0, total - used);
      const capped = Math.min(rem, VAC_CARRY_CAP);
      newCarry[cy+1] = { whole: Math.floor(capped), half: (capped % 1) >= 0.5 ? 1 : 0 };
    }
    return { ...p, carryover: newCarry };
  });
}

const INIT_PHARMAS = [mkP("ภก.สมชาย"), mkP("ภญ.สุดา")];

// ─── shared micro-components ──────────────────────────────────────────────────
const Card = ({ children, style={} }) => (
  <div style={{ background:"#1e293b", borderRadius:14, padding:20, border:"1px solid #334155", ...style }}>
    {children}
  </div>
);
const SectionTitle = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>
    {children}
  </div>
);

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [u, setU]   = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [drop, setDrop] = useState(false);
  const go = () => {
    const a = ACCOUNTS.find(a => a.username===u && a.password===pw);
    a ? onLogin(a) : setErr("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  };
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:BG, ...F }}>
      <div style={{ width:340, background:"#1e293b", borderRadius:20, padding:"36px 32px",
        border:"1px solid #334155", boxShadow:"0 24px 60px #00000099" }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:40, marginBottom:8 }}>💊</div>
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, color:"#f1f5f9" }}>Pharmacy Leave Tracker</h2>
          <p style={{ margin:"6px 0 0", fontSize:12, color:"#64748b" }}>กรุณาเข้าสู่ระบบ</p>
        </div>
        <label style={{ fontSize:12, color:"#94a3b8", display:"block", marginBottom:5 }}>ชื่อผู้ใช้</label>
        <div style={{ position:"relative", marginBottom:14 }}>
          <div onClick={()=>setDrop(d=>!d)} style={{ padding:"10px 12px", borderRadius:9,
            border:`1px solid ${drop?"#3b82f6":"#334155"}`, background:"#0f172a",
            color:u?"#f1f5f9":"#475569", fontSize:14, cursor:"pointer",
            display:"flex", justifyContent:"space-between", alignItems:"center", userSelect:"none" }}>
            <span>{u||"เลือกชื่อผู้ใช้…"}</span>
            <span style={{ fontSize:11, color:"#475569", transform:drop?"rotate(180deg)":"none", transition:"transform .2s" }}>▾</span>
          </div>
          {drop && (
            <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, zIndex:50,
              background:"#0f172a", border:"1px solid #334155", borderRadius:12,
              boxShadow:"0 12px 32px #00000099", overflow:"hidden" }}>
              {ACCOUNTS.map(a => (
                <div key={a.username} onClick={()=>{setU(a.username);setErr("");setDrop(false);}}
                  style={{ padding:"12px 16px", cursor:"pointer", display:"flex", alignItems:"center",
                    gap:12, borderBottom:"1px solid #1e293b" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#1e293b"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{ width:36, height:36, borderRadius:"50%", flexShrink:0,
                    background:a.role==="admin"?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"linear-gradient(135deg,#0f766e,#0ea5e9)",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>
                    {a.role==="admin"?"🔑":"👁"}
                  </div>
                  <span style={{ fontSize:14, fontWeight:700, color:"#f1f5f9" }}>{a.username}</span>
                  {u===a.username && <span style={{ marginLeft:"auto", color:"#3b82f6" }}>✓</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <label style={{ fontSize:12, color:"#94a3b8", display:"block", marginBottom:5 }}>รหัสผ่าน</label>
        <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr("");}}
          onKeyDown={e=>e.key==="Enter"&&go()} placeholder="••••"
          style={{ width:"100%", padding:"10px 12px", borderRadius:9, border:"1px solid #334155",
            background:"#0f172a", color:"#f1f5f9", fontSize:18, letterSpacing:4,
            boxSizing:"border-box", marginBottom:20, outline:"none", ...F }}/>
        {err && <div style={{ fontSize:12, color:"#ef4444", marginBottom:12, textAlign:"center",
          background:"#ef444411", borderRadius:8, padding:"8px 12px" }}>{err}</div>}
        <button onClick={go} style={{ width:"100%", padding:12, borderRadius:10, border:"none",
          background:u?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"#1e293b",
          color:u?"#fff":"#475569", fontSize:15, fontWeight:700,
          cursor:u?"pointer":"not-allowed", ...F }}>เข้าสู่ระบบ</button>
      </div>
    </div>
  );
}

// ─── PersonPicker ─────────────────────────────────────────────────────────────
function PersonPicker({ pharmas, selId, setSelId, isAdmin, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [name, setName]     = useState("");
  const add = () => { if (!name.trim()) return; onAdd(name.trim()); setName(""); setAdding(false); };
  return (
    <Card>
      <SectionTitle>ชื่อเภสัชกร</SectionTitle>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
        {pharmas.map(p => {
          const sel = p.id === selId;
          return (
            <div key={p.id} onClick={()=>setSelId(p.id)} style={{
              display:"inline-flex", alignItems:"center", gap:6, padding:"5px 10px",
              borderRadius:20, cursor:"pointer", userSelect:"none",
              background:sel?avc(p.id):"#0f172a", border:sel?"none":"1px solid #334155", transition:"all .15s" }}>
              <span style={{ fontSize:12, fontWeight:sel?700:400, color:sel?"#fff":"#94a3b8", whiteSpace:"nowrap" }}>{p.name}</span>
              {isAdmin && !sel && (
                <span onClick={e=>{e.stopPropagation();onRemove(p.id);}}
                  style={{ fontSize:10, color:"#ef4444", opacity:.7, lineHeight:1 }}>✕</span>
              )}
            </div>
          );
        })}
        {isAdmin && (adding ? (
          <div style={{ display:"flex", gap:5, alignItems:"center" }}>
            <input autoFocus value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")add();if(e.key==="Escape")setAdding(false);}}
              placeholder="ชื่อ…" style={{ padding:"5px 10px", borderRadius:20, border:"1px solid #3b82f6",
                background:"#0f172a", color:"#f1f5f9", fontSize:12, outline:"none", width:110, ...F }}/>
            <button onClick={add} style={{ padding:"5px 10px", borderRadius:20, border:"none",
              background:"#3b82f6", color:"#fff", fontSize:12, cursor:"pointer", ...F }}>+</button>
            <button onClick={()=>setAdding(false)} style={{ padding:"5px 10px", borderRadius:20,
              border:"1px solid #334155", background:"transparent", color:"#64748b", fontSize:12, cursor:"pointer", ...F }}>✕</button>
          </div>
        ) : (
          <div onClick={()=>setAdding(true)} style={{ padding:"5px 12px", borderRadius:20,
            border:"1px dashed #475569", color:"#475569", fontSize:12, cursor:"pointer" }}>+ เพิ่ม</div>
        ))}
      </div>
    </Card>
  );
}

// ─── CyclePicker ──────────────────────────────────────────────────────────────
function CyclePicker({ viewCycle, setViewCycle }) {
  const [open, setOpen] = useState(false);
  const cur = currentCycle();
  const cycles = Array.from({ length: 21 }, (_,i) => cur + i);
  return (
    <Card style={{ padding:"12px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:1, whiteSpace:"nowrap" }}>รอบวันลา</span>
        <div style={{ position:"relative" }}>
          <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
            background:"#0f172a", borderRadius:9, padding:"7px 14px", border:"1px solid #334155",
            minWidth:260, userSelect:"none" }}>
            <span style={{ fontSize:13, fontWeight:700, color:"#f1f5f9", flex:1 }}>{cycleLabel(viewCycle)}</span>
            <span style={{ fontSize:11, color:"#475569" }}>▾</span>
          </div>
          {open && (
            <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:50, background:"#0f172a",
              border:"1px solid #334155", borderRadius:12, boxShadow:"0 12px 32px #00000099",
              maxHeight:260, overflowY:"auto", minWidth:280 }}>
              {cycles.map(y => (
                <div key={y} onClick={()=>{setViewCycle(y);setOpen(false);}}
                  style={{ padding:"9px 16px", cursor:"pointer", fontSize:13,
                    fontWeight:y===viewCycle?700:400, color:y===viewCycle?"#38bdf8":"#94a3b8",
                    background:y===viewCycle?"#1e293b":"transparent", borderBottom:"1px solid #1e293b44" }}
                  onMouseEnter={e=>{ if(y!==viewCycle) e.currentTarget.style.background="#1e293b"; }}
                  onMouseLeave={e=>{ if(y!==viewCycle) e.currentTarget.style.background="transparent"; }}>
                  {cycleLabel(y)}
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={()=>setViewCycle(v=>Math.max(cur,v-1))} disabled={viewCycle<=cur}
          style={{ background:"#0f172a", border:"1px solid #334155", color:viewCycle<=cur?"#334155":"#94a3b8",
            borderRadius:8, width:32, height:32, fontSize:16, cursor:viewCycle<=cur?"not-allowed":"pointer" }}>‹</button>
        <button onClick={()=>setViewCycle(v=>v+1)}
          style={{ background:"#0f172a", border:"1px solid #334155", color:"#94a3b8",
            borderRadius:8, width:32, height:32, fontSize:16, cursor:"pointer" }}>›</button>
        {viewCycle===cur && (
          <span style={{ fontSize:10, color:"#34d399", background:"#10b98122", padding:"3px 9px", borderRadius:20 }}>รอบปัจจุบัน</span>
        )}
      </div>
    </Card>
  );
}

// ─── LeaveSummary ─────────────────────────────────────────────────────────────
function LeaveSummary({ p, viewCycle, isAdmin, onCarryover }) {
  const carry    = getCarry(p, viewCycle);
  const carryVal = carryDays(carry);
  const total    = VAC_BASE + carryVal;
  const used     = vacUsed(p, viewCycle);
  const rem      = total - used;
  const isCur    = viewCycle === currentCycle();
  const cappedRem = Math.min(Math.max(0, rem), VAC_CARRY_CAP);
  const nxWhole  = Math.floor(cappedRem);
  const nxHalf   = (cappedRem % 1) >= 0.5 ? 1 : 0;
  const pct      = total > 0 ? Math.min(100, (used/total)*100) : 0;

  const ddSel = (vals, cur, onChange) => (
    <select value={cur} onChange={e=>onChange(parseInt(e.target.value))}
      style={{ borderRadius:6, border:"1px solid #475569", background:"#0f172a", color:"#38bdf8",
        fontSize:13, fontWeight:700, outline:"none", padding:"2px 6px", ...F }}>
      {vals.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
    </select>
  );

  return (
    <Card>
      <SectionTitle>สรุปการลา · {p.name} · {cycleLabel(viewCycle)}</SectionTitle>
      <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
        {["sick","personal","maternity"].map(gk => {
          const g = LT_GROUPS.find(x=>x.key===gk);
          const f = usedN(p,g.full,viewCycle), h = usedN(p,g.half,viewCycle);
          const t = f + h*0.5;
          return (
            <div key={gk} style={{ flex:1, minWidth:90, background:"#0f172a", borderRadius:10,
              padding:"10px 12px", border:`1px solid ${g.color}33` }}>
              <div style={{ fontSize:10, color:g.color, fontWeight:700, marginBottom:6 }}>{g.label}</div>
              <div style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", lineHeight:1 }}>{fmtDays(t)}</div>
              <div style={{ fontSize:9, color:"#475569", marginTop:3 }}>วัน</div>
              {(f>0||h>0) && (
                <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap" }}>
                  {f>0 && <span style={{ fontSize:9, color:LT[g.full].color, background:LT[g.full].color+"22", padding:"1px 5px", borderRadius:4 }}>เต็ม {f}</span>}
                  {h>0 && <span style={{ fontSize:9, color:LT[g.half].color, background:LT[g.half].color+"22", padding:"1px 5px", borderRadius:4 }}>ครึ่ง {h}</span>}
                </div>
              )}
            </div>
          );
        })}

        {/* vacation card */}
        <div style={{ flex:2, minWidth:220, background:"#0f172a", borderRadius:10,
          padding:"12px 14px", border:`1px solid ${LT.vacation.color}44` }}>
          <div style={{ fontSize:10, color:LT.vacation.color, fontWeight:700, marginBottom:10 }}>🏖 ลาพักผ่อน</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>โควต้า</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>{VAC_BASE}</div>
              <div style={{ fontSize:9, color:"#475569" }}>วัน</div>
            </div>
            <div style={{ color:"#334155", fontSize:14, paddingBottom:6 }}>+</div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>วันลาทบ</div>
              {isAdmin && isCur ? (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  {ddSel(
                    Array.from({length:21},(_,i)=>({value:i,label:`${i} วัน`})),
                    carry.whole,
                    v => onCarryover(viewCycle, { whole:v, half:carry.half })
                  )}
                  {ddSel(
                    [{value:0,label:"+ 0"},{value:1,label:"+ ½"}],
                    carry.half,
                    v => onCarryover(viewCycle, { whole:carry.whole, half:v })
                  )}
                </div>
              ) : (
                <div style={{ fontSize:18, fontWeight:800, color:"#38bdf8" }}>{fmtDays(carryVal)}</div>
              )}
              <div style={{ fontSize:9, color:"#475569", marginTop:2 }}>วัน</div>
            </div>
            <div style={{ color:"#334155", fontSize:14, paddingBottom:6 }}>=</div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>รวม</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>{fmtDays(total)}</div>
              <div style={{ fontSize:9, color:"#475569" }}>วัน</div>
            </div>
            <div style={{ flex:1, minWidth:100 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:3 }}>
                <span style={{ color:"#64748b" }}>ใช้ <b style={{ color:LT.vacation.color }}>{fmtDays(used)}</b></span>
                <span style={{ color:"#64748b" }}>เหลือ <b style={{ color:rem<3?"#ef4444":"#10b981" }}>{fmtDays(rem)}</b></span>
              </div>
              <div style={{ height:5, background:"#1e293b", borderRadius:5, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:5, width:`${pct}%`,
                  background:rem<3?"#ef4444":LT.vacation.color, transition:"width .3s" }}/>
              </div>
              <div style={{ display:"flex", gap:8, marginTop:4 }}>
                <span style={{ fontSize:9, color:LT.vacation.color }}>เต็ม {usedN(p,"vacation",viewCycle)}</span>
                <span style={{ fontSize:9, color:LT.vacation_half.color }}>ครึ่ง {usedN(p,"vacation_half",viewCycle)}</span>
              </div>
            </div>
          </div>

          {/* auto-carry preview */}
          <div style={{ marginTop:12, padding:"8px 12px", borderRadius:8, background:"#172554",
            border:"1px solid #1e3a8a", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, color:"#93c5fd" }}>🔄 ทบรอบถัดไปอัตโนมัติ (สูงสุด {VAC_CARRY_CAP} วัน):</span>
            <span style={{ fontSize:13, fontWeight:700, color:cappedRem<=0?"#ef4444":"#34d399" }}>
              {fmtDays(cappedRem)} วัน
            </span>
            {rem > VAC_CARRY_CAP && (
              <span style={{ fontSize:9, color:"#fbbf24" }}>(เหลือจริง {fmtDays(rem)} ตัดเพดาน {VAC_CARRY_CAP})</span>
            )}
            <span style={{ fontSize:9, color:"#475569" }}>({nxWhole} เต็ม{nxHalf?" + ½":""})</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── CalGrid ──────────────────────────────────────────────────────────────────
function CalGrid({ pharmas, selected, viewMonth, viewYear, setViewMonth, setViewYear, isAdmin, activeLT, setActiveLT, onToggle }) {
  const isSingle = !!selected;
  const [yearOpen, setYearOpen] = useState(false);

  const leaveMap = {};
  if (!isSingle) {
    pharmas.forEach(p => {
      Object.entries(p.leaves).forEach(([d,t]) => {
        if (!leaveMap[d]) leaveMap[d] = [];
        leaveMap[d].push({ name:p.name, id:p.id, t, color:LT[t].color });
      });
    });
  }

  const prevM = () => {
    if (viewMonth===0) { setViewMonth(11); setViewYear(v=>v-1); }
    else setViewMonth(m=>m-1);
  };
  const nextM = () => {
    if (viewMonth===11) { setViewMonth(0); setViewYear(v=>v+1); }
    else setViewMonth(m=>m+1);
  };
  const yearOpts = Array.from({length:21},(_,i)=>CY+i);

  return (
    <Card>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <button onClick={prevM} style={{ background:"none", border:"none", color:"#64748b", fontSize:22, cursor:"pointer", padding:"4px 8px" }}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <span style={{ fontWeight:700, fontSize:16 }}>{MONTHS_TH[viewMonth]}</span>
            <div style={{ position:"relative" }}>
              <div onClick={()=>setYearOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer",
                background:"#0f172a", borderRadius:7, padding:"3px 9px", border:"1px solid #334155", userSelect:"none" }}>
                <span style={{ fontWeight:700, fontSize:16, color:"#f1f5f9" }}>{viewYear+543}</span>
                <span style={{ fontSize:9, color:"#475569" }}>▾</span>
              </div>
              {yearOpen && (
                <div style={{ position:"absolute", top:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)",
                  zIndex:50, background:"#0f172a", border:"1px solid #334155", borderRadius:12,
                  boxShadow:"0 12px 32px #00000099", maxHeight:240, overflowY:"auto", minWidth:120 }}>
                  {yearOpts.map(y => (
                    <div key={y} onClick={()=>{setViewYear(y);setYearOpen(false);}}
                      style={{ padding:"8px 16px", cursor:"pointer", fontSize:13,
                        fontWeight:y===viewYear?700:400, color:y===viewYear?"#38bdf8":"#94a3b8",
                        background:y===viewYear?"#1e293b":"transparent", borderBottom:"1px solid #1e293b44" }}
                      onMouseEnter={e=>{ if(y!==viewYear) e.currentTarget.style.background="#1e293b"; }}
                      onMouseLeave={e=>{ if(y!==viewYear) e.currentTarget.style.background="transparent"; }}>
                      พ.ศ. {y+543}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>{isSingle?selected.name:"ปฏิทินรวม · ทุกคน"}</div>
        </div>
        <button onClick={nextM} style={{ background:"none", border:"none", color:"#64748b", fontSize:22, cursor:"pointer", padding:"4px 8px" }}>›</button>
      </div>

      {isSingle && isAdmin && (
        <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
          {Object.entries(LT).map(([key,lt]) => (
            <button key={key} onClick={()=>setActiveLT(key)} style={{ padding:"6px 12px", borderRadius:7,
              border:"none", cursor:"pointer", fontSize:12, ...F,
              background:activeLT===key?lt.color:"#0f172a", color:activeLT===key?"#fff":"#94a3b8",
              fontWeight:activeLT===key?700:400,
              boxShadow:activeLT===key?`0 0 10px ${lt.color}55`:"none" }}>
              {lt.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:4 }}>
        {DAYS_TH.map(d => (
          <div key={d} style={{ textAlign:"center", fontSize:11, color:"#475569", fontWeight:700, padding:"3px 0" }}>{d}</div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
        {mkCells(viewYear,viewMonth).map((day,i) => {
          if (!day) return <div key={i}/>;
          const dateStr = ds(viewYear,viewMonth,day);
          const isToday = dateStr===TODAY_STR;
          if (isSingle) {
            const lt = selected.leaves[dateStr] ? LT[selected.leaves[dateStr]] : null;
            return (
              <div key={i} onClick={()=>onToggle&&isAdmin&&onToggle(dateStr)}
                style={{ aspectRatio:"1", borderRadius:8, display:"flex", flexDirection:"column",
                  alignItems:"center", justifyContent:"center",
                  cursor:isAdmin&&onToggle?"pointer":"default",
                  background:lt?lt.color:isToday?"#172554":"#0f172a",
                  border:isToday&&!lt?"1px solid #3b82f6":"1px solid transparent",
                  transition:"all .15s", opacity:!isAdmin&&!lt?.75:1 }}>
                <span style={{ fontSize:13, fontWeight:isToday?700:400, color:lt?"#fff":"#cbd5e1" }}>{day}</span>
                {lt && <span style={{ fontSize:9, color:"rgba(255,255,255,.85)", marginTop:1 }}>{lt.short}</span>}
              </div>
            );
          } else {
            const arr = leaveMap[dateStr]||[];
            const heat = arr.length===0?0:arr.length===1?1:arr.length<=3?2:3;
            const hBg = ["#0f172a","#1e3a5f","#1e3a8a","#1e1b4b"][heat];
            const hBd = ["transparent","#3b82f6","#6366f1","#a855f7"][heat];
            return (
              <OverviewCell key={i} day={day} dateStr={dateStr} isToday={isToday}
                arr={arr} hBg={hBg} hBd={hBd} heat={heat}/>
            );
          }
        })}
      </div>
      {!isSingle && (
        <div style={{ display:"flex", gap:12, marginTop:12, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ fontSize:11, color:"#475569" }}>ความเข้มสี:</span>
          {[["1 คน","#1e3a5f","#3b82f6"],["2–3 คน","#1e3a8a","#6366f1"],["4+ คน","#1e1b4b","#a855f7"]].map(([l,bg,bd]) => (
            <div key={l} style={{ display:"flex", alignItems:"center", gap:4 }}>
              <div style={{ width:12, height:12, borderRadius:3, background:bg, border:`1px solid ${bd}` }}/>
              <span style={{ fontSize:11, color:"#94a3b8" }}>{l}</span>
            </div>
          ))}
        </div>
      )}
      {isSingle && isAdmin && (
        <div style={{ marginTop:12, fontSize:11, color:"#475569", textAlign:"center" }}>คลิกที่วันเพื่อบันทึก · คลิกซ้ำเพื่อยกเลิก</div>
      )}
    </Card>
  );
}

// ─── OverviewCell with tooltip ────────────────────────────────────────────────
function OverviewCell({ day, dateStr, isToday, arr, hBg, hBd, heat }) {
  const [showSheet, setShowSheet] = useState(false);
  const [ttPos, setTtPos]         = useState(null);
  const isTouch = () => window.matchMedia("(pointer:coarse)").matches;

  const content = arr.length > 0 ? (
    <div>
      <div style={{ fontSize:11, color:"#64748b", marginBottom:8, fontWeight:600 }}>
        {day} {MONTHS_TH[parseInt(dateStr.split("-")[1])-1]} {parseInt(dateStr.split("-")[0])+543}
      </div>
      {arr.map((x,i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
          <div style={{ width:9, height:9, borderRadius:"50%", background:x.color, flexShrink:0, boxShadow:`0 0 5px ${x.color}99` }}/>
          <span style={{ fontSize:13, fontWeight:600, color:"#e2e8f0" }}>{x.name}</span>
          <span style={{ fontSize:11, color:x.color, background:x.color+"22", padding:"2px 8px", borderRadius:5, marginLeft:"auto", whiteSpace:"nowrap" }}>{LT[x.t].label}</span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <>
      <div
        onMouseEnter={e=>{ if(!isTouch()&&arr.length>0) setTtPos({x:e.clientX,y:e.clientY}); }}
        onMouseMove={e=>{ if(ttPos) setTtPos({x:e.clientX,y:e.clientY}); }}
        onMouseLeave={()=>setTtPos(null)}
        onTouchStart={e=>{ if(arr.length>0){e.preventDefault();setShowSheet(true);} }}
        style={{ borderRadius:9, padding:"4px 3px 3px", minHeight:52,
          background:isToday&&heat===0?"#172554":hBg,
          border:`1px solid ${isToday&&heat===0?"#3b82f6":hBd}`,
          cursor:arr.length>0?"pointer":"default", position:"relative", transition:"transform .12s" }}
        onMouseOver={e=>{ if(arr.length>0) e.currentTarget.style.transform="scale(1.05)"; }}
        onMouseOut={e=>e.currentTarget.style.transform="scale(1)"}>
        <div style={{ fontSize:12, fontWeight:isToday?700:400, color:isToday?"#38bdf8":"#cbd5e1", marginBottom:2 }}>{day}</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
          {arr.slice(0,6).map((x,i) => (
            <div key={i} style={{ width:6, height:6, borderRadius:"50%", background:x.color, boxShadow:`0 0 3px ${x.color}99` }}/>
          ))}
          {arr.length>6 && <span style={{ fontSize:8, color:"#94a3b8", lineHeight:"6px" }}>+{arr.length-6}</span>}
        </div>
      </div>
      {/* desktop tooltip */}
      {ttPos && content && (
        <div style={{ position:"fixed", left:ttPos.x+14, top:ttPos.y-20, zIndex:9999, pointerEvents:"none",
          background:"#0f172a", border:"1px solid #334155", borderRadius:12, padding:"10px 14px",
          minWidth:160, maxWidth:240, boxShadow:"0 12px 32px #00000099" }}>
          {content}
        </div>
      )}
      {/* mobile bottom sheet */}
      {showSheet && (
        <>
          <div onClick={()=>setShowSheet(false)} style={{ position:"fixed", inset:0, zIndex:9998,
            background:"rgba(0,0,0,.55)", backdropFilter:"blur(2px)" }}/>
          <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:9999,
            background:"#1e293b", borderTop:"1px solid #334155", borderRadius:"20px 20px 0 0",
            padding:"20px 20px 32px" }}>
            <div style={{ width:36, height:4, background:"#334155", borderRadius:2, margin:"0 auto 16px" }}/>
            {content}
          </div>
        </>
      )}
    </>
  );
}

// ─── MonthlySummary ───────────────────────────────────────────────────────────
function MonthlySummary({ pharmas, viewMonth, viewYear }) {
  const pfx = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}`;
  return (
    <Card>
      <SectionTitle>สรุปรายคนประจำเดือน {MONTHS_TH[viewMonth]} {viewYear+543}</SectionTitle>
      {pharmas.map(p => {
        const groups = LT_GROUPS.map(g => {
          const f = Object.entries(p.leaves).filter(([d,v])=>v===g.full&&d.startsWith(pfx)).length;
          const h = Object.entries(p.leaves).filter(([d,v])=>v===g.half&&d.startsWith(pfx)).length;
          return { g, f, h, days: f+h*0.5 };
        }).filter(x=>x.days>0);
        const totalDays = groups.reduce((s,x)=>s+x.days,0);
        return (
          <div key={p.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 12px",
            borderRadius:10, background:"#0f172a", marginBottom:7 }}>
            <div style={{ width:30, height:30, borderRadius:"50%", background:avc(p.id),
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:12, fontWeight:700, color:"#fff", flexShrink:0 }}>
              {p.name.replace(/ภก\.|ภญ\./,"")[0]}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{p.name}</div>
              {groups.length>0 ? (
                <div style={{ display:"flex", gap:5, marginTop:3, flexWrap:"wrap" }}>
                  {groups.map(({g,days})=>(
                    <span key={g.key} style={{ fontSize:11, color:g.color, background:g.color+"22",
                      padding:"1px 7px", borderRadius:5, fontWeight:600 }}>{g.label} {fmtDays(days)}</span>
                  ))}
                </div>
              ) : <div style={{ fontSize:11, color:"#475569", marginTop:2 }}>ไม่มีการลา</div>}
            </div>
            {totalDays>0 && (
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", whiteSpace:"nowrap" }}>
                {fmtDays(totalDays)}<span style={{ fontSize:11, color:"#475569", fontWeight:400 }}> วัน</span>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [acct,      setAcct]      = useState(null);
  const [pharmas,   setPharmas]   = useState([]);
  const [selId,     setSelId]     = useState(null);
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear,  setViewYear]  = useState(CY);
  const [viewCycle, setViewCycle] = useState(currentCycle());
  const [activeLT,  setActiveLT]  = useState("sick");
  const [tab,       setTab]       = useState("overview");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const saveTimer = useRef(null);

  // ── Firestore: load + realtime sync ───────────────────────────────────────
  useEffect(() => {
    const ref  = doc(db, "data", "pharmacists");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const raw  = snap.data().list || [];
        const list = applyAutoCarry(raw);        // ← auto-carry ทุกครั้งที่โหลด
        setPharmas(list);
        // ถ้า auto-carry เปลี่ยนค่า ให้ save กลับขึ้น Firestore ด้วย
        const changed = JSON.stringify(list) !== JSON.stringify(raw);
        if (changed) saveToFirestore(list);
        setSelId(prev => (prev && list.find(p=>p.id===prev)) ? prev : (list[0]?.id||null));
      } else {
        const init = applyAutoCarry(INIT_PHARMAS);
        saveToFirestore(init);
        setPharmas(init);
        setSelId(init[0].id);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function saveToFirestore(list) {
    setSaving(true);
    try { await setDoc(doc(db,"data","pharmacists"), { list }); }
    catch(e) { console.error("Save error:", e); }
    finally { setSaving(false); }
  }

  // debounce saves (300ms) เพื่อไม่ให้ยิง Firestore ทุก keystroke
  function updatePharmas(next) {
    setPharmas(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToFirestore(next), 300);
  }

  if (!acct) return <Login onLogin={setAcct}/>;
  if (loading) return (
    <div style={{ minHeight:"100vh", background:BG, display:"flex",
      alignItems:"center", justifyContent:"center", ...F }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:16 }}>💊</div>
        <div style={{ color:"#64748b", fontSize:14 }}>กำลังโหลดข้อมูล…</div>
      </div>
    </div>
  );

  const isAdmin = acct.role === "admin";
  const sel     = pharmas.find(p=>p.id===selId) || pharmas[0];

  function addP(name) {
    const p    = mkP(name);
    const next = [...pharmas, p];
    updatePharmas(next); setSelId(p.id);
  }
  function removeP(id) {
    const rest = pharmas.filter(p=>p.id!==id);
    updatePharmas(rest);
    if (selId===id && rest.length) setSelId(rest[0].id);
  }
  function toggleLeave(dateStr) {
    if (!isAdmin) return;
    const next = pharmas.map(p => {
      if (p.id!==selId) return p;
      const lv = {...p.leaves};
      lv[dateStr]===activeLT ? delete lv[dateStr] : (lv[dateStr]=activeLT);
      return {...p, leaves:lv};
    });
    updatePharmas(next);
  }
  function updateCarryover(cy, val) {
    const norm = typeof val==="object"
      ? { whole:Math.max(0,val.whole||0), half:val.half?1:0 }
      : { whole:Math.max(0,parseInt(val)||0), half:0 };
    const next = pharmas.map(p => p.id!==selId ? p : {...p, carryover:{...p.carryover,[cy]:norm}});
    updatePharmas(next);
  }

  const tabStyle = active => ({
    padding:"10px 22px", borderRadius:10, border:"none", cursor:"pointer",
    fontSize:14, fontWeight:active?700:500, ...F, transition:"all .2s",
    background:active?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"transparent",
    color:active?"#fff":"#64748b", outline:active?"none":"1px solid #334155",
  });
  const GAP = { display:"flex", flexDirection:"column", gap:14 };

  return (
    <div style={{ minHeight:"100vh", background:BG, ...F, color:"#f1f5f9", padding:"20px 16px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
      <div style={{ maxWidth:860, margin:"0 auto 20px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
          <div>
            <div style={{ fontSize:10, letterSpacing:4, color:"#64748b", textTransform:"uppercase" }}>ระบบบันทึกการลา</div>
            <h1 style={{ fontSize:22, fontWeight:800, margin:"2px 0 0",
              background:"linear-gradient(90deg,#38bdf8,#818cf8)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              Pharmacy Leave Tracker
            </h1>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {saving && <span style={{ fontSize:11, color:"#64748b" }}>💾 กำลังบันทึก…</span>}
            <div style={{ display:"flex", alignItems:"center", gap:10, background:"#1e293b",
              borderRadius:20, padding:"6px 14px", border:"1px solid #334155" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:isAdmin?"#10b981":"#64748b" }}/>
              <span style={{ fontSize:12, color:"#94a3b8" }}>{acct.username}</span>
              <button onClick={()=>setAcct(null)} style={{ fontSize:11, padding:"3px 10px", borderRadius:6,
                border:"1px solid #334155", background:"transparent", color:"#ef4444", cursor:"pointer", ...F }}>ออก</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:860, margin:"0 auto" }}>
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          <button onClick={()=>setTab("overview")} style={tabStyle(tab==="overview")}>🗓 ภาพรวม</button>
          <button onClick={()=>setTab("record")} style={tabStyle(tab==="record")}>
            {isAdmin?"✏️ บันทึกการลา":"📅 ปฏิทินรายคน"}
          </button>
        </div>

        {tab==="overview" && (
          <div style={GAP}>
            {pharmas.some(p=>p.leaves[TODAY_STR]) && (
              <Card style={{ padding:"12px 18px", border:"1px solid #f59e0b55" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#f59e0b", marginBottom:8 }}>🔔 ลาวันนี้</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                  {pharmas.filter(p=>p.leaves[TODAY_STR]).map(p=>(
                    <div key={p.id} style={{ display:"flex", alignItems:"center", gap:6,
                      background:"#0f172a", borderRadius:8, padding:"6px 12px",
                      border:`1px solid ${LT[p.leaves[TODAY_STR]].color}44` }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", background:LT[p.leaves[TODAY_STR]].color }}/>
                      <span style={{ fontSize:13 }}>{p.name}</span>
                      <span style={{ fontSize:11, color:LT[p.leaves[TODAY_STR]].color, fontWeight:600 }}>{LT[p.leaves[TODAY_STR]].label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <CalGrid pharmas={pharmas} selected={null}
              viewMonth={viewMonth} viewYear={viewYear}
              setViewMonth={setViewMonth} setViewYear={setViewYear}
              isAdmin={isAdmin} activeLT={activeLT} setActiveLT={setActiveLT} onToggle={null}/>
            <MonthlySummary pharmas={pharmas} viewMonth={viewMonth} viewYear={viewYear}/>
          </div>
        )}

        {tab==="record" && (
          <div style={GAP}>
            {!isAdmin && (
              <Card style={{ padding:"10px 16px", border:"1px solid #334155" }}>
                <span style={{ fontSize:12, color:"#64748b" }}>👁 คุณอยู่ในโหมด <strong style={{ color:"#94a3b8" }}>ดูอย่างเดียว</strong></span>
              </Card>
            )}
            <PersonPicker pharmas={pharmas} selId={selId} setSelId={setSelId}
              isAdmin={isAdmin} onAdd={addP} onRemove={removeP}/>
            <CyclePicker viewCycle={viewCycle} setViewCycle={setViewCycle}/>
            {sel && <LeaveSummary p={sel} viewCycle={viewCycle} isAdmin={isAdmin} onCarryover={updateCarryover}/>}
            <CalGrid pharmas={pharmas} selected={sel}
              viewMonth={viewMonth} viewYear={viewYear}
              setViewMonth={setViewMonth} setViewYear={setViewYear}
              isAdmin={isAdmin} activeLT={activeLT} setActiveLT={setActiveLT} onToggle={toggleLeave}/>
            <MonthlySummary pharmas={pharmas} viewMonth={viewMonth} viewYear={viewYear}/>
          </div>
        )}
      </div>
    </div>
  );
}
