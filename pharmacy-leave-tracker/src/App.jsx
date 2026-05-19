import { useState, useMemo, useEffect } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

// ─── constants ────────────────────────────────────────────────────────────────
const LT = {
  sick:      { label:"ลาป่วย",     short:"ป่วย",    color:"#ef4444", limit:null },
  personal:  { label:"ลากิจ",      short:"กิจ",     color:"#f59e0b", limit:null },
  vacation:  { label:"ลาพักผ่อน", short:"พักร้อน", color:"#3b82f6", limit:10   },
  maternity: { label:"ลาคลอด",    short:"คลอด",    color:"#ec4899", limit:null },
};
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
const mkCells = (y,m) => {
  const c=[]; for(let i=0;i<fd(y,m);i++) c.push(null);
  for(let d=1;d<=dim(y,m);d++) c.push(d); return c;
};

const INIT_PHARMAS = [mkP("ภก.สมชาย"), mkP("ภญ.สุดา")];
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
            <div key={p.id} style={{ position:"relative", display:"inline-flex" }}>
              <div onClick={() => setSelectedId(p.id)} style={{
                display:"flex", alignItems:"center", gap:6,
                padding:"5px 10px", borderRadius:20, cursor:"pointer",
                background: sel ? avc(p.id) : "#0f172a",
                border: sel ? "none" : "1px solid #334155", transition:"all .15s",
              }}>
                <span style={{ fontSize:12, fontWeight:sel?700:400,
                  color:sel?"#fff":"#94a3b8", whiteSpace:"nowrap" }}>{p.name}</span>
                {isAdmin && !sel && (
                  <span onClick={e=>{ e.stopPropagation(); onRemove(p.id); }}
                    style={{ fontSize:10, color:"#ef4444", opacity:.7, lineHeight:1, marginLeft:2 }}>✕</span>
                )}
              </div>
            </div>
          );
        })}
        {isAdmin && (
          adding ? (
            <div style={{ display:"flex", gap:5, alignItems:"center" }}>
              <input autoFocus value={name} onChange={e=>setName(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") add(); if(e.key==="Escape") setAdding(false); }}
                placeholder="ชื่อ…"
                style={{ padding:"5px 10px", borderRadius:20, border:"1px solid #3b82f6",
                  background:"#0f172a", color:"#f1f5f9", fontSize:12, outline:"none", width:110, ...F }}/>
              <button onClick={add} style={{ padding:"5px 10px", borderRadius:20, border:"none",
                background:"#3b82f6", color:"#fff", fontSize:12, cursor:"pointer", ...F }}>+</button>
              <button onClick={()=>setAdding(false)} style={{ padding:"5px 10px", borderRadius:20,
                border:"1px solid #334155", background:"transparent", color:"#64748b",
                fontSize:12, cursor:"pointer", ...F }}>✕</button>
            </div>
          ) : (
            <div onClick={()=>setAdding(true)} style={{
              padding:"5px 12px", borderRadius:20, border:"1px dashed #475569",
              color:"#475569", fontSize:12, cursor:"pointer" }}>+ เพิ่ม</div>
          )
        )}
      </div>
    </Card>
  );
}

