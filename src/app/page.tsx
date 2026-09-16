"use client";
import { useState, useEffect, useMemo } from "react";
import { MONTH_NAMES, DOW_NAMES, SHIFT_TYPES, runScheduler, weekNumberFor } from "@/lib/scheduler";
import { downloadExcel } from "@/lib/excel";
import type { ShiftType, SchedulerResult, DayRecord, PrevDay, CutiEntry } from "@/lib/scheduler";

// ── helpers ────────────────────────────────────────────────────────────────
function Pill({ variant, children }: { variant: "malam" | "pagi" | "sore" | "off" | "cuti"; children: React.ReactNode }) {
  const cls: Record<string, string> = {
    malam: "bg-[#4C3B8C] text-white",
    pagi: "bg-[#FFF4DA] text-[#8A5A00] border border-[#FFDB92]",
    sore: "bg-[#FF6F59] text-white",
    off: "bg-[#EEF0F9] text-[#6B7091] border border-[#E4E8F5]",
    cuti: "bg-[#DCFCE7] text-[#166534] border border-[#86EFAC]",
  };
  return <span className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[12.5px] font-semibold leading-none whitespace-nowrap ${cls[variant]}`}>{children}</span>;
}
function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}
function parseCutiInput(s: string, daysInMonth:number): number[] {
  if(!s.trim()) return [];
  const out=new Set<number>();
  // support "5, 12, 15-17"
  s.split(",").forEach(part=>{
    const t=part.trim();
    if(!t) return;
    if(t.includes("-")){
      const [a,b]=t.split("-").map(x=> parseInt(x.trim(),10));
      if(isNaN(a)||isNaN(b)) return;
      const lo=Math.min(a,b), hi=Math.max(a,b);
      for(let d=lo; d<=hi; d++) if(d>=1 && d<=daysInMonth) out.add(d);
    } else {
      const d=parseInt(t,10);
      if(!isNaN(d) && d>=1 && d<=daysInMonth) out.add(d);
    }
  });
  return [...out].sort((a,b)=>a-b);
}

export default function Home() {
  const [names, setNames] = useState(["", "", "", "", ""]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [continueOn, setContinueOn] = useState(false);
  const [lastManualDay, setLastManualDay] = useState("");
  const [startDay, setStartDay] = useState("");
  const [existing, setExisting] = useState<Record<ShiftType, number>[]>(Array.from({ length: 5 }, () => ({ Malam: 0, Pagi: 0, Sore: 0 })));
  // ── NEW: prev 2 days ──
  const [usePrev, setUsePrev] = useState(true);
  const [prevMalam, setPrevMalam] = useState(["","",""]); // index 0=H-2,1=H-1 (store 2)
  const [prevPagi, setPrevPagi] = useState(["","",""]);
  const [prevSore, setPrevSore] = useState(["","",""]);
  // we track 2 days: arrays len2
  const [prev2Malam, setPrev2Malam] = useState(["",""]); // [H-2, H-1]
  const [prev2Pagi, setPrev2Pagi] = useState(["",""]);
  const [prev2Sore, setPrev2Sore] = useState(["",""]);
  // ── NEW: cuti ──
  const [cutiInputs, setCutiInputs] = useState(["","","","",""]); // string per person e.g. "5,12,15-17"
  const [result, setResult] = useState<SchedulerResult | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (lastManualDay) {
      const v = parseInt(lastManualDay, 10);
      if (!isNaN(v) && v > 0) setStartDay(String(v + 1));
    }
  }, [lastManualDay]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const finalNames = useMemo(()=> names.map((v,i)=> v.trim() || `Anggota ${i+1}`), [names]);

  function buildPrev(): PrevDay[] {
    if(!usePrev) return [];
    const out: PrevDay[]=[];
    for(let idx=0; idx<2; idx++){
      const m=prev2Malam[idx]?.trim(), p=prev2Pagi[idx]?.trim(), s=prev2Sore[idx]?.trim();
      if(!m && !p && !s) continue;
      // validate all distinct if filled
      const assign: Record<ShiftType,string> = { Malam:m||"", Pagi:p||"", Sore:s||"" };
      // off = people not in assign values
      const used = new Set([m,p,s].filter(Boolean).map(x=> x.toLowerCase()));
      const off = finalNames.filter(n=> !used.has(n.toLowerCase()));
      // if any empty assign, we cannot determine off accurately — fallback: put remaining as off
      // For empty slot, leave assign value as "" and let scheduler treat as free
      // But we need to allow partial fill; if any of m/p/s empty, we still emit with that empty.
      // Filter: if all three empty skip (already)
      out.push({ assign, off });
    }
    return out;
  }
  function buildCuti(): CutiEntry[] {
    const out: CutiEntry[]=[];
    cutiInputs.forEach((s,i)=>{
      const days=parseCutiInput(s, daysInMonth);
      if(days.length) out.push({ person: finalNames[i], days });
    });
    return out;
  }

  // validation for prev collisions
  function prevError(): string | null {
    if(!usePrev) return null;
    for(let idx=0; idx<2; idx++){
      const m=prev2Malam[idx]?.trim(), p=prev2Pagi[idx]?.trim(), s=prev2Sore[idx]?.trim();
      if(!m && !p && !s) continue;
      if(!m || !p || !s) return `Lengkapi H-${2-idx} : Malam/Pagi/Sore harus terisi semua atau dikosongkan semua.`;
      const vals=[m,p,s].map(v=> v.toLowerCase());
      if(new Set(vals).size!==3) return `H-${2-idx} ada nama duplikat — tiap shift harus orang berbeda.`;
      const allowed=finalNames.map(n=> n.toLowerCase());
      for(const v of vals) if(!allowed.includes(v)) return `H-${2-idx} nama "${vals.find(x=> x===v)}" tidak ada di 5 anggota.`;
    }
    // cuti total check
    const cuti=buildCuti();
    const byDay: Record<number,number> = {};
    cuti.forEach(c=> c.days.forEach(d=> byDay[d]=(byDay[d]||0)+1));
    const maxCuti=Math.max(0, ...Object.values(byDay));
    if(maxCuti>=3) return `Ada tanggal dengan ${maxCuti} orang cuti bersamaan — minimal 3 shift tidak ter-cover, jadwal akan kosong.`;
    return null;
  }
  const validationErr = prevError();

  function handleGenerate() {
    if(validationErr){ alert(validationErr); return; }
    const fNames = finalNames;
    let sd = 1;
    let ec: Record<ShiftType, number>[] | null = null;
    if (continueOn) {
      sd = parseInt(startDay, 10);
      if (isNaN(sd) || sd < 2) sd = 2;
      if (sd > daysInMonth) sd = daysInMonth;
      ec = existing;
    }
    const prev = buildPrev();
    const cuti = buildCuti();
    const r = runScheduler(fNames, year, month, daysInMonth, sd, ec, prev, cuti);
    setResult(r);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
  }
  function handleRegenerate() { handleGenerate(); }
  function handleBack() { setResult(null); }

  if (!hydrated) return null;
  const showResult = result !== null;

  const weeklyGroups: Record<number, DayRecord[]> = {};
  if (result) {
    const fd = result.schedule[0].date;
    result.schedule.forEach((r) => {
      const wk = weekNumberFor(r.date, fd);
      if (!(wk in weeklyGroups)) weeklyGroups[wk] = [];
      weeklyGroups[wk].push(r);
    });
  }

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-7 pb-16">
      <header className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-[#2E2160] via-[#4C3B8C] to-[#FF8A3D] px-7 py-8 text-white shadow-[0_16px_40px_rgba(45,30,110,0.22)] sm:px-9 sm:py-9">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="pointer-events-none absolute -right-20 -top-20 h-[340px] w-[340px] rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-[260px] w-[520px] rounded-full bg-[#FFB627]/20 blur-3xl" />
        <div className="relative">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> Managed Service · Monitoring ETL 24/7
            </span>
            <span className="hidden sm:inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#4C3B8C]">v3 · Advance</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 border border-white/20 px-3 py-1 text-[11px] font-semibold backdrop-blur">2-day lookback · Cuti · Fairness</span>
          </div>
          <h1 className="max-w-[720px] text-[26px] font-bold leading-[1.15] tracking-tight sm:text-[30px]">
            Generator Jadwal Shift Bulanan
          </h1>
          <p className="mt-2.5 max-w-[680px] text-[14px] leading-[1.6] text-white/85">
            Atur shift <b className="font-semibold text-white">Malam · Pagi · Sore</b> untuk 5 orang — otomatis seimbang, 2-hari lookback agar tgl 1–2 tidak nabrak, plus <b className="font-semibold text-white">cuti</b> yang adil tanpa merugikan siapapun.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              { dot: "#B9A8FF", label: "Malam 23.00–07.00" },
              { dot: "#FFD976", label: "Pagi 07.00–15.00" },
              { dot: "#FF9C86", label: "Sore 15.00–23.00" },
              { dot: "#ffffff", label: "Standby 1 jam sebelum shift" },
            ].map((c) => (
              <span key={c.label} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.12] px-3.5 py-1.5 text-[12.5px] font-semibold backdrop-blur">
                <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} /> {c.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      {!showResult && (
        <div className="mt-6 rounded-[20px] border border-[#E4E8F5] bg-white p-6 shadow-[0_10px_30px_rgba(45,45,110,0.07)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold tracking-tight text-[#1F2340]">1. Data Tim & Periode</h2>
              <p className="mt-1 text-[13.5px] leading-6 text-[#6B7091]">Masukkan 5 anggota tim dan pilih bulan.</p>
            </div>
            <span className="rounded-full bg-[#EEF0F9] px-3 py-1 text-xs font-semibold text-[#6B7091]">{daysInMonth} hari · {MONTH_NAMES[month]} {year}</span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
            {names.map((v, i) => (
              <label key={i} className="group block">
                <span className="mb-1.5 block text-[12px] font-semibold tracking-wide text-[#6B7091]">Anggota {i + 1}</span>
                <input
                  type="text"
                  value={v}
                  placeholder={`Nama anggota ${i + 1}`}
                  onChange={(e) => { const n = [...names]; n[i] = e.target.value; setNames(n); }}
                  className="w-full rounded-xl border border-[#E4E8F5] bg-[#FBFCFF] px-3.5 py-2.5 text-[14px] font-medium text-[#1F2340] placeholder:text-[#B9BFD6] outline-none transition focus:border-[#4C3B8C] focus:bg-white focus:ring-4 focus:ring-[#EDE9FA]"
                />
              </label>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold tracking-wide text-[#6B7091]">Bulan</span>
              <select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))} className="w-full rounded-xl border border-[#E4E8F5] bg-[#FBFCFF] px-3.5 py-2.5 text-[14px] font-medium text-[#1F2340] outline-none focus:border-[#4C3B8C] focus:bg-white focus:ring-4 focus:ring-[#EDE9FA]">
                {MONTH_NAMES.map((m, idx) => <option key={idx} value={idx}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold tracking-wide text-[#6B7091]">Tahun</span>
              <input type="number" value={year} min={2020} max={2100} onChange={(e) => setYear(parseInt(e.target.value, 10) || 2026)} className="w-full rounded-xl border border-[#E4E8F5] bg-[#FBFCFF] px-3.5 py-2.5 text-[14px] font-medium text-[#1F2340] outline-none focus:border-[#4C3B8C] focus:bg-white focus:ring-4 focus:ring-[#EDE9FA]" />
            </label>
          </div>

          {/* ── 2-day lookback ── */}
          <div className="mt-6 rounded-2xl border border-[#E4E8F5] bg-[#FBFCFF] p-4 sm:p-5">
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" checked={usePrev} onChange={(e)=> setUsePrev(e.target.checked)} className="h-[18px] w-[18px] accent-[#4C3B8C]" />
              <span className="text-[14px] font-bold text-[#1F2340]">Gunakan 2 hari sebelum bulan ini (agar tgl 1–2 tidak nabrak)</span>
              <span className="hidden sm:inline text-[12px] text-[#6B7091]">— isi shift H-2 & H-1, algoritma otomatis jaga cooldown & rotasi</span>
            </label>
            {usePrev && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl bg-[#F5F1FF] border border-[#E8E0FF] px-3.5 py-3 text-[12.5px] leading-6 text-[#3A2E70]">
                  <b>Aturan:</b> jika H-1 = Malam dan H-2 = Malam (blok 2 hari selesai di H-1) → orang tersebut <b>wajib libur</b> di tgl 1 & 2. Jika H-1 baru hari pertama blok (H-2 beda/off) → tgl 1 akan lanjut shift sama. Kosongkan 2 baris ini jika tidak ada data.
                </div>
                {[0,1].map(idx=>{
                  const label = idx===0 ? "H-2 (2 hari sebelum tgl 1)" : "H-1 (1 hari sebelum tgl 1)";
                  return (
                    <div key={idx} className="rounded-2xl border border-[#E4E8F5] bg-white p-3.5">
                      <div className="mb-2 text-[12px] font-bold tracking-wide text-[#4C3B8C]">{label}</div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {(["Malam","Pagi","Sore"] as const).map(t=>{
                          const vals = t==="Malam"? prev2Malam : t==="Pagi"? prev2Pagi : prev2Sore;
                          const setVals = t==="Malam"? setPrev2Malam : t==="Pagi"? setPrev2Pagi : setPrev2Sore;
                          return (
                            <label key={t} className="block">
                              <span className="mb-1 block text-[11px] font-bold tracking-wide" style={{color: t==="Malam"?"#4C3B8C": t==="Pagi"?"#8A5A00":"#FF6F59"}}>{t}</span>
                              <select value={vals[idx]} onChange={e=>{ const a=[...vals]; a[idx]=e.target.value; setVals(a); }} className="w-full rounded-xl border border-[#E4E8F5] bg-[#FBFCFF] px-3 py-2.5 text-[13px] font-medium text-[#1F2340] outline-none focus:border-[#4C3B8C] focus:ring-4 focus:ring-[#EDE9FA]">
                                <option value="">— kosong —</option>
                                {finalNames.map(n=> <option key={n} value={n}>{n}</option>)}
                              </select>
                            </label>
                          );
                        })}
                      </div>
                      {/* preview off */}
                      <div className="mt-2 text-[11px] text-[#6B7091]">
                        {(()=>{ const m=prev2Malam[idx],p=prev2Pagi[idx],s=prev2Sore[idx]; if(!m && !p && !s) return <span className="italic">Kosong — tidak mempengaruhi tgl 1</span>; const used=new Set([m,p,s].filter(Boolean).map(x=>x.toLowerCase())); const off=finalNames.filter(n=> !used.has(n.toLowerCase())); return <>Libur: <b>{off.join(", ")||"-"}</b></>; })()}
                      </div>
                    </div>
                  );
                })}
                <div className="flex gap-2">
                  <button onClick={()=>{ setPrev2Malam(["",""]); setPrev2Pagi(["",""]); setPrev2Sore(["",""]); }} className="rounded-xl border border-[#E4E8F5] bg-white px-4 py-2 text-[12px] font-bold text-[#6B7091]">Kosongkan</button>
                  <span className="text-[11px] text-[#6B7091] leading-5">Tip: salin dari jadwal bulan lalu (2 baris terakhir).</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Cuti ── */}
          <div className="mt-6 rounded-2xl border border-[#E4E8F5] bg-[#FBFCFF] p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[14px] font-bold text-[#1F2340]">Daftar Cuti Bulan Ini</h3>
              <span className="rounded-full bg-[#DCFCE7] border border-[#86EFAC] px-3 py-1 text-[11px] font-bold text-[#166534]">Adil · tidak merugikan</span>
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-[#6B7091]">Isi tanggal cuti per orang. Format: <code className="rounded bg-white border border-[#E4E8F5] px-1.5 py-0.5 font-mono text-[11px]">5, 12, 15-17</code> (support rentang). Cuti = otomatis Libur hari itu, target shift disesuaikan adil. Jika cuti menabrak tgl 1 yang seharusnya lanjut blok 2 hari, sistem otomatis alihkan ke orang lain & beri warning.</p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {finalNames.map((nm,i)=>(
                <div key={i} className="rounded-2xl border border-[#E4E8F5] bg-white p-3.5">
                  <div className="mb-1.5 text-[12.5px] font-bold text-[#1F2340]">{nm}</div>
                  <input
                    type="text"
                    value={cutiInputs[i]}
                    onChange={e=>{ const a=[...cutiInputs]; a[i]=e.target.value; setCutiInputs(a); }}
                    placeholder="cth: 5, 12, 20-22"
                    className="w-full rounded-xl border border-[#E4E8F5] bg-[#FBFCFF] px-3 py-2.5 text-[13px] font-medium text-[#1F2340] placeholder:text-[#B9BFD6] outline-none focus:border-[#4C3B8C] focus:ring-4 focus:ring-[#EDE9FA]"
                  />
                  <div className="mt-1.5 text-[11px] text-[#6B7091]">{parseCutiInput(cutiInputs[i], daysInMonth).length? <>→ {parseCutiInput(cutiInputs[i], daysInMonth).join(", ")} <b>({parseCutiInput(cutiInputs[i], daysInMonth).length} hari)</b></> : <span className="italic">Tidak ada cuti</span>}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={()=> setCutiInputs(["","","","",""])} className="rounded-xl border border-[#E4E8F5] bg-white px-4 py-2 text-[12px] font-bold text-[#6B7091]">Hapus semua cuti</button>
              <span className="text-[11px] text-[#6B7091]">Total cuti bulan ini: <b>{buildCuti().reduce((a,c)=>a+c.days.length,0)} hari</b></span>
            </div>
          </div>

          {/* continue toggle */}
          <label className="mt-6 flex cursor-pointer items-center gap-3 rounded-xl border border-[#E4E8F5] bg-[#FBFCFF] px-4 py-3.5 transition has-[input:checked]:border-[#D6CCF5] has-[input:checked]:bg-[#F5F1FF]">
            <input type="checkbox" checked={continueOn} onChange={(e) => setContinueOn(e.target.checked)} className="h-[18px] w-[18px] accent-[#4C3B8C]" />
            <span className="text-[13.5px] font-semibold text-[#1F2340]">Lanjutkan dari jadwal yang sudah berjalan</span>
            <span className="hidden text-[12px] text-[#6B7091] sm:inline">— bulan ini sudah dimulai duluan</span>
          </label>

          {continueOn && (
            <div className="mt-4 rounded-2xl border border-[#E8E0FF] bg-[#F8F6FF] p-4 sm:p-5">
              <div className="rounded-xl bg-white/70 px-3.5 py-3 text-[13px] leading-6 text-[#3A2E70] ring-1 ring-[#E8E0FF]">
                <b className="font-bold">Cara pakai</b> — isi jumlah shift yang sudah dijalani tiap orang sejak tgl 1, lalu tentukan mulai tgl berapa generator melanjutkan. Sisa jatah dihitung otomatis.
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3.5 sm:max-w-[520px]">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-[#6B7091]">Sudah dijalani s.d. tgl</span>
                  <input type="number" value={lastManualDay} min={1} max={31} placeholder="cth: 12" onChange={(e) => setLastManualDay(e.target.value)} className="w-full rounded-xl border border-[#E4E8F5] bg-white px-3.5 py-2.5 text-[14px] font-medium text-[#1F2340] outline-none focus:border-[#4C3B8C] focus:ring-4 focus:ring-[#EDE9FA]" />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-[#6B7091]">Generate mulai tgl</span>
                  <input type="number" value={startDay} min={2} max={31} placeholder="cth: 13" onChange={(e) => setStartDay(e.target.value)} className="w-full rounded-xl border border-[#E4E8F5] bg-white px-3.5 py-2.5 text-[14px] font-medium text-[#1F2340] outline-none focus:border-[#4C3B8C] focus:ring-4 focus:ring-[#EDE9FA]" />
                </label>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {names.map((_, i) => (
                  <div key={i} className="rounded-2xl border border-[#E4E8F5] bg-white p-3.5">
                    <div className="mb-2 text-[12.5px] font-bold text-[#1F2340]">{(names[i].trim() || `Anggota ${i + 1}`)} — sudah dijalani</div>
                    <div className="flex gap-2">
                      {(["Malam", "Pagi", "Sore"] as ShiftType[]).map((t) => (
                        <label key={t} className="flex-1">
                          <span className="mb-1 block text-[11px] font-bold tracking-wide" style={{ color: t === "Malam" ? "#4C3B8C" : t === "Pagi" ? "#8A5A00" : "#FF6F59" }}>{t}</span>
                          <input type="number" min={0} value={existing[i][t]} onChange={(e) => { const n = [...existing]; n[i] = { ...n[i], [t]: parseInt(e.target.value, 10) || 0 }; setExisting(n); }} className="w-full rounded-xl border border-[#E4E8F5] bg-[#FBFCFF] px-2.5 py-2 text-center text-[14px] font-semibold text-[#1F2340] outline-none focus:border-[#4C3B8C] focus:ring-4 focus:ring-[#EDE9FA]" />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {validationErr && (
            <div className="mt-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[13px] font-semibold text-[#DC2626]">⚠️ {validationErr}</div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={handleGenerate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#4C3B8C] to-[#6A4FD1] px-7 py-3 text-[14.5px] font-bold text-white shadow-[0_10px_24px_rgba(76,59,140,0.28)] transition hover:translate-y-[-1px] hover:shadow-[0_14px_30px_rgba(76,59,140,0.34)] active:translate-y-[0px]">
              Buat Jadwal Shift <span aria-hidden>→</span>
            </button>
            <span className="text-[12.5px] text-[#6B7091]">2-day lookback + cuti + advance fairness</span>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="mt-6 rounded-[20px] border border-[#E4E8F5] bg-white p-5 shadow-[0_10px_30px_rgba(45,45,110,0.07)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[18px] font-bold tracking-tight text-[#1F2340]">Jadwal Shift — {MONTH_NAMES[month]} {year}</h2>
                <p className="mt-1 max-w-[720px] text-[13px] leading-6 text-[#6B7091]">
                  Pola: 2 hari blok sama (Malam 2× / Pagi 2× / Sore 2× — rotasi Malam→Pagi→Sore), wajib libur ≥1 hari. Tgl 1–2 dijaga agar tidak nabrak 2 hari sebelum. Cuti diprioritaskan sebagai Libur.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EDE9FA] px-3 py-1.5 text-xs font-bold text-[#4C3B8C]"><Dot color="#4C3B8C" /> Malam</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF4DA] px-3 py-1.5 text-xs font-bold text-[#8A5A00] ring-1 ring-[#FFDB92]"><Dot color="#FFB627" /> Pagi</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFE7E2] px-3 py-1.5 text-xs font-bold text-[#9A3A1B]"><Dot color="#FF6F59" /> Sore</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF0F9] px-3 py-1.5 text-xs font-bold text-[#6B7091]"><Dot color="#B9BFD6" /> Libur</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-3 py-1.5 text-xs font-bold text-[#166534] ring-1 ring-[#86EFAC]"><Dot color="#16A34A" /> Cuti</span>
              </div>
            </div>

            {/* Stats */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-[#E4E8F5] bg-[#FBFCFF] p-3 text-center">
                <div className="text-[11px] font-bold tracking-wide text-[#6B7091]">FAIRNESS</div>
                <div className="mt-1 text-[18px] font-black text-[#1F2340]">{result.stats.fairness}</div>
                <div className="text-[11px] text-[#6B7091]">stddev shift</div>
              </div>
              <div className="rounded-2xl border border-[#E4E8F5] bg-[#FBFCFF] p-3 text-center">
                <div className="text-[11px] font-bold tracking-wide text-[#6B7091]">COVERAGE</div>
                <div className="mt-1 text-[18px] font-black text-[#16A34A]">{result.stats.coverage}%</div>
                <div className="text-[11px] text-[#6B7091]">slot terisi</div>
              </div>
              <div className="rounded-2xl border border-[#E4E8F5] bg-[#FBFCFF] p-3 text-center">
                <div className="text-[11px] font-bold tracking-wide text-[#6B7091]">TOTAL CUTI</div>
                <div className="mt-1 text-[18px] font-black text-[#4C3B8C]">{result.cuti.reduce((a,c)=>a+c.days.length,0)} hari</div>
                <div className="text-[11px] text-[#6B7091]">{result.cuti.length} orang</div>
              </div>
              <div className="rounded-2xl border border-[#E4E8F5] bg-[#FBFCFF] p-3 text-center">
                <div className="text-[11px] font-bold tracking-wide text-[#6B7091]">COOLDOWN</div>
                <div className="mt-1 text-[12px] font-bold text-[#1F2340]">H-2 lookback aktif</div>
                <div className="text-[11px] text-[#6B7091]">{result.prev.length} hari konteks</div>
              </div>
            </div>

            {result.cuti.length>0 && (
              <div className="mt-4 rounded-2xl border border-[#DCFCE7] bg-[#F0FDF4] px-4 py-3">
                <div className="text-[12px] font-bold text-[#166534]">Daftar Cuti Bulan Ini</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {result.cuti.map(c=> <span key={c.person} className="rounded-full bg-white border border-[#86EFAC] px-3 py-1 text-[12px] font-semibold text-[#166534]">{c.person}: {c.days.join(", ")}</span>)}
                </div>
              </div>
            )}

            {result.prev.length>0 && (
              <div className="mt-4 rounded-2xl border border-[#E8E0FF] bg-[#F8F6FF] px-4 py-3 text-[12.5px] leading-6 text-[#3A2E70]">
                <b>2 hari sebelum tgl 1:</b> {result.prev.map((pd,i)=> <span key={i} className="mr-3 inline-flex gap-1">H-{result.prev.length - i}: Malam <b>{pd.assign.Malam||"-"}</b> · Pagi <b>{pd.assign.Pagi||"-"}</b> · Sore <b>{pd.assign.Sore||"-"}</b></span>)}
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="mt-5 rounded-2xl border border-[#FFD3C2] bg-[#FFF7F3] px-4 py-3.5 text-[13px] leading-6 text-[#9A3A1B]">
                <b className="font-bold">Catatan sistem ({result.warnings.length}):</b>
                <ul className="mt-1 list-disc pl-5">
                  {result.warnings.slice(0, 8).map((w, j) => <li key={j}>{w}</li>)}
                  {result.warnings.length > 8 && <li>…dan {result.warnings.length - 8} catatan lainnya.</li>}
                </ul>
              </div>
            )}

            <div className="scroll-thin mt-6 overflow-x-auto rounded-2xl border border-[#E4E8F5]">
              <table className="w-full border-collapse text-[13.5px]">
                <thead className="sticky top-0 z-10 bg-[#F8F9FF]">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-3 text-left font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-[#6B7091]">Tanggal</th>
                    <th className="px-3 py-3 text-left font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-[#6B7091]"><span className="inline-flex items-center gap-1.5"><Dot color="#4C3B8C" /> Malam</span></th>
                    <th className="px-3 py-3 text-left font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-[#6B7091]"><span className="inline-flex items-center gap-1.5"><Dot color="#FFB627" /> Pagi</span></th>
                    <th className="px-3 py-3 text-left font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-[#6B7091]"><span className="inline-flex items-center gap-1.5"><Dot color="#FF6F59" /> Sore</span></th>
                    <th className="px-3 py-3 text-left font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-[#6B7091]">Libur / Cuti</th>
                  </tr>
                </thead>
                <tbody>
                  {result.schedule.map((row) => {
                    const isWeekend = row.dow === 0 || row.dow === 6;
                    const isCutiDay = result.cuti.some(c=> c.days.includes(row.day));
                    return (
                      <tr key={row.day} className={`border-t border-[#E4E8F5] transition ${isWeekend ? "bg-[#FFF6F4]" : "bg-white"} hover:bg-[#FAFBFF]`}>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span className={`font-mono text-[13px] font-bold ${isWeekend ? "text-[#E6532B]" : "text-[#1F2340]"}`}>{row.day} {MONTH_NAMES[month].slice(0, 3)}</span>
                          <span className={`ml-2 text-[11.5px] font-medium ${isWeekend ? "text-[#E6532B]/80" : "text-[#6B7091]"}`}>{DOW_NAMES[row.dow]}</span>
                          {isCutiDay && <span className="ml-1 rounded-full bg-[#DCFCE7] border border-[#86EFAC] px-1.5 py-0.5 text-[10px] font-bold text-[#166534]">CUTI</span>}
                        </td>
                        <td className="px-3 py-2.5"><Pill variant="malam">{row.assign.Malam}</Pill></td>
                        <td className="px-3 py-2.5"><Pill variant="pagi">{row.assign.Pagi}</Pill></td>
                        <td className="px-3 py-2.5"><Pill variant="sore">{row.assign.Sore}</Pill></td>
                        <td className="px-3 py-2.5"><span className="inline-flex flex-wrap gap-1">{row.off.map((n) => {
                          const isCuti = result.cuti.find(c=> c.person===n && c.days.includes(row.day));
                          return <Pill key={n} variant={isCuti? "cuti":"off"}>{n}{isCuti?" ✈":""}</Pill>;
                        })}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={() => downloadExcel(result, month, year)} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#1FA97F] to-[#34C98F] px-5 py-2.5 text-[13.5px] font-bold text-white shadow-[0_8px_18px_rgba(31,169,127,0.28)] transition hover:translate-y-[-1px]">
                ⬇ Unduh Excel (.xlsx)
              </button>
              <button onClick={handleRegenerate} className="rounded-xl border border-[#E4E8F5] bg-white px-5 py-2.5 text-[13.5px] font-bold text-[#1F2340] transition hover:border-[#4C3B8C] hover:bg-[#FBFCFF]">🔀 Acak Ulang</button>
              <button onClick={handleBack} className="rounded-xl border border-[#E4E8F5] bg-white px-5 py-2.5 text-[13.5px] font-bold text-[#1F2340] transition hover:border-[#4C3B8C]">← Ubah Data</button>
            </div>
          </div>

          {/* Weekly recap */}
          <div className="mt-6 rounded-[20px] border border-[#E4E8F5] bg-white p-5 shadow-[0_10px_30px_rgba(45,45,110,0.07)] sm:p-7">
            <h2 className="text-[17px] font-bold tracking-tight text-[#1F2340]">Rekap Mingguan</h2>
            <p className="mt-1 text-[13px] text-[#6B7091]">Minggu Senin–Minggu.</p>
            <div className="mt-5 space-y-6">
              {Object.keys(weeklyGroups).sort((a, b) => Number(a) - Number(b)).map((wk) => {
                const rows = weeklyGroups[Number(wk)];
                const startLabel = `${rows[0].day} ${DOW_NAMES[rows[0].dow].slice(0, 3)}`;
                const endLabel = `${rows[rows.length - 1].day} ${DOW_NAMES[rows[rows.length - 1].dow].slice(0, 3)}`;
                const per: Record<string, Record<string, number>> = {};
                result.people.forEach((p) => (per[p.name] = { Malam: 0, Pagi: 0, Sore: 0, Off: 0 }));
                rows.forEach((r) => { SHIFT_TYPES.forEach((t) => per[r.assign[t]][t]++); r.off.forEach((n) => per[n].Off++); });
                return (
                  <div key={wk}>
                    <div className="mb-2 flex flex-wrap items-baseline gap-2">
                      <span className="rounded-full bg-[#4C3B8C] px-3 py-1 text-xs font-bold text-white">Minggu {wk}</span>
                      <span className="text-xs font-medium text-[#6B7091]">{startLabel} – {endLabel} · {rows.length} hari</span>
                    </div>
                    <div className="scroll-thin overflow-x-auto rounded-2xl border border-[#E4E8F5]">
                      <table className="w-full border-collapse text-[13px]">
                        <thead className="bg-[#F8F9FF]">
                          <tr>
                            <th className="px-3 py-2.5 text-left font-mono text-[11px] tracking-wide uppercase text-[#6B7091]">Nama</th>
                            <th className="px-3 py-2.5 text-center font-mono text-[11px] tracking-wide uppercase text-[#6B7091]">Malam</th>
                            <th className="px-3 py-2.5 text-center font-mono text-[11px] tracking-wide uppercase text-[#6B7091]">Pagi</th>
                            <th className="px-3 py-2.5 text-center font-mono text-[11px] tracking-wide uppercase text-[#6B7091]">Sore</th>
                            <th className="px-3 py-2.5 text-center font-mono text-[11px] tracking-wide uppercase text-[#6B7091]">Libur</th>
                            <th className="px-3 py-2.5 text-center font-mono text-[11px] tracking-wide uppercase text-[#6B7091]">Cuti</th>
                            <th className="px-3 py-2.5 text-center font-mono text-[11px] tracking-wide uppercase text-[#6B7091]">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.people.map((p) => {
                            const c = per[p.name];
                            const cutiCnt= result.cuti.find(x=> x.person===p.name)?.days.filter(d=> rows.some(r=> r.day===d)).length || 0;
                            return (
                              <tr key={p.name} className="border-t border-[#E4E8F5] bg-white">
                                <td className="px-3 py-2 font-semibold text-[#1F2340]">{p.name}</td>
                                <td className="px-3 py-2 text-center font-mono font-bold">{c.Malam}</td>
                                <td className="px-3 py-2 text-center font-mono font-bold">{c.Pagi}</td>
                                <td className="px-3 py-2 text-center font-mono font-bold">{c.Sore}</td>
                                <td className="px-3 py-2 text-center font-mono text-[#6B7091]">{c.Off - cutiCnt}</td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-[#16A34A]">{cutiCnt || "-"}</td>
                                <td className="px-3 py-2 text-center font-mono font-bold text-[#4C3B8C]">{c.Malam + c.Pagi + c.Sore}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Monthly recap */}
          <div className="mt-6 rounded-[20px] border border-[#E4E8F5] bg-white p-5 shadow-[0_10px_30px_rgba(45,45,110,0.07)] sm:p-7">
            <h2 className="text-[17px] font-bold tracking-tight text-[#1F2340]">Rekap Total Bulanan</h2>
            <p className="mt-1 text-[13px] text-[#6B7091]">Target vs realisasi — fairness dijaga otomatis. Cuti tidak menambah beban ke orang lain.</p>
            <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
              {result.people.map((p) => (
                <div key={p.name} className="rounded-2xl border border-[#E4E8F5] bg-[#FBFCFF] p-4">
                  <div className="text-[14px] font-bold text-[#1F2340]">{p.name}</div>
                  <div className="mt-1 text-[11px] text-[#6B7091]">Target {p.target.Malam}/{p.target.Pagi}/{p.target.Sore} · Max streak {p.maxStreak} hari</div>
                  <div className="mt-3 space-y-2 text-[13px]">
                    <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 font-semibold text-[#6B7091]"><Dot color="#4C3B8C" /> Malam</span><span className="font-mono text-[13px]">{p.counts.Malam} / <span className="text-[#6B7091]">{p.target.Malam}</span></span></div>
                    <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 font-semibold text-[#6B7091]"><Dot color="#FFB627" /> Pagi</span><span className="font-mono text-[13px]">{p.counts.Pagi} / <span className="text-[#6B7091]">{p.target.Pagi}</span></span></div>
                    <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 font-semibold text-[#6B7091]"><Dot color="#FF6F59" /> Sore</span><span className="font-mono text-[13px]">{p.counts.Sore} / <span className="text-[#6B7091]">{p.target.Sore}</span></span></div>
                    <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 font-semibold text-[#6B7091]"><Dot color="#B9BFD6" /> Libur</span><b className="font-mono text-[13px]">{p.offCount}×</b></div>
                    <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5 font-semibold text-[#16A34A]"><Dot color="#16A34A" /> Cuti</span><b className="font-mono text-[13px] text-[#16A34A]">{p.cutiDays}×</b></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-dashed border-[#E4E8F5] pt-3 text-[13px] font-bold"><span>Total shift</span><span className="font-mono text-[#4C3B8C]">{p.totalShifts}×</span></div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="mt-8 text-center text-xs leading-5 text-[#6B7091]/70">
        v3 Advance — 2-day lookback · Cuti adil · Fairness &amp; coverage · Bugfixes<br />
        Stack: Next.js 16 · Tailwind 4 · xlsx · TypeScript
      </p>
    </div>
  );
}
