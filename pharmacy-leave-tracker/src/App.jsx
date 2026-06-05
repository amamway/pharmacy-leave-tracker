import { useState, useMemo, useEffect } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

// ─── constants ────────────────────────────────────────────────────────────────
const LT = {
  sick:           { label:"ลาป่วย (เต็มวัน)",      short:"ป่วย",       color:"#ef4444", days:1   },
  sick_half:      { label:"ลาป่วย (ครึ่งวัน)",     short:"ป่วย ½",     color:"#fca5a5", days:0.5 },
  personal:       { label:"ลากิจ (เต็มวัน)",       short:"กิจ",        color:"#f59e0b", days:1   },
  personal_half:  { label:"ลากิจ (ครึ่งวัน)",      short:"กิจ ½",      color:"#fcd34d", days:0.5 },
  vacation:       { label:"ลาพักผ่อน (เต็มวัน)",   short:"พักผ่อน",   color:"#3b82f6", days:1   },
  vacation_half:  { label:"ลาพักผ่อน (ครึ่งวัน)",  short:"พักผ่อน½",  color:"#93c5fd", days:0.5 },
  maternity:      { label:"ลาคลอด (เต็มวัน)",      short:"คลอด",       color:"#ec4899", days:1   },
  maternity_half: { label:"ลาคลอด (ครึ่งวัน)",     short:"คลอด ½",     color:"#f9a8d4", days:0.5 },
};
const LT_GROUPS = [
  { key:"sick",      full:"sick",      half:"sick_half",      label:"ลาป่วย",     color:"#ef4444" },
  { key:"personal",  full:"personal",  half:"personal_half",  label:"ลากิจ",      color:"#f59e0b" },
  { key:"vacation",  full:"vacation",  half:"vacation_half",  label:"ลาพักผ่อน", color:"#3b82f6" },
  { key:"maternity", full:"maternity", half:"maternity_half", label:"ลาคลอด",    color:"#ec4899" },
];
const DAYS_TH   = ["อา","จ","อ","พ","พฤ","ศ","ส"];
const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const today     = new Date();
const TODAY_STR = today.toISOString().split("T")[0];
const CY        = today.getFullYear();
const AVC       = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ec4899","#8b5cf6","#14b8a6","#f97316"];
const ACCOUNTS  = [
  { username:"admin",  password:"0000", role:"admin"  },
  { username:"member", password:"1234", role:"viewer" },
];

