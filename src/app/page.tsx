"use client";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";

const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const DOW_NAMES = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const SHIFT_TYPES = ["Malam","Pagi","Sore"] as const;
type ShiftType = typeof SHIFT_TYPES[number];

type Person = {
  name: string;
  counts: Record<ShiftType, number>;
  target: Record<ShiftType, number>;
  remaining: Record<ShiftType, number>;
  totalShifts: number;
  offCount: number;
  cooldownUntil: number;
  pendingType: ShiftType | null;
  pendingContinueDay: number | null;
  lastBlockType: ShiftType | null;
  _rand: number;
};
type DayRecord = { day: number; date: Date; dow: number; assign: Record<ShiftType,string>; off: string[] };
type SchedulerResult = { people: Person[]; schedule: DayRecord[]; warnings: string[]; daysInMonth: number };

function runScheduler(names: string[], year: number, month:number, daysInMonth:number, startDay:number, existingCounts: Record<ShiftType,number>[] | null): SchedulerResult {
  const N = daysInMonth;
  startDay = startDay || 1;
  const totalSlots = 3 * N;
  const base = Math.floor(totalSlots / 5);
  const extraCount = totalSlots - base*5;
  const people: Person[] = names.map((n,i)=>{
    const targetTotal = base + (i < extraCount ? 1 : 0);
    const perTypeBase = Math.floor(targetTotal/3);
    let rem = targetTotal - perTypeBase*3;
    const order: ShiftType[] = ["Malam","Pagi","Sore"];
    const target: Record<ShiftType,number> = {Malam:perTypeBase, Pagi:perTypeBase, Sore:perTypeBase};
    for(let k=0;k<rem;k++) target[order[(i+k)%3]]++;
    const already = (existingCounts && existingCounts[i]) ? existingCounts[i] : {Malam:0,Pagi:0,Sore:0};
    const remaining: Record<ShiftType,number> = {
      Malam: Math.max(0, target.Malam - already.Malam),
      Pagi: Math.max(0, target.Pagi - already.Pagi),
      Sore: Math.max(0, target.Sore - already.Sore),
    };
    return { name:n, counts:{...already}, target, remaining, totalShifts: already.Malam+already.Pagi+already.Sore, offCount:0, cooldownUntil: startDay, pendingType:null, pendingContinueDay:null, lastBlockType:null, _rand: Math.random() };
  });
  const FORWARD_NEXT: Record<ShiftType,ShiftType> = {Malam:"Pagi", Pagi:"Sore", Sore:"Malam"};
  const schedule: DayRecord[] = [];
  const warnings: string[] = [];
  for(let d=startDay; d<=N; d++){
    const dateObj = new Date(year, month, d);
    const dow = dateObj.getDay();
    const slot: Partial<Record<ShiftType,number>> = {};
    const usedToday = new Set<number>();
    for(let i=0;i<5;i++){
      const p = people[i];
      if(p.pendingType && p.pendingContinueDay === d){
        slot[p.pendingType] = i;
        usedToday.add(i);
        p.counts[p.pendingType]++; p.totalShifts++;
        p.remaining[p.pendingType] = Math.max(0, p.remaining[p.pendingType]-1);
        p.cooldownUntil = d+2; p.lastBlockType = p.pendingType; p.pendingType=null; p.pendingContinueDay=null;
      }
    }
    const emptyTypes = (SHIFT_TYPES as readonly ShiftType[]).filter(t=> !(t in slot));
    const forceShortIndex = (emptyTypes.length===3) ? Math.floor(Math.random()*3) : -1;
    emptyTypes.forEach((type, idx)=>{
      let pool = people.map((_,i)=>i).filter(i=> !usedToday.has(i) && people[i].cooldownUntil <= d);
      if(pool.length===0){ pool = people.map((_,i)=>i).filter(i=> !usedToday.has(i)); warnings.push(`Hari ke-${d}: keterbatasan orang tersedia, jatah libur seseorang terpaksa dipangkas.`); }
      const forwardPool = pool.filter(i=>{ const last=people[i].lastBlockType; return !last || FORWARD_NEXT[last]===type; });
      if(forwardPool.length>0) pool=forwardPool;
      else if(pool.length>0) warnings.push(`Hari ke-${d}: terpaksa rotasi shift mundur (bukan Malam→Pagi→Sore→Malam) karena tidak ada orang lain yang tersedia.`);
      pool.sort((a,b)=>{
        const rb=people[b].remaining[type], ra=people[a].remaining[type];
        if(rb!==ra) return rb-ra;
        if(people[a].totalShifts!==people[b].totalShifts) return people[a].totalShifts - people[b].totalShifts;
        if(people[a].cooldownUntil!==people[b].cooldownUntil) return people[a].cooldownUntil - people[b].cooldownUntil;
        return people[a]._rand - people[b]._rand;
      });
      const chosen=pool[0]; const p=people[chosen];
      slot[type]=chosen; usedToday.add(chosen);
      p.counts[type]++; p.totalShifts++; p.remaining[type]=Math.max(0,p.remaining[type]-1);
      const makeThisOneShort = (idx===forceShortIndex);
      if(d+1<=N && !makeThisOneShort){ p.pendingType=type; p.pendingContinueDay=d+1; }
      else { p.cooldownUntil=d+2; p.lastBlockType=type; }
    });
    const dayRecord: DayRecord = { day:d, date:dateObj, dow, assign:{} as Record<ShiftType,string>, off:[] };
    for(const t of SHIFT_TYPES) dayRecord.assign[t]=people[slot[t]!].name;
    for(let i=0;i<5;i++) if(!usedToday.has(i)){ people[i].offCount++; dayRecord.off.push(people[i].name); }
    schedule.push(dayRecord);
  }
  return { people, schedule, warnings, daysInMonth };
}