// ─── Leave Summary ────────────────────────────────────────────────────────────
function LeaveSummary({ p, year, isAdmin, showVacationDetail, onCarryover }) {
  const carry    = (p.carryover && p.carryover[year]) || 0;
  const vacTotal = 10 + carry;
  const vacUsed  = usedN(p, "vacation", year);
  const vacRem   = vacTotal - vacUsed;
  return (
    <Card>
      <SectionTitle>สรุปการลา · {p.name} · ปี {year+543}</SectionTitle>
      <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
        {["sick","personal","maternity"].map(key => {
          const lt = LT[key]; const n = usedN(p, key, year);
          return (
            <div key={key} style={{ flex:1, minWidth:80, background:"#0f172a",
              borderRadius:10, padding:"10px 12px", border:`1px solid ${lt.color}33` }}>
              <div style={{ fontSize:10, color:lt.color, fontWeight:700, marginBottom:4 }}>{lt.label}</div>
              <div style={{ fontSize:22, fontWeight:800, color:"#f1f5f9" }}>{n}</div>
              <div style={{ fontSize:10, color:"#475569" }}>วัน</div>
            </div>
          );
        })}
        <div style={{ flex:2, minWidth:180, background:"#0f172a",
          borderRadius:10, padding:"10px 14px", border:`1px solid ${LT.vacation.color}44` }}>
          <div style={{ fontSize:10, color:LT.vacation.color, fontWeight:700, marginBottom:8 }}>ลาพักผ่อน</div>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>ปีนี้</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>10</div>
              <div style={{ fontSize:9, color:"#475569" }}>วัน</div>
            </div>
            <div style={{ color:"#334155", fontSize:14 }}>+</div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>วันลาทบ</div>
              {showVacationDetail && isAdmin ? (
                <input type="number" min="0" value={carry}
                  onChange={e => onCarryover(year, e.target.value)}
                  style={{ width:44, padding:"2px 0", borderRadius:6, border:"1px solid #475569",
                    background:"transparent", color:"#38bdf8", fontSize:18, fontWeight:800,
                    textAlign:"center", outline:"none", ...F }}/>
              ) : (
                <div style={{ fontSize:18, fontWeight:800, color:"#38bdf8" }}>{carry}</div>
              )}
              <div style={{ fontSize:9, color:"#475569" }}>วัน</div>
            </div>
            <div style={{ color:"#334155", fontSize:14 }}>=</div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:9, color:"#64748b", marginBottom:2 }}>รวม</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>{vacTotal}</div>
              <div style={{ fontSize:9, color:"#475569" }}>วัน</div>
            </div>
            <div style={{ flex:1, minWidth:80 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:3 }}>
                <span style={{ color:"#64748b" }}>ใช้ <b style={{ color:LT.vacation.color }}>{vacUsed}</b></span>
                <span style={{ color:"#64748b" }}>เหลือ <b style={{ color:vacRem<3?"#ef4444":"#10b981" }}>{vacRem}</b></span>
              </div>
              <div style={{ height:5, background:"#1e293b", borderRadius:5, overflow:"hidden" }}>
                <div style={{ height:"100%", borderRadius:5,
                  width:`${Math.min(100,(vacUsed/vacTotal)*100)}%`,
                  background:vacRem<3?"#ef4444":LT.vacation.color, transition:"width .3s" }}/>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Year Picker ──────────────────────────────────────────────────────────────