// ─── helpers ──────────────────────────────────────────────────────────────────
let _id = Date.now();
const uid     = () => _id++;
const mkP     = n => ({ id: uid(), name: n, carryover: {}, leaves: {} });
const avc     = id => AVC[id % AVC.length];
const dim     = (y,m) => new Date(y,m+1,0).getDate();
const fd      = (y,m) => new Date(y,m,1).getDay();
const ds      = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
const usedN   = (p,t,y) => Object.entries(p.leaves).filter(([d,v])=>v===t&&d.startsWith(String(y))).length;
const groupDays = (p,grp,y) => {
  const g = LT_GROUPS.find(x=>x.key===grp); if(!g) return 0;
  return usedN(p,g.full,y) + usedN(p,g.half,y)*0.5;
};
const vacDaysUsed = (p,y) => groupDays(p,"vacation",y);
const fmtDays = n => Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`;
const getCarry = (p,year) => {
  const raw = p.carryover && p.carryover[year];
  if (!raw && raw !== 0) return { whole:0, half:0 };
  if (typeof raw === "object") return { whole:raw.whole||0, half:raw.half||0 };
  return { whole:raw, half:0 };
};
const carryDays = c => c.whole + c.half*0.5;
const mkCells = (y,m) => {
  const c=[]; for(let i=0;i<fd(y,m);i++) c.push(null);
  for(let d=1;d<=dim(y,m);d++) c.push(d); return c;
};

const INIT_PHARMAS = [mkP("ภก.สมชาย"), mkP("ภญ.สุดา"), mkP("ภญ.มาลี")];
const F  = { fontFamily:"'Sarabun','Noto Sans Thai',sans-serif" };
const BG = "linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%)";

// ─── shared micro-components ─────────────────────────────────────────────────
const Card = ({ children, style={} }) => (
  <div style={{ background:"#1e293b", borderRadius:14, padding:20,
    border:"1px solid #334155", ...style }}>{children}</div>
);
const SectionTitle = ({ children }) => (
  <div style={{ fontSize:11, fontWeight:700, color:"#64748b",
    letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>{children}</div>
);

// ─── Tooltip (desktop hover + mobile bottom sheet) ───────────────────────────
function Tooltip({ data, onClose }) {
  const isMobile = window.matchMedia("(pointer:coarse)").matches;
  if (!data) return null;
  const { dateStr, arr, x, y } = data;
  const d = new Date(dateStr+"T00:00:00");
  const label = `${d.getDate()} ${MONTHS_TH[d.getMonth()]} ${d.getFullYear()+543}`;
  const content = (
    <>
      <div style={{ fontSize:11, color:"#64748b", marginBottom:8, fontWeight:600 }}>{label}</div>
      {arr.map((x,j) => (
        <div key={j} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:7 }}>
          <div style={{ width:9, height:9, borderRadius:"50%", background:x.color, flexShrink:0, boxShadow:`0 0 5px ${x.color}99` }}/>
          <span style={{ fontSize:13, fontWeight:600, color:"#e2e8f0" }}>{x.name}</span>
          <span style={{ fontSize:11, color:x.color, background:x.color+"22", padding:"2px 8px", borderRadius:5, marginLeft:"auto", whiteSpace:"nowrap" }}>{LT[x.t].label}</span>
        </div>
      ))}
    </>
  );

  if (isMobile) return (
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9998, background:"rgba(0,0,0,.55)", backdropFilter:"blur(2px)" }}/>
      <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:9999, background:"#1e293b",
        borderTop:"1px solid #334155", borderRadius:"20px 20px 0 0", padding:"20px 20px 32px" }}>
        <div style={{ width:36, height:4, background:"#334155", borderRadius:2, margin:"0 auto 16px" }}/>
        {content}
      </div>
    </>
  );

  return (
    <div style={{ position:"fixed", left:x, top:y, zIndex:9999, pointerEvents:"none",
      background:"#0f172a", border:"1px solid #334155", borderRadius:12,
      padding:"10px 14px", minWidth:160, maxWidth:240,
      boxShadow:"0 12px 32px #00000099" }}>
      {content}
    </div>
  );
}

// ─── Person Picker ────────────────────────────────────────────────────────────
function PersonPicker({ pharmacists, selectedId, setSelectedId, isAdmin, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [name,   setName]   = useState("");
  function add() {
    if (!name.trim()) return;
    onAdd(name.trim()); setName(""); setAdding(false);
  }
  return (
    <Card>
      <SectionTitle>ชื่อเภสัชกร</SectionTitle>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {pharmacists.map(p => {
          const sel = p.id === selectedId;
          return (
            <div key={p.id} style={{ display:"inline-flex", alignItems:"center", gap:4,
              padding:"5px 10px", borderRadius:20, cursor:"pointer",
              background:sel?avc(p.id):"#0f172a", border:sel?"none":"1px solid #334155", transition:"all .15s" }}
              onClick={()=>setSelectedId(p.id)}>
              <span style={{ fontSize:12, fontWeight:sel?700:400, color:sel?"#fff":"#94a3b8", whiteSpace:"nowrap" }}>{p.name}</span>
              {isAdmin && !sel && (
                <span onClick={e=>{e.stopPropagation();onRemove(p.id);}}
                  style={{ fontSize:10, color:"#ef4444", opacity:.7, lineHeight:1, marginLeft:2 }}>✕</span>
              )}
            </div>
          );
        })}
        {isAdmin && (adding ? (
          <div style={{ display:"flex", gap:5, alignItems:"center" }}>
            <input autoFocus value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")add();if(e.key==="Escape")setAdding(false);}}
              placeholder="ชื่อ…" style={{ padding:"5px 10px", borderRadius:20, border:"1px solid #3b82f6",
                background:"#0f172a", color:"#f1f5f9", fontSize:12, outline:"none", width:120, ...F }}/>
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

// ─── Leave Summary ────────────────────────────────────────────────────────────
function LeaveSummary({ p, year, isAdmin, onCarryover, onSaveNextYear }) {
  const carry    = getCarry(p, year);
  const carryVal = carryDays(carry);
  const vacBase  = 10;
  const vacTotal = vacBase + carryVal;
  const vacUsed  = vacDaysUsed(p, year);
  const vacRem   = vacTotal - vacUsed;
  const remWhole = Math.max(0, Math.floor(vacRem));
  const remHalf  = vacRem - remWhole >= 0.5 ? 1 : 0;
  const isCurrentYear = year === CY;
  const pct = vacTotal > 0 ? Math.min(100,(vacUsed/vacTotal)*100) : 0;

  return (
    <Card>
      <SectionTitle>สรุปการลา · {p.name} · ปี {year+543}</SectionTitle>
      <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
        {["sick","personal","maternity"].map(grpKey => {
          const g    = LT_GROUPS.find(x=>x.key===grpKey);
          const full = usedN(p,g.full,year);
          const half = usedN(p,g.half,year);
          const tot  = full + half*0.5;
          return (
            <div key={grpKey} style={{ flex:1, minWidth:90, background:"#0f172a",
              borderRadius:10, padding:"10px 12px", border:`1px solid ${g.color}33` }}>
              <div style={{ fontSize:10, color:g.color, fontWeight:700, marginBottom:6 }}>{g.label}</div>
              <div style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", lineHeight:1 }}>{fmtDays(tot)}</div>
              <div style={{ fontSize:9, color:"#475569", marginTop:3 }}>วัน</div>
              {(full>0||half>0) && (
                <div style={{ display:"flex", gap:5, marginTop:5, flexWrap:"wrap" }}>
                  {full>0 && <span style={{ fontSize:9, color:LT[g.full].color, background:LT[g.full].color+"22", padding:"1px 5px", borderRadius:4 }}>เต็ม {full}</span>}
                  {half>0 && <span style={{ fontSize:9, color:LT[g.half].color, background:LT[g.half].color+"22", padding:"1px 5px", borderRadius:4 }}>ครึ่ง {half}</span>}
                </div>
              )}
            </div>
          );
        })}

        {/* vacation card */}
        <div style={{ flex:2, minWidth:220, background:"#0f172a",
          borderRadius:10, padding:"12px 14px", border:`1px solid ${LT.vacation.color}44` }}>
          <div style={{ fontSize:10, color:LT.vacation.color, fontWeight:700, marginBottom:10 }}>🏖 ลาพักผ่อน</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>ปีนี้</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>{vacBase}</div>
              <div style={{ fontSize:9, color:"#475569" }}>วัน</div>
            </div>
            <div style={{ color:"#334155", fontSize:14, paddingBottom:6 }}>+</div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>วันลาทบ</div>
              {isAdmin && isCurrentYear ? (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <select value={carry.whole}
                      onChange={e=>onCarryover(year,{whole:parseInt(e.target.value),half:carry.half})}
                      style={{ borderRadius:6, border:"1px solid #475569", background:"#0f172a", color:"#38bdf8",
                        fontSize:14, fontWeight:700, outline:"none", padding:"2px 6px", textAlign:"center", ...F }}>
                      {Array.from({length:31},(_,i)=><option key={i} value={i}>{i}</option>)}
                    </select>
                    <span style={{ fontSize:10, color:"#64748b" }}>วัน</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                    <select value={carry.half}
                      onChange={e=>onCarryover(year,{whole:carry.whole,half:parseInt(e.target.value)})}
                      style={{ borderRadius:6, border:"1px solid #475569", background:"#0f172a", color:"#38bdf8",
                        fontSize:13, fontWeight:700, outline:"none", padding:"2px 6px", textAlign:"center", ...F }}>
                      <option value={0}>+ 0</option>
                      <option value={1}>+ ½</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize:18, fontWeight:800, color:"#38bdf8" }}>{fmtDays(carryVal)}</div>
              )}
              <div style={{ fontSize:9, color:"#475569", marginTop:2 }}>วัน</div>
            </div>
            <div style={{ color:"#334155", fontSize:14, paddingBottom:6 }}>=</div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>รวม</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>{fmtDays(vacTotal)}</div>
              <div style={{ fontSize:9, color:"#475569" }}>วัน</div>
            </div>
            <div style={{ flex:1, minWidth:100 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:3 }}>
                <span style={{ color:"#64748b" }}>ใช้ <b style={{ color:LT.vacation.color }}>{fmtDays(vacUsed)}</b></span>
                <span style={{ color:"#64748b" }}>เหลือ <b style={{ color:vacRem<3?"#ef4444":"#10b981" }}>{fmtDays(vacRem)}</b></span>
              </div>
              <div style={{ height:5, background:"#1e293b", borderRadius:5, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:5, width:`${pct}%`,
                  background:vacRem<3?"#ef4444":LT.vacation.color, transition:"width .3s" }}/>
              </div>
              <div style={{ display:"flex", gap:8, marginTop:4 }}>
                <span style={{ fontSize:9, color:LT.vacation.color }}>เต็ม {usedN(p,"vacation",year)}</span>
                <span style={{ fontSize:9, color:LT.vacation_half.color }}>ครึ่ง {usedN(p,"vacation_half",year)}</span>
              </div>
            </div>
          </div>

          {/* ทบปีหน้า */}
          <div style={{ marginTop:12, padding:"8px 12px", borderRadius:8, background:"#172554",
            border:"1px solid #1e3a8a", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, color:"#93c5fd" }}>🔄 ทบปี {year+1+543}:</span>
            <span style={{ fontSize:13, fontWeight:700, color:vacRem<=0?"#ef4444":"#34d399" }}>
              {vacRem<=0?"0":fmtDays(vacRem)} วัน
            </span>
            <span style={{ fontSize:10, color:"#475569" }}>({remWhole} เต็ม{remHalf?" + ½":""})</span>
            {isAdmin && vacRem > 0 && (
              <button onClick={()=>onSaveNextYear(year,remWhole,remHalf)}
                style={{ marginLeft:"auto", padding:"3px 10px", borderRadius:6, border:"none",
                  background:"#1d4ed8", color:"#fff", fontSize:11, cursor:"pointer", fontWeight:600, ...F }}>
                บันทึกทบปีหน้า ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Year Picker ──────────────────────────────────────────────────────────────
function YearPicker({ viewYear, setViewYear }) {
  const [open, setOpen] = useState(false);
  const yrs = []; for(let y=CY-5;y<=CY+5;y++) yrs.push(y);
  return (
    <Card style={{ padding:"12px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:1, whiteSpace:"nowrap" }}>ปี</div>
        <div style={{ position:"relative" }}>
          <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer",
            background:"#0f172a", borderRadius:9, padding:"7px 14px",
            border:`1px solid ${open?"#3b82f6":"#334155"}`, minWidth:130, userSelect:"none" }}>
            <span style={{ fontSize:14, fontWeight:700, color:"#f1f5f9", flex:1 }}>พ.ศ. {viewYear+543}</span>
            <span style={{ fontSize:11, color:"#475569", transform:open?"rotate(180deg)":"rotate(0)", transition:"transform .2s", display:"inline-block" }}>▾</span>
          </div>
          {open && (
            <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:50,
              background:"#0f172a", border:"1px solid #334155", borderRadius:12,
              boxShadow:"0 12px 32px #00000099", maxHeight:220, overflowY:"auto", minWidth:150 }}>
              {yrs.map(y=>(
                <div key={y} onClick={()=>{setViewYear(y);setOpen(false);}}
                  style={{ padding:"9px 16px", cursor:"pointer", fontSize:13,
                    fontWeight:y===viewYear?700:400, color:y===viewYear?"#38bdf8":"#94a3b8",
                    background:y===viewYear?"#1e293b":"transparent", borderBottom:"1px solid #1e293b44" }}
                  onMouseEnter={e=>{if(y!==viewYear)e.currentTarget.style.background="#1e293b";}}
                  onMouseLeave={e=>{if(y!==viewYear)e.currentTarget.style.background="transparent";}}>
                  พ.ศ. {y+543}
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={()=>setViewYear(y=>y-1)} style={{ background:"#0f172a", border:"1px solid #334155",
          color:"#94a3b8", borderRadius:8, width:32, height:32, cursor:"pointer",
          fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
        <button onClick={()=>setViewYear(y=>y+1)} style={{ background:"#0f172a", border:"1px solid #334155",
          color:"#94a3b8", borderRadius:8, width:32, height:32, cursor:"pointer",
          fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
      </div>
    </Card>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────────
function CalGrid({ pharmacists, selected, viewMonth, viewYear, setViewMonth, setViewYear,
                   isAdmin, activeLeaveType, setActiveLeaveType, onToggle }) {
  const [tooltip, setTooltip] = useState(null);
  const cls = useMemo(()=>mkCells(viewYear,viewMonth),[viewYear,viewMonth]);
  const leaveMap = useMemo(()=>{
    const m={};
    pharmacists.forEach(p=>{
      Object.entries(p.leaves).forEach(([d,t])=>{
        if(!m[d]) m[d]=[];
        m[d].push({name:p.name,id:p.id,t,color:LT[t].color});
      });
    });
    return m;
  },[pharmacists]);

  const isSingle = !!selected;
  function prevM(){ if(viewMonth===0){setViewMonth(11);setViewYear(y=>y-1);}else setViewMonth(m=>m-1); }
  function nextM(){ if(viewMonth===11){setViewMonth(0);setViewYear(y=>y+1);}else setViewMonth(m=>m+1); }

  const isMobile = window.matchMedia("(pointer:coarse)").matches;

  function handleEnter(e, dateStr, arr) {
    if(!arr||arr.length===0||isMobile) return;
    const vw=window.innerWidth, vh=window.innerHeight;
    const tw=220, th=Math.min(200,arr.length*40+40);
    let x=e.clientX+14, y=e.clientY-20;
    if(x+tw>vw-10) x=e.clientX-tw-14;
    if(y+th>vh-10) y=vh-th-10;
    if(y<8) y=8;
    setTooltip({dateStr,arr,x,y});
  }
  function handleTouch(dateStr, arr) {
    if(!arr||arr.length===0) return;
    setTooltip({dateStr,arr,x:0,y:0});
  }

  return (
    <>
      <Tooltip data={tooltip} onClose={()=>setTooltip(null)}/>
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
          <button onClick={prevM} style={{ background:"none",border:"none",color:"#64748b",fontSize:22,cursor:"pointer",padding:"4px 8px" }}>‹</button>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontWeight:700, fontSize:16 }}>{MONTHS_TH[viewMonth]} {viewYear+543}</div>
            <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>
              {isSingle ? selected.name : "ปฏิทินรวม · ทุกคน"}
            </div>
          </div>
          <button onClick={nextM} style={{ background:"none",border:"none",color:"#64748b",fontSize:22,cursor:"pointer",padding:"4px 8px" }}>›</button>
        </div>

        {isSingle && isAdmin && (
          <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
            {Object.entries(LT).map(([key,lt])=>(
              <button key={key} onClick={()=>setActiveLeaveType(key)} style={{
                padding:"6px 12px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, ...F,
                background:activeLeaveType===key?lt.color:"#0f172a",
                color:activeLeaveType===key?"#fff":"#94a3b8",
                fontWeight:activeLeaveType===key?700:400,
                boxShadow:activeLeaveType===key?`0 0 10px ${lt.color}55`:"none" }}>
                {lt.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:4 }}>
          {DAYS_TH.map(d=>(
            <div key={d} style={{ textAlign:"center",fontSize:11,color:"#475569",fontWeight:700,padding:"3px 0" }}>{d}</div>
          ))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
          {cls.map((day,i)=>{
            if(!day) return <div key={`e${i}`}/>;
            const dateStr = ds(viewYear,viewMonth,day);
            const isToday = dateStr===TODAY_STR;

            if(isSingle){
              const lt = selected.leaves[dateStr] ? LT[selected.leaves[dateStr]] : null;
              return (
                <div key={day} onClick={()=>onToggle&&onToggle(dateStr)} style={{
                  aspectRatio:"1", borderRadius:8, display:"flex", flexDirection:"column",
                  alignItems:"center", justifyContent:"center",
                  cursor:isAdmin?"pointer":"default",
                  background:lt?lt.color:isToday?"#172554":"#0f172a",
                  border:isToday&&!lt?"1px solid #3b82f6":"1px solid transparent",
                  transition:"all .15s", opacity:!isAdmin&&!lt?0.75:1 }}>
                  <span style={{ fontSize:13, fontWeight:isToday?700:400, color:lt?"#fff":"#cbd5e1" }}>{day}</span>
                  {lt&&<span style={{ fontSize:9, color:"rgba(255,255,255,.85)", marginTop:1 }}>{lt.short}</span>}
                </div>
              );
            } else {
              const arr = leaveMap[dateStr]||[];
              const heat = arr.length===0?0:arr.length===1?1:arr.length<=3?2:3;
              const hBg  = ["#0f172a","#1e3a5f","#1e3a8a","#1e1b4b"][heat];
              const hBd  = ["transparent","#3b82f6","#6366f1","#a855f7"][heat];
              return (
                <div key={day}
                  onMouseEnter={e=>handleEnter(e,dateStr,arr)}
                  onMouseLeave={()=>setTooltip(null)}
                  onTouchStart={()=>handleTouch(dateStr,arr)}
                  style={{ borderRadius:9, padding:"4px 3px 3px", minHeight:52,
                    background:isToday&&heat===0?"#172554":hBg,
                    border:`1px solid ${isToday&&heat===0?"#3b82f6":hBd}`,
                    cursor:arr.length>0?"pointer":"default", position:"relative",
                    transition:"transform .12s" }}
                  onMouseOver={e=>{if(arr.length>0)e.currentTarget.style.transform="scale(1.05)";}}
                  onMouseOut={e=>{e.currentTarget.style.transform="scale(1)";}}>
                  <div style={{ fontSize:12, fontWeight:isToday?700:400,
                    color:isToday?"#38bdf8":"#cbd5e1", marginBottom:2 }}>{day}</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
                    {arr.slice(0,6).map((x,j)=>(
                      <div key={j} style={{ width:6,height:6,borderRadius:"50%",
                        background:x.color, boxShadow:`0 0 3px ${x.color}99` }}/>
                    ))}
                    {arr.length>6&&<span style={{ fontSize:8,color:"#94a3b8",lineHeight:"6px" }}>+{arr.length-6}</span>}
                  </div>
                </div>
              );
            }
          })}
        </div>

        {!isSingle && (
          <div style={{ display:"flex", gap:12, marginTop:12, flexWrap:"wrap", alignItems:"center" }}>
            <span style={{ fontSize:11,color:"#475569" }}>ความเข้มสี:</span>
            {[["1 คน","#1e3a5f","#3b82f6"],["2–3 คน","#1e3a8a","#6366f1"],["4+ คน","#1e1b4b","#a855f7"]].map(([l,bg,bd])=>(
              <div key={l} style={{ display:"flex",alignItems:"center",gap:4 }}>
                <div style={{ width:12,height:12,borderRadius:3,background:bg,border:`1px solid ${bd}` }}/>
                <span style={{ fontSize:11,color:"#94a3b8" }}>{l}</span>
              </div>
            ))}
          </div>
        )}
        {isSingle && isAdmin && (
          <div style={{ marginTop:12, fontSize:11, color:"#475569", textAlign:"center" }}>
            คลิกที่วันเพื่อบันทึก · คลิกซ้ำเพื่อยกเลิก
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Monthly Summary ──────────────────────────────────────────────────────────
function MonthlySummary({ pharmacists, viewMonth, viewYear }) {
  const pfx = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}`;
  return (
    <Card>
      <SectionTitle>สรุปรายคนประจำเดือน {MONTHS_TH[viewMonth]} {viewYear+543}</SectionTitle>
      {pharmacists.map(p=>{
        const groups = LT_GROUPS.map(g=>{
          const full = Object.entries(p.leaves).filter(([d,v])=>v===g.full&&d.startsWith(pfx)).length;
          const half = Object.entries(p.leaves).filter(([d,v])=>v===g.half&&d.startsWith(pfx)).length;
          const days = full+half*0.5;
          return{g,full,half,days};
        }).filter(x=>x.days>0);
        const totalDays = groups.reduce((s,x)=>s+x.days,0);
        return (
          <div key={p.id} style={{ display:"flex",alignItems:"center",gap:12,
            padding:"9px 12px",borderRadius:10,background:"#0f172a",marginBottom:7 }}>
            <div style={{ width:30,height:30,borderRadius:"50%",background:avc(p.id),
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:12,fontWeight:700,color:"#fff",flexShrink:0 }}>
              {p.name.replace(/ภก\.|ภญ\./,"")[0]}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13,fontWeight:600 }}>{p.name}</div>
              {groups.length>0
                ?<div style={{ display:"flex",gap:5,marginTop:3,flexWrap:"wrap" }}>
                    {groups.map(({g,days})=>(
                      <span key={g.key} style={{ fontSize:11,color:g.color,
                        background:g.color+"22",padding:"1px 7px",borderRadius:5,fontWeight:600 }}>
                        {g.label} {fmtDays(days)}
                      </span>
                    ))}
                  </div>
                :<div style={{ fontSize:11,color:"#475569",marginTop:2 }}>ไม่มีการลา</div>
              }
            </div>
            {totalDays>0&&(
              <div style={{ fontSize:18,fontWeight:800,color:"#f1f5f9",whiteSpace:"nowrap" }}>
                {fmtDays(totalDays)}<span style={{ fontSize:11,color:"#475569",fontWeight:400 }}> วัน</span>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
function Login({ onLogin }) {
  const [u,setU]=useState(""); const [pw,setPw]=useState("");
  const [err,setErr]=useState(""); const [drop,setDrop]=useState(false);
  function go() {
    const a=ACCOUNTS.find(a=>a.username===u&&a.password===pw);
    a?onLogin(a):setErr("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  }
  return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:BG,...F }}>
      <div style={{ width:340,background:"#1e293b",borderRadius:20,padding:"36px 32px",
        border:"1px solid #334155",boxShadow:"0 24px 60px #00000099" }}>
        <div style={{ textAlign:"center",marginBottom:28 }}>
          <div style={{ fontSize:40,marginBottom:8 }}>💊</div>
          <h2 style={{ margin:0,fontSize:20,fontWeight:800,color:"#f1f5f9" }}>Pharmacy Leave Tracker</h2>
          <p style={{ margin:"6px 0 0",fontSize:12,color:"#64748b" }}>กรุณาเข้าสู่ระบบ</p>
        </div>
        <label style={{ fontSize:12,color:"#94a3b8",display:"block",marginBottom:5 }}>ชื่อผู้ใช้</label>
        <div style={{ position:"relative",marginBottom:14 }}>
          <div onClick={()=>setDrop(d=>!d)} style={{ padding:"10px 12px",borderRadius:9,
            border:`1px solid ${drop?"#3b82f6":"#334155"}`,background:"#0f172a",
            color:u?"#f1f5f9":"#475569",fontSize:14,cursor:"pointer",
            display:"flex",justifyContent:"space-between",alignItems:"center",userSelect:"none" }}>
            <span>{u||"เลือกชื่อผู้ใช้…"}</span>
            <span style={{ fontSize:11,color:"#475569",display:"inline-block",
              transform:drop?"rotate(180deg)":"rotate(0)",transition:"transform .2s" }}>▾</span>
          </div>
          {drop&&(
            <div style={{ position:"absolute",top:"calc(100% + 6px)",left:0,right:0,zIndex:50,
              background:"#0f172a",border:"1px solid #334155",borderRadius:12,
              boxShadow:"0 12px 32px #00000099",overflow:"hidden" }}>
              {ACCOUNTS.map(a=>(
                <div key={a.username} onClick={()=>{setU(a.username);setErr("");setDrop(false);}}
                  style={{ padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",
                    gap:12,borderBottom:"1px solid #1e293b" }}
                  onMouseEnter={e=>e.currentTarget.style.background="#1e293b"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{ width:36,height:36,borderRadius:"50%",flexShrink:0,
                    background:a.role==="admin"?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"linear-gradient(135deg,#0f766e,#0ea5e9)",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:16 }}>
                    {a.role==="admin"?"🔑":"👁"}
                  </div>
                  <span style={{ fontSize:14,fontWeight:700,color:"#f1f5f9" }}>{a.username}</span>
                  {u===a.username&&<span style={{ marginLeft:"auto",color:"#3b82f6",fontSize:16 }}>✓</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <label style={{ fontSize:12,color:"#94a3b8",display:"block",marginBottom:5 }}>รหัสผ่าน</label>
        <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr("");}}
          onKeyDown={e=>e.key==="Enter"&&go()} placeholder="••••"
          style={{ width:"100%",padding:"10px 12px",borderRadius:9,border:"1px solid #334155",
            background:"#0f172a",color:"#f1f5f9",fontSize:18,letterSpacing:4,
            boxSizing:"border-box",marginBottom:20,outline:"none",...F }}/>
        {err&&<div style={{ fontSize:12,color:"#ef4444",marginBottom:12,textAlign:"center",
          background:"#ef444411",borderRadius:8,padding:"8px 12px" }}>{err}</div>}
        <button onClick={go} style={{ width:"100%",padding:12,borderRadius:10,border:"none",
          background:u?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"#1e293b",
          color:u?"#fff":"#475569",fontSize:15,fontWeight:700,
          cursor:u?"pointer":"not-allowed",...F }}>เข้าสู่ระบบ</button>
      </div>
    </div>
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
  const [activeLT,  setActiveLT]  = useState("sick");
  const [tab,       setTab]       = useState("overview");
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  // ── Load & sync from Firestore ─────────────────────────────────────────────
  useEffect(() => {
    const ref = doc(db, "data", "pharmacists");
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const list = snap.data().list || [];
        setPharmas(list);
        setSelId(prev => (prev && list.find(p=>p.id===prev)) ? prev : (list[0]?.id||null));
      } else {
        saveToFirestore(INIT_PHARMAS);
        setPharmas(INIT_PHARMAS);
        setSelId(INIT_PHARMAS[0].id);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function saveToFirestore(list) {
    setSaving(true);
    try { await setDoc(doc(db,"data","pharmacists"),{list}); }
    catch(e) { console.error("Save error:",e); }
    setSaving(false);
  }
  function updatePharmas(newList) { setPharmas(newList); saveToFirestore(newList); }

  if (!acct) return <Login onLogin={setAcct}/>;
  if (loading) return (
    <div style={{ minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",...F }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40,marginBottom:16 }}>💊</div>
        <div style={{ color:"#64748b",fontSize:14 }}>กำลังโหลดข้อมูล…</div>
      </div>
    </div>
  );

  const isAdmin = acct.role === "admin";
  const sel     = pharmas.find(p=>p.id===selId) || pharmas[0];
  const nowLeaving = pharmas.flatMap(p=>p.leaves[TODAY_STR]?[{name:p.name,id:p.id,t:p.leaves[TODAY_STR]}]:[]);

  function addP(name) {
    const p=mkP(name); const next=[...pharmas,p];
    updatePharmas(next); setSelId(p.id);
  }
  function removeP(id) {
    const rest=pharmas.filter(p=>p.id!==id);
    updatePharmas(rest);
    if(selId===id&&rest.length)setSelId(rest[0].id);
  }
  function toggleLeave(dateStr) {
    if(!isAdmin)return;
    const next=pharmas.map(p=>{
      if(p.id!==selId)return p;
      const lv={...p.leaves};
      lv[dateStr]===activeLT?delete lv[dateStr]:(lv[dateStr]=activeLT);
      return{...p,leaves:lv};
    });
    updatePharmas(next);
  }
  function updateCarryover(year, val) {
    const next=pharmas.map(p=>p.id!==selId?p:{...p,carryover:{...p.carryover,[year]:val}});
    updatePharmas(next);
  }
  function saveNextYearCarry(year, whole, half) {
    const next=pharmas.map(p=>p.id!==selId?p:{...p,carryover:{...p.carryover,[year+1]:{whole,half}}});
    updatePharmas(next);
    alert(`บันทึกวันลาทบปี ${year+1+543}: ${whole}${half?" ½":""} วัน ✓`);
  }

  const tabStyle = active => ({
    padding:"10px 22px",borderRadius:10,border:"none",cursor:"pointer",
    fontSize:14,fontWeight:active?700:500,...F,transition:"all .2s",
    background:active?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"transparent",
    color:active?"#fff":"#64748b",outline:active?"none":"1px solid #334155",
  });
  const GAP = { display:"flex",flexDirection:"column",gap:14 };

  return (
    <div style={{ minHeight:"100vh",background:BG,...F,color:"#f1f5f9",padding:"20px 16px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
      <div style={{ maxWidth:860,margin:"0 auto 20px" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10 }}>
          <div>
            <div style={{ fontSize:10,letterSpacing:4,color:"#64748b",textTransform:"uppercase" }}>ระบบบันทึกการลา</div>
            <h1 style={{ fontSize:22,fontWeight:800,margin:"2px 0 0",
              background:"linear-gradient(90deg,#38bdf8,#818cf8)",
              WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent" }}>
              Pharmacy Leave Tracker
            </h1>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            {saving&&<span style={{ fontSize:11,color:"#64748b" }}>💾 กำลังบันทึก…</span>}
            <div style={{ display:"flex",alignItems:"center",gap:10,
              background:"#1e293b",borderRadius:20,padding:"6px 14px",border:"1px solid #334155" }}>
              <div style={{ width:8,height:8,borderRadius:"50%",background:isAdmin?"#10b981":"#64748b" }}/>
              <span style={{ fontSize:12,color:"#94a3b8" }}>{acct.username}</span>
              <button onClick={()=>setAcct(null)} style={{ fontSize:11,padding:"3px 10px",borderRadius:6,
                border:"1px solid #334155",background:"transparent",color:"#ef4444",cursor:"pointer",...F }}>ออก</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:860,margin:"0 auto" }}>
        <div style={{ display:"flex",gap:8,marginBottom:20 }}>
          <button onClick={()=>setTab("overview")} style={tabStyle(tab==="overview")}>🗓 ภาพรวม</button>
          <button onClick={()=>setTab("record")} style={tabStyle(tab==="record")}>
            {isAdmin?"✏️ บันทึกการลา":"📅 ปฏิทินรายคน"}
          </button>
        </div>

        {tab==="overview" && (
          <div style={GAP}>
            {nowLeaving.length>0&&(
              <Card style={{ padding:"12px 18px",border:"1px solid #f59e0b55" }}>
                <div style={{ fontSize:12,fontWeight:700,color:"#f59e0b",marginBottom:8 }}>🔔 ลาวันนี้</div>
                <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>
                  {nowLeaving.map((x,i)=>(
                    <div key={i} style={{ display:"flex",alignItems:"center",gap:6,
                      background:"#0f172a",borderRadius:8,padding:"6px 12px",border:`1px solid ${LT[x.t].color}44` }}>
                      <div style={{ width:6,height:6,borderRadius:"50%",background:LT[x.t].color }}/>
                      <span style={{ fontSize:13 }}>{x.name}</span>
                      <span style={{ fontSize:11,color:LT[x.t].color,fontWeight:600 }}>{LT[x.t].label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <YearPicker viewYear={viewYear} setViewYear={setViewYear}/>
            <CalGrid pharmacists={pharmas} selected={null}
              viewMonth={viewMonth} viewYear={viewYear}
              setViewMonth={setViewMonth} setViewYear={setViewYear}
              isAdmin={isAdmin} activeLeaveType={activeLT} setActiveLeaveType={setActiveLT}
              onToggle={null}/>
            <MonthlySummary pharmacists={pharmas} viewMonth={viewMonth} viewYear={viewYear}/>
          </div>
        )}

        {tab==="record" && (
          <div style={GAP}>
            {!isAdmin&&(
              <Card style={{ padding:"10px 16px",border:"1px solid #334155" }}>
                <span style={{ fontSize:12,color:"#64748b" }}>👁 คุณอยู่ในโหมด <strong style={{ color:"#94a3b8" }}>ดูอย่างเดียว</strong></span>
              </Card>
            )}
            <PersonPicker pharmacists={pharmas} selectedId={selId}
              setSelectedId={setSelId} isAdmin={isAdmin} onAdd={addP} onRemove={removeP}/>
            {sel&&<LeaveSummary p={sel} year={viewYear} isAdmin={isAdmin}
              onCarryover={updateCarryover} onSaveNextYear={saveNextYearCarry}/>}
            <YearPicker viewYear={viewYear} setViewYear={setViewYear}/>
            {sel&&<CalGrid pharmacists={pharmas} selected={sel}
              viewMonth={viewMonth} viewYear={viewYear}
              setViewMonth={setViewMonth} setViewYear={setViewYear}
              isAdmin={isAdmin} activeLeaveType={activeLT} setActiveLeaveType={setActiveLT}
              onToggle={toggleLeave}/>}
            <MonthlySummary pharmacists={pharmas} viewMonth={viewMonth} viewYear={viewYear}/>
          </div>
        )}
      </div>
    </div>
  );
}