function weekNumberFor(dateObj: Date, firstDate: Date){
  let wk=1; const d0=new Date(firstDate); const cur=new Date(dateObj); const cursor=new Date(d0);
  while(cursor < cur){ cursor.setDate(cursor.getDate()+1); if(cursor.getDay()===1) wk++; }
  return wk;
}

export default function Home(){
  const [names,setNames]=useState(["","","","",""]);
  const [month,setMonth]=useState(new Date().getMonth());
  const [year,setYear]=useState(new Date().getFullYear());
  const [continueOn,setContinueOn]=useState(false);
  const [lastManualDay,setLastManualDay]=useState<string>("");
  const [startDay,setStartDay]=useState<string>("");
  const [existing,setExisting]=useState<Record<ShiftType,number>[]>(Array.from({length:5},()=>({Malam:0,Pagi:0,Sore:0})));
  const [result,setResult]=useState<SchedulerResult|null>(null);
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>setHydrated(true),[]);
  useEffect(()=>{
    if(lastManualDay){
      const v=parseInt(lastManualDay,10);
      if(!isNaN(v) && v>0) setStartDay(String(v+1));
    }
  },[lastManualDay]);

  const daysInMonth = new Date(year, month+1, 0).getDate();

  function handleGenerate(){
    const finalNames = names.map((v,i)=> v.trim() || `Anggota ${i+1}`);
    let sd=1; let ec: Record<ShiftType,number>[] | null = null;
    if(continueOn){
      sd = parseInt(startDay,10);
      if(isNaN(sd)|| sd<2) sd=2;
      if(sd>daysInMonth) sd=daysInMonth;
      ec = existing;
    }
    const r = runScheduler(finalNames, year, month, daysInMonth, sd, ec);
    setResult(r);
    setTimeout(()=>window.scrollTo({top:0, behavior:"smooth"}),50);
  }

  function handleRegenerate(){ handleGenerate(); }
  function handleBack(){ setResult(null); }

  function downloadExcel(){
    if(!result) return;
    const wb = XLSX.utils.book_new();
    const schedRows: (string|number)[][] = [["Tanggal","Hari","Malam (23.00-07.00)","Pagi (07.00-15.00)","Sore (15.00-23.00)","Libur"]];
    result.schedule.forEach(r=> schedRows.push([`${r.day} ${MONTH_NAMES[month]} ${year}`, DOW_NAMES[r.dow], r.assign.Malam, r.assign.Pagi, r.assign.Sore, r.off.join(" & ")]));
    const ws1 = XLSX.utils.aoa_to_sheet(schedRows);
    (ws1 as any)["!cols"]=[{wch:20},{wch:10},{wch:16},{wch:16},{wch:16},{wch:22}];
    XLSX.utils.book_append_sheet(wb, ws1, "Jadwal Harian");
    const firstDate=result.schedule[0].date;
    const weeks: Record<number,DayRecord[]> = {};
    result.schedule.forEach(row=>{ const wk=weekNumberFor(row.date, firstDate); if(!weeks[wk]) weeks[wk]=[]; weeks[wk].push(row); });
    const weekRows: (string|number)[][] = [["Minggu","Rentang Tanggal","Nama","Malam","Pagi","Sore","Libur","Total Shift"]];
    Object.keys(weeks).sort((a,b)=>Number(a)-Number(b)).forEach(wk=>{
      const rows=weeks[Number(wk)]; const rangeLabel=`${rows[0].day} - ${rows[rows.length-1].day} ${MONTH_NAMES[month]}`;
      const per: Record<string,Record<string,number>> = {};
      result.people.forEach(p=> per[p.name]={Malam:0,Pagi:0,Sore:0,Off:0});
      rows.forEach(r=>{ SHIFT_TYPES.forEach(t=> per[r.assign[t]][t]++); r.off.forEach(n=> per[n].Off++); });
      result.people.forEach(p=>{ const c=per[p.name]; weekRows.push([`Minggu ${wk}`,rangeLabel,p.name,c.Malam,c.Pagi,c.Sore,c.Off,c.Malam+c.Pagi+c.Sore]); });
    });
    const ws2=XLSX.utils.aoa_to_sheet(weekRows);
    (ws2 as any)["!cols"]=[{wch:10},{wch:18},{wch:16},{wch:8},{wch:8},{wch:8},{wch:8},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws2, "Rekap Mingguan");
    const monthRows: (string|number)[][] = [["Nama","Total Malam","Total Pagi","Total Sore","Total Libur","Total Shift Bulan Ini"]];
    result.people.forEach(p=> monthRows.push([p.name, p.counts.Malam, p.counts.Pagi, p.counts.Sore, p.offCount, p.totalShifts]));
    const ws3=XLSX.utils.aoa_to_sheet(monthRows);
    (ws3 as any)["!cols"]=[{wch:16},{wch:12},{wch:12},{wch:12},{wch:12},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws3, "Rekap Bulanan");
    XLSX.writeFile(wb, `Jadwal-Shift-${MONTH_NAMES[month]}-${year}.xlsx`);
  }

  if(!hydrated) return null;

  const showResult = result!==null;
  const weeklyGroups: Record<number,DayRecord[]> = {};
  if(result){ const fd=result.schedule[0].date; result.schedule.forEach(r=>{ const wk=weekNumberFor(r.date,fd); if(!weeklyGroups[wk]) weeklyGroups[wk]=[]; weeklyGroups[wk].push(r); }); }

  return (
    <div className="wrap">
      <style>{`
  :root{--bg:#F5F8FF;--panel:#FFFFFF;--ink:#1F2340;--sub:#6B7091;--line:#E4E8F5;--malam:#4C3B8C;--malam-soft:#EDE9FA;--pagi:#FFB627;--pagi-soft:#FFF4DA;--sore:#FF6F59;--sore-soft:#FFE7E2;--off:#B9BFD6;--off-soft:#EEF0F9;--good:#1FA97F;--warn:#E6532B;--shadow:0 10px 30px rgba(45,45,110,0.08);}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Inter',sans-serif;background:radial-gradient(circle at 8% -10%,#E9DDFF 0%,transparent 45%),radial-gradient(circle at 100% 0%,#FFE6C9 0%,transparent 40%),var(--bg);color:var(--ink);min-height:100vh;padding-bottom:60px}
  h1,h2,h3,.brand{font-family:'Fredoka',sans-serif}
  .wrap{max-width:1180px;margin:0 auto;padding:28px 20px}
  header.hero{background:linear-gradient(120deg,#3A2E70 0%,#4C3B8C 32%,#FF6F59 68%,#FFB627 100%);border-radius:24px;padding:34px 36px;color:#fff;box-shadow:var(--shadow);position:relative;overflow:hidden;margin-bottom:26px}
  header.hero::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,0.05) 0 2px,transparent 2px 40px);pointer-events:none}
  header.hero .eyebrow{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;margin-bottom:8px}
  header.hero h1{font-size:30px;margin:0 0 8px;font-weight:700}
  header.hero p{margin:0;opacity:.9;max-width:640px;font-size:14.5px;line-height:1.55}
  .cycle-strip{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}
  .cycle-chip{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);padding:6px 12px;border-radius:999px;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:6px}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:26px 28px;box-shadow:var(--shadow);margin-bottom:22px}
  .panel h2{font-size:19px;margin:0 0 4px}
  .panel .desc{color:var(--sub);font-size:13.5px;margin:0 0 20px}
  .grid-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px}
  .field label{font-size:12.5px;font-weight:600;color:var(--sub);display:block;margin-bottom:6px}
  .field input,.field select{width:100%;padding:11px 13px;border-radius:12px;border:1.5px solid var(--line);font-size:14.5px;font-family:'Inter',sans-serif;color:var(--ink);background:#FBFCFF;transition:border-color .15s,box-shadow .15s}
  .field input:focus,.field select:focus{outline:none;border-color:var(--malam);box-shadow:0 0 0 3px var(--malam-soft)}
  .row-inline{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:22px}
  .row-inline .field{flex:1;min-width:160px}
  button.primary{background:linear-gradient(100deg,var(--malam),#6A4FD1);color:#fff;border:none;padding:13px 26px;border-radius:14px;font-family:'Fredoka',sans-serif;font-weight:600;font-size:15px;cursor:pointer;box-shadow:0 8px 20px rgba(76,59,140,.28);transition:transform .12s,box-shadow .12s}
  button.primary:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(76,59,140,.36)}
  button.secondary{background:#fff;color:var(--ink);border:1.5px solid var(--line);padding:12px 22px;border-radius:14px;font-family:'Fredoka',sans-serif;font-weight:600;font-size:14px;cursor:pointer}
  button.secondary:hover{border-color:var(--malam)}
  button.excel{background:linear-gradient(100deg,var(--good),#34C98F);color:#fff;border:none;padding:12px 22px;border-radius:14px;font-family:'Fredoka',sans-serif;font-weight:600;font-size:14px;cursor:pointer;box-shadow:0 8px 18px rgba(31,169,127,.28)}
  .actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .legend{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
  .legend span{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:999px;background:var(--off-soft);color:var(--sub)}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  thead th{text-align:left;padding:10px 12px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--sub);border-bottom:2px solid var(--line)}
  tbody td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
  tbody tr:hover{background:#FAFBFF}
  .day-cell{font-weight:700;font-family:'JetBrains Mono',monospace;font-size:12.5px}
  .dow{color:var(--sub);font-weight:500;font-size:11.5px;display:block}
  .day-cell.weekend{color:var(--warn)}
  .day-cell.weekend .dow{color:var(--warn);opacity:.85}
  tr.weekend-row{background:#FFF4F1}
  tr.weekend-row:hover{background:#FFEAE4}
  .pill{display:inline-block;padding:4px 11px;border-radius:9px;font-weight:600;font-size:12.5px}
  .pill.malam{background:var(--malam);color:#fff}
  .pill.pagi{background:var(--pagi-soft);color:#8A5A00;border:1px solid #FFDB92}
  .pill.sore{background:var(--sore);color:#fff}
  .pill.off{background:var(--off-soft);color:var(--sub)}
  .week-block{margin-bottom:26px}
  .week-title{font-family:'Fredoka',sans-serif;font-weight:600;font-size:15.5px;color:var(--malam);margin:0 0 10px;display:flex;align-items:center;gap:8px}
  .week-title small{font-family:'Inter',sans-serif;font-weight:500;color:var(--sub);font-size:12px}
  .recap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}
  .recap-card{border:1.5px solid var(--line);border-radius:16px;padding:16px 18px;background:#FBFCFF}
  .recap-card .name{font-family:'Fredoka',sans-serif;font-weight:600;font-size:15px;margin-bottom:10px}
  .recap-line{display:flex;justify-content:space-between;align-items:center;font-size:13px;margin-bottom:6px}
  .recap-line .tag{display:flex;align-items:center;gap:7px;color:var(--sub);font-weight:600}
  .recap-line b{font-family:'JetBrains Mono',monospace;font-size:13.5px}
  .recap-total{border-top:1px dashed var(--line);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-size:13px;font-weight:700}
  .warn-box{background:#FFF3EE;border:1.5px solid #FFD3C2;color:#9A3A1B;border-radius:14px;padding:14px 16px;font-size:13px;margin-bottom:20px;line-height:1.6}
  .warn-box b{display:block;margin-bottom:4px}
  @media(max-width:720px){header.hero{padding:24px 20px}header.hero h1{font-size:23px}.panel{padding:20px 18px}table{font-size:12px}thead th,tbody td{padding:7px 8px}}
      `}</style>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />

      <header className="hero">
        <div className="eyebrow">Managed Service · Monitoring ETL 24/7</div>
        <h1>Generator Jadwal Shift Bulanan</h1>
        <p>Atur jadwal shift Malam, Pagi, dan Sore untuk 5 orang dalam satu tim, otomatis diseimbangkan tiap bulan, bebas jadwal bentrok dan lompat shift, dan tetap ada hari libur.</p>
        <div className="cycle-strip">
          <span className="cycle-chip"><span className="dot" style={{background:"#B9A8FF"}}></span>Malam 23.00–07.00</span>
          <span className="cycle-chip"><span className="dot" style={{background:"#FFD976"}}></span>Pagi 07.00–15.00</span>
          <span className="cycle-chip"><span className="dot" style={{background:"#FF9C86"}}></span>Sore 15.00–23.00</span>
          <span className="cycle-chip"><span className="dot" style={{background:"#fff"}}></span>Standby lokasi 1 jam sebelum shift</span>
        </div>
      </header>

      {!showResult && (
        <div className="panel">
          <h2>1. Data Tim &amp; Periode</h2>
          <p className="desc">Masukkan nama 5 anggota tim dan pilih bulan yang ingin dibuatkan jadwalnya.</p>
          <div className="grid-people">
            {names.map((v,i)=>(
              <div key={i} className="field">
                <label>Anggota {i+1}</label>
                <input type="text" value={v} placeholder={`Nama anggota ${i+1}`} onChange={e=>{ const n=[...names]; n[i]=e.target.value; setNames(n); }} />
              </div>
            ))}
          </div>
          <div className="row-inline">
            <div className="field">
              <label>Bulan</label>
              <select value={month} onChange={e=>setMonth(parseInt(e.target.value,10))}>
                {MONTH_NAMES.map((m,i)=><option key={i} value={i}>{m}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Tahun</label>
              <input type="number" value={year} min={2020} max={2100} onChange={e=>setYear(parseInt(e.target.value,10)||2026)} />
            </div>
          </div>
          <div className="field" style={{marginBottom:16}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
              <input type="checkbox" checked={continueOn} onChange={e=>setContinueOn(e.target.checked)} style={{width:"auto",accentColor:"#4C3B8C"}} />
              <span style={{fontWeight:600,color:"var(--ink)",fontSize:"13.5px"}}>Lanjutkan dari jadwal yang sudah berjalan (bulan ini sudah dimulai duluan)</span>
            </label>
          </div>
          {continueOn && (
            <div>
              <div className="warn-box" style={{background:"var(--malam-soft)",borderColor:"#D6CCF5",color:"#3A2E70"}}>
                <b>Cara pakai</b>
                Isi jumlah shift Malam/Pagi/Sore yang sudah dijalani tiap orang sejak tanggal 1, lalu tentukan mulai tanggal berapa generator ini melanjutkan jadwal. Sisa jatah tiap orang akan dihitung otomatis supaya tetap adil sampai akhir bulan. Asumsi: di tanggal mulai tersebut, semua orang dianggap sudah standby / tidak sedang di tengah blok shift atau masa istirahat wajib.
              </div>
              <div className="row-inline">
                <div className="field" style={{maxWidth:260}}>
                  <label>Sudah dijalani manual s.d. tanggal</label>
                  <input type="number" value={lastManualDay} min={1} max={31} placeholder="cth: 12" onChange={e=>setLastManualDay(e.target.value)} />
                </div>
                <div className="field" style={{maxWidth:260}}>
                  <label>Generate mulai dari tanggal</label>
                  <input type="number" value={startDay} min={2} max={31} placeholder="cth: 13" onChange={e=>setStartDay(e.target.value)} />
                </div>
              </div>
              <div className="grid-people">
                {names.map((_,i)=>(
                  <div key={i} className="field" style={{border:"1.5px solid var(--line)",borderRadius:14,padding:"12px 14px",background:"#FBFCFF"}}>
                    <label style={{marginBottom:8}}>{(names[i].trim()||`Anggota ${i+1}`)} — shift yang sudah dijalani</label>
                    <div style={{display:"flex",gap:8}}>
                      {(["Malam","Pagi","Sore"] as ShiftType[]).map(t=>(
                        <div key={t} style={{flex:1}}>
                          <label style={{fontWeight:500, color: t==="Malam"?"var(--malam)": t==="Pagi"?"#8A5A00":"var(--sore)"}}>{t}</label>
                          <input type="number" min={0} value={existing[i][t]} onChange={e=>{ const n=[...existing]; n[i]={...n[i],[t]: parseInt(e.target.value,10)||0}; setExisting(n); }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="actions">
            <button className="primary" onClick={handleGenerate}>Buat Jadwal Shift</button>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="panel">
            <h2>Jadwal Shift — {MONTH_NAMES[month]} {year}</h2>
            <p className="desc">Pola kerja: 2 hari shift dengan tipe yang sama (Malam 2x, Pagi 2x, atau Sore 2x — urutannya bergilir otomatis), lalu WAJIB libur minimal 1 hari sebelum masuk blok berikutnya. Total shift per tipe per orang dihitung otomatis di awal bulan supaya adil — biasanya 6x per tipe, dan kalau bulannya 31 hari, kelebihan jatahnya disebar ke orang &amp; tipe yang berbeda (bukan ditumpuk ke satu orang).</p>
            {result.warnings.length>0 && (
              <div className="warn-box">
                <b>Catatan sistem ({result.warnings.length} hari perlu penyesuaian kecil):</b>
                {result.warnings.slice(0,6).map((w,j)=><div key={j}>• {w}</div>)}
                {result.warnings.length>6 && <div>...dan {result.warnings.length-6} catatan lainnya.</div>}
              </div>
            )}
            <div className="legend">
              <span><span className="dot" style={{background:"var(--malam)"}}></span>Malam</span>
              <span><span className="dot" style={{background:"var(--pagi)"}}></span>Pagi</span>
              <span><span className="dot" style={{background:"var(--sore)"}}></span>Sore</span>
              <span><span className="dot" style={{background:"var(--off)"}}></span>Libur</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table>
                <thead><tr><th>Tanggal</th><th>Malam</th><th>Pagi</th><th>Sore</th><th>Libur</th></tr></thead>
                <tbody>
                  {result.schedule.map(row=>{
                    const isWeekend=row.dow===0||row.dow===6;
                    return (
                      <tr key={row.day} className={isWeekend?"weekend-row":""}>
                        <td className={`day-cell ${isWeekend?"weekend":""}`}>{row.day} {MONTH_NAMES[month].slice(0,3)}<span className="dow">{DOW_NAMES[row.dow]}</span></td>
                        <td><span className="pill malam">{row.assign.Malam}</span></td>
                        <td><span className="pill pagi">{row.assign.Pagi}</span></td>
                        <td><span className="pill sore">{row.assign.Sore}</span></td>
                        <td><span className="pill off">{row.off.join(" & ")}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="actions" style={{marginTop:20}}>
              <button className="excel" onClick={downloadExcel}>⬇ Unduh Excel (.xlsx)</button>
              <button className="secondary" onClick={handleRegenerate}>🔀 Acak Ulang</button>
              <button className="secondary" onClick={handleBack}>← Ubah Data / Buat Ulang</button>
            </div>
          </div>

          <div className="panel">
            <h2>2. Rekap Mingguan</h2>
            <p className="desc">Minggu dibagi Senin–Minggu. Minggu pertama bisa lebih pendek, mengikuti hari jatuhnya tanggal 1.</p>
            {Object.keys(weeklyGroups).sort((a,b)=>Number(a)-Number(b)).map(wk=>{
              const rows=weeklyGroups[Number(wk)];
              const startLabel=`${rows[0].day} ${DOW_NAMES[rows[0].dow].slice(0,3)}`;
              const endLabel=`${rows[rows.length-1].day} ${DOW_NAMES[rows[rows.length-1].dow].slice(0,3)}`;
              const per: Record<string,Record<string,number>>={};
              result.people.forEach(p=> per[p.name]={Malam:0,Pagi:0,Sore:0,Off:0});
              rows.forEach(r=>{ SHIFT_TYPES.forEach(t=> per[r.assign[t]][t]++); r.off.forEach(n=> per[n].Off++); });
              return (
                <div key={wk} className="week-block">
                  <div className="week-title">Minggu {wk} <small>({startLabel} – {endLabel}, {rows.length} hari)</small></div>
                  <div style={{overflowX:"auto"}}>
                    <table><thead><tr><th>Nama</th><th>Malam</th><th>Pagi</th><th>Sore</th><th>Libur</th><th>Total Shift</th></tr></thead>
                      <tbody>
                        {result.people.map(p=>{ const c=per[p.name]; return <tr key={p.name}><td><b>{p.name}</b></td><td>{c.Malam}</td><td>{c.Pagi}</td><td>{c.Sore}</td><td>{c.Off}</td><td>{c.Malam+c.Pagi+c.Sore}</td></tr>; })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel">
            <h2>3. Rekap Total Bulanan</h2>
            <p className="desc">Target keseimbangan: tiap orang mendapat shift malam/pagi/sore sedekat mungkin merata sepanjang bulan.</p>
            <div className="recap-grid">
              {result.people.map(p=>(
                <div key={p.name} className="recap-card">
                  <div className="name">{p.name}</div>
                  <div className="recap-line"><span className="tag"><span className="dot" style={{background:"var(--malam)"}}></span>Malam</span><b>{p.counts.Malam}x</b></div>
                  <div className="recap-line"><span className="tag"><span className="dot" style={{background:"var(--pagi)"}}></span>Pagi</span><b>{p.counts.Pagi}x</b></div>
                  <div className="recap-line"><span className="tag"><span className="dot" style={{background:"var(--sore)"}}></span>Sore</span><b>{p.counts.Sore}x</b></div>
                  <div className="recap-line"><span className="tag"><span className="dot" style={{background:"var(--off)"}}></span>Libur</span><b>{p.offCount}x</b></div>
                  <div className="recap-total"><span>Total shift bulan ini</span><span>{p.totalShifts}x</span></div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