function YearPicker({ viewYear, setViewYear }) {
  const [inp, setInp] = useState(false);
  const [val, setVal] = useState("");
  const yrs = []; for(let y=CY-5;y<=CY+5;y++) yrs.push(y);
  function jump() {
    const v=parseInt(val);
    if(!isNaN(v)&&v>1900&&v<2200) setViewYear(v>2500?v-543:v);
    setInp(false); setVal("");
  }
  const btn = (active, onClick, children, extra={}) => (
    <button onClick={onClick} style={{ padding:"5px 10px", borderRadius:8, border:"none", cursor:"pointer",
      fontSize:12, ...F, background:active?"#3b82f6":"#0f172a", color:active?"#fff":"#64748b",
      outline:active?"none":"1px solid #334155", fontWeight:active?700:400, ...extra }}>{children}</button>
  );
  return (
    <Card style={{ padding:14 }}>
      <SectionTitle>เลือกปี</SectionTitle>
      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
        {btn(false,()=>setViewYear(y=>y-1),"‹",{fontSize:16})}
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {yrs.map(y=>btn(viewYear===y,()=>setViewYear(y),y+543))}
        </div>
        {btn(false,()=>setViewYear(y=>y+1),"›",{fontSize:16})}
        {inp ? (
          <div style={{ display:"flex", gap:5 }}>
            <input autoFocus value={val} onChange={e=>setVal(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")jump();if(e.key==="Escape")setInp(false);}}
              placeholder="ปี พ.ศ." style={{ width:76, padding:"5px 8px", borderRadius:7,
                border:"1px solid #3b82f6", background:"#0f172a", color:"#38bdf8",
                fontSize:12, outline:"none", textAlign:"center", ...F }}/>
            <button onClick={jump} style={{ padding:"5px 8px", borderRadius:7, border:"none",
              background:"#3b82f6", color:"#fff", fontSize:12, cursor:"pointer", ...F }}>ไป</button>
            <button onClick={()=>setInp(false)} style={{ padding:"5px 8px", borderRadius:7,
              border:"1px solid #334155", background:"transparent", color:"#64748b",
              fontSize:12, cursor:"pointer", ...F }}>✕</button>
          </div>
        ) : btn(false,()=>setInp(true),"ระบุปี…")}
      </div>
    </Card>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────────
function CalGrid({ pharmacists, selected, viewMonth, viewYear, setViewMonth, setViewYear,
                   isAdmin, activeLeaveType, setActiveLeaveType, onToggle }) {
  const [hover, setHover] = useState(null);
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
  return (
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
                transition:"all .15s" }}>
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
              <div key={day} onMouseEnter={()=>setHover(dateStr)} onMouseLeave={()=>setHover(null)}
                style={{ borderRadius:9, padding:"4px 3px 3px", minHeight:52,
                  background:isToday&&heat===0?"#172554":hBg,
                  border:`1px solid ${isToday&&heat===0?"#3b82f6":hBd}`,
                  cursor:arr.length>0?"pointer":"default", position:"relative",
                  transition:"transform .12s",
                  transform:hover===dateStr&&arr.length>0?"scale(1.05)":"scale(1)" }}>
                <div style={{ fontSize:12, fontWeight:isToday?700:400,
                  color:isToday?"#38bdf8":"#cbd5e1", marginBottom:2 }}>{day}</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:2 }}>
                  {arr.slice(0,6).map((x,j)=>(
                    <div key={j} style={{ width:6,height:6,borderRadius:"50%",
                      background:x.color, boxShadow:`0 0 3px ${x.color}99` }}/>
                  ))}
                  {arr.length>6&&<span style={{ fontSize:8,color:"#94a3b8",lineHeight:"6px" }}>+{arr.length-6}</span>}
                </div>
                {hover===dateStr&&arr.length>0&&(
                  <div style={{ position:"absolute", bottom:"calc(100% + 6px)", left:"50%",
                    transform:"translateX(-50%)", background:"#0f172a",
                    border:"1px solid #334155", borderRadius:10, padding:"8px 12px",
                    zIndex:60, minWidth:150, pointerEvents:"none",
                    boxShadow:"0 10px 30px #00000099" }}>
                    <div style={{ fontSize:11,color:"#64748b",marginBottom:5,fontWeight:700 }}>
                      {day} {MONTHS_TH[viewMonth]}
                    </div>
                    {arr.map((x,j)=>(
                      <div key={j} style={{ display:"flex",alignItems:"center",gap:7,marginBottom:3 }}>
                        <div style={{ width:6,height:6,borderRadius:"50%",background:x.color,flexShrink:0 }}/>
                        <span style={{ fontSize:12,color:"#e2e8f0",whiteSpace:"nowrap" }}>{x.name}</span>
                        <span style={{ fontSize:11,color:x.color,marginLeft:"auto",fontWeight:600 }}>{LT[x.t].short}</span>
                      </div>
                    ))}
                  </div>
                )}
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
  );
}

// ─── Monthly Summary ──────────────────────────────────────────────────────────
function MonthlySummary({ pharmacists, viewMonth, viewYear }) {
  const pfx = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}`;
  return (
    <Card>
      <SectionTitle>สรุปรายคนประจำเดือน {MONTHS_TH[viewMonth]} {viewYear+543}</SectionTitle>
      {pharmacists.map(p=>{
        const tc = Object.entries(LT).map(([k,lt])=>({
          k, lt, n: Object.entries(p.leaves).filter(([d,v])=>v===k&&d.startsWith(pfx)).length
        })).filter(x=>x.n>0);
        const tot = tc.reduce((s,x)=>s+x.n,0);
        return (
          <div key={p.id} style={{ display:"flex", alignItems:"center", gap:12,
            padding:"9px 12px", borderRadius:10, background:"#0f172a", marginBottom:7 }}>
            <div style={{ width:30,height:30,borderRadius:"50%",background:avc(p.id),
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:12,fontWeight:700,color:"#fff",flexShrink:0 }}>
              {p.name.replace(/ภก\.|ภญ\./,"")[0]}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13,fontWeight:600 }}>{p.name}</div>
              {tc.length>0
                ?<div style={{ display:"flex",gap:5,marginTop:3,flexWrap:"wrap" }}>
                    {tc.map(({k,lt,n})=>(
                      <span key={k} style={{ fontSize:11,color:lt.color,
                        background:lt.color+"22",padding:"1px 7px",borderRadius:5,fontWeight:600 }}>
                        {lt.short} {n}
                      </span>
                    ))}
                  </div>
                :<div style={{ fontSize:11,color:"#475569",marginTop:2 }}>ไม่มีการลา</div>
              }
            </div>
            {tot>0&&<div style={{ fontSize:18,fontWeight:800,color:"#f1f5f9" }}>
              {tot}<span style={{ fontSize:11,color:"#475569",fontWeight:400 }}> วัน</span>
            </div>}
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
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:BG, ...F }}>
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
            <span style={{ fontSize:11, color:"#475569", display:"inline-block",
              transform:drop?"rotate(180deg)":"rotate(0)", transition:"transform .2s" }}>▾</span>
          </div>
          {drop&&(
            <div style={{ position:"absolute", top:"calc(100% + 6px)", left:0, right:0, zIndex:50,
              background:"#0f172a", border:"1px solid #334155", borderRadius:12,
              boxShadow:"0 12px 32px #00000099", overflow:"hidden" }}>
              {ACCOUNTS.map(a=>(
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
                  {u===a.username&&<span style={{ marginLeft:"auto", color:"#3b82f6", fontSize:16 }}>✓</span>}
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
        {err&&<div style={{ fontSize:12, color:"#ef4444", marginBottom:12, textAlign:"center",
          background:"#ef444411", borderRadius:8, padding:"8px 12px" }}>{err}</div>}
        <button onClick={go} style={{ width:"100%", padding:12, borderRadius:10, border:"none",
          background:u?"linear-gradient(135deg,#1d4ed8,#7c3aed)":"#1e293b",
          color:u?"#fff":"#475569", fontSize:15, fontWeight:700,
          cursor:u?"pointer":"not-allowed", ...F }}>เข้าสู่ระบบ</button>
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

  // ── Load & sync from Firestore (real-time) ─────────────────────────────────
  useEffect(() => {
    const ref = doc(db, "data", "pharmacists");
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const list = snap.data().list || [];
        setPharmas(list);
        setSelId(prev => (prev && list.find(p=>p.id===prev)) ? prev : (list[0]?.id || null));
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
    try { await setDoc(doc(db, "data", "pharmacists"), { list }); }
    catch(e) { console.error("Save error:", e); }
    setSaving(false);
  }

  function updatePharmas(newList) {
    setPharmas(newList);
    saveToFirestore(newList);
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
  const sel     = pharmas.find(p => p.id === selId) || pharmas[0];

  function addP(name) {
    const p = mkP(name);
    const next = [...pharmas, p];
    updatePharmas(next);
    setSelId(p.id);
  }
  function removeP(id) {
    const rest = pharmas.filter(p => p.id !== id);
    updatePharmas(rest);
    if (selId === id && rest.length) setSelId(rest[0].id);
  }
  function toggleLeave(dateStr) {
    if (!isAdmin) return;
    const next = pharmas.map(p => {
      if (p.id !== selId) return p;
      const lv = { ...p.leaves };
      lv[dateStr] === activeLT ? delete lv[dateStr] : (lv[dateStr] = activeLT);
      return { ...p, leaves: lv };
    });
    updatePharmas(next);
  }
  function updateCarryover(year, val) {
    const next = pharmas.map(p =>
      p.id !== selId ? p : { ...p, carryover: { ...p.carryover, [year]: Math.max(0, parseInt(val)||0) } }
    );
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
            <div style={{ display:"flex", alignItems:"center", gap:10,
              background:"#1e293b", borderRadius:20, padding:"6px 14px", border:"1px solid #334155" }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:isAdmin?"#10b981":"#64748b" }}/>
              <span style={{ fontSize:12, color:"#94a3b8" }}>{acct.username}</span>
              <button onClick={()=>setAcct(null)} style={{ fontSize:11, padding:"3px 10px", borderRadius:6,
                border:"1px solid #334155", background:"transparent", color:"#ef4444", cursor:"pointer", ...F }}>
                ออก
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:860, margin:"0 auto" }}>
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          <button onClick={()=>setTab("overview")} style={tabStyle(tab==="overview")}>🗓 ภาพรวม</button>
          <button onClick={()=>setTab("record")} style={tabStyle(tab==="record")}>
            {isAdmin ? "✏️ บันทึกการลา" : "📅 ปฏิทินรายคน"}
          </button>
        </div>

        {tab==="overview" && (
          <div style={GAP}>
            {(()=>{
              const now = pharmas.flatMap(p =>
                p.leaves[TODAY_STR] ? [{ name:p.name, id:p.id, t:p.leaves[TODAY_STR] }] : []
              );
              return now.length>0?(
                <Card style={{ padding:"12px 18px", border:"1px solid #f59e0b55" }}>
                  <div style={{ fontSize:12,fontWeight:700,color:"#f59e0b",marginBottom:8 }}>🔔 ลาวันนี้</div>
                  <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>
                    {now.map((x,i)=>(
                      <div key={i} style={{ display:"flex",alignItems:"center",gap:6,
                        background:"#0f172a",borderRadius:8,padding:"6px 12px",border:`1px solid ${LT[x.t].color}44` }}>
                        <div style={{ width:6,height:6,borderRadius:"50%",background:LT[x.t].color }}/>
                        <span style={{ fontSize:13 }}>{x.name}</span>
                        <span style={{ fontSize:11,color:LT[x.t].color,fontWeight:600 }}>{LT[x.t].label}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              ):null;
            })()}
            <PersonPicker pharmacists={pharmas} selectedId={selId}
              setSelectedId={setSelId} isAdmin={isAdmin} onAdd={addP} onRemove={removeP}/>
            {sel && <LeaveSummary p={sel} year={viewYear} isAdmin={isAdmin}
              showVacationDetail={false} onCarryover={updateCarryover}/>}
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
            {!isAdmin && (
              <Card style={{ padding:"10px 16px", border:"1px solid #334155" }}>
                <span style={{ fontSize:12, color:"#64748b" }}>👁 คุณอยู่ในโหมด <strong style={{ color:"#94a3b8" }}>ดูอย่างเดียว</strong></span>
              </Card>
            )}
            <PersonPicker pharmacists={pharmas} selectedId={selId}
              setSelectedId={setSelId} isAdmin={isAdmin} onAdd={addP} onRemove={removeP}/>
            {sel && <LeaveSummary p={sel} year={viewYear} isAdmin={isAdmin}
              showVacationDetail={true} onCarryover={updateCarryover}/>}
            <YearPicker viewYear={viewYear} setViewYear={setViewYear}/>
            {sel && <CalGrid pharmacists={pharmas} selected={sel}
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
