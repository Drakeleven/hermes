export const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"] as const;
export const DOW_NAMES = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"] as const;
export const SHIFT_TYPES = ["Malam","Pagi","Sore"] as const;
export type ShiftType = typeof SHIFT_TYPES[number];

// ── Types ────────────────────────────────────────────────────────────────────
export type PrevDay = { assign: Record<ShiftType,string>; off: string[] };
export type CutiEntry = { person: string; days: number[] };
export type IzinMove = { person: string; from: number; to: number | null }; // to null = auto
export type IzinSwap = { person: string; fromDay: number; fromShift: ShiftType; toDay: number; toShift: ShiftType; swappedWith: string; backupOnFrom: string };
export type Person = {
  name: string;
  counts: Record<ShiftType, number>;
  target: Record<ShiftType, number>;
  remaining: Record<ShiftType, number>;
  totalShifts: number;
  offCount: number;
  cooldownUntil: number;
  consec: number;
  pendingType: ShiftType | null;
  pendingContinueDay: number | null;
  lastBlockType: ShiftType | null;
  lastType: ShiftType | null;
  cutiSet: Set<number>;
  izinSet: Set<number>;
  cutiDays: number;
  izinDays: number;
  maxStreak: number;
  curStreak: number;
  _rand: number;
};
export type DayRecord = { day: number; date: Date; dow: number; assign: Record<ShiftType,string>; off: string[] };
export type SchedulerResult = {
  people: Person[];
  schedule: DayRecord[];
  warnings: string[];
  daysInMonth: number;
  month:number; year:number;
  startDay:number;
  prev: PrevDay[];
  cuti: CutiEntry[];
  izin: IzinMove[];
  swaps: IzinSwap[];
  backupOrder: string[];
  stats: { totalSlots:number; fairness: number; coverage: number };
};
export type SchedulerInput = {
  names: string[];
  year:number; month:number; daysInMonth:number;
  startDay:number;
  existingCounts: Record<ShiftType,number>[] | null;
  prev: PrevDay[];
  cuti: CutiEntry[];
  izin: IzinMove[];
  backupOrder: string[]; // ordered high -> low priority
};

// ── helpers ──────────────────────────────────────────────────────────────────
function normName(s:string){ return s.trim().toLowerCase(); }

export function runScheduler(
  names: string[],
  year: number,
  month:number,
  daysInMonth:number,
  startDay:number,
  existingCounts: Record<ShiftType,number>[] | null,
  prevInput?: PrevDay[],
  cutiInput?: CutiEntry[]
): SchedulerResult {
  return runSchedulerV2({ names, year, month, daysInMonth, startDay, existingCounts, prev: prevInput||[], cuti: cutiInput||[], izin: [], backupOrder: names });
}

export function runSchedulerV2(input: SchedulerInput): SchedulerResult {
  const { names, year, month, daysInMonth:N, cuti: cutiInput, izin: izinInput, backupOrder } = input;
  let startDay = input.startDay || 1;
  if(startDay<1) startDay=1; if(startDay>N) startDay=N;
  const prev: PrevDay[] = (input.prev||[]).slice(-2);
  const existingCounts = input.existingCounts;

  const totalSlots = 3 * (N - startDay + 1);
  const base = Math.floor(totalSlots / 5);
  const extra = totalSlots - base*5;

  const cutiByName = new Map<string, Set<number>>();
  (cutiInput||[]).forEach(c=>{
    const key=normName(c.person);
    const s=new Set<number>();
    (c.days||[]).forEach(d=>{ if(d>=startDay && d<=N) s.add(d); });
    if(cutiByName.has(key)) s.forEach(v=> cutiByName.get(key)!.add(v));
    else cutiByName.set(key,s);
  });
  const izinByName = new Map<string, Set<number>>();
  const izinMoves: IzinMove[] = [];
  (izinInput||[]).forEach(m=>{
    const key=normName(m.person);
    if(!izinByName.has(key)) izinByName.set(key, new Set());
    // from may be single, but we treat as entry with from..to
    // For UI, izinInput is already per-move; we collect days
    izinByName.get(key)!.add(m.from);
    izinMoves.push(m);
  });
  // also support legacy where single person multiple days - already covered

  // backup rank map (lower = higher priority)
  const backupRank = new Map<string, number>();
  const ordered = (backupOrder && backupOrder.length? backupOrder : names);
  ordered.forEach((n,i)=>{
    const key=normName(n);
    if(!backupRank.has(key)) backupRank.set(key,i);
  });
  // anyone missing gets large rank
  names.forEach(n=>{
    const k=normName(n);
    if(!backupRank.has(k)) backupRank.set(k, 999);
  });

  const people: Person[] = names.map((n,i)=>{
    const rawTargetBase = base + (i < extra ? 1 : 0);
    const perTypeBase = Math.floor(rawTargetBase/3);
    let rem = rawTargetBase - perTypeBase*3;
    const order: ShiftType[] = ["Malam","Pagi","Sore"];
    const target: Record<ShiftType,number> = {Malam:perTypeBase, Pagi:perTypeBase, Sore:perTypeBase};
    for(let k=0;k<rem;k++) target[order[(i+k)%3]]++;
    const already = (existingCounts && existingCounts[i]) ? existingCounts[i] : {Malam:0,Pagi:0,Sore:0};
    const remaining: Record<ShiftType,number> = {
      Malam: Math.max(0, target.Malam - (already.Malam||0)),
      Pagi: Math.max(0, target.Pagi - (already.Pagi||0)),
      Sore: Math.max(0, target.Sore - (already.Sore||0)),
    };
    for(const t of SHIFT_TYPES){
      if((already[t]||0) > target[t]) {
        const diff=(already[t]||0)-target[t];
        target[t]+=diff;
        remaining[t]=0;
      }
    }
    const key=normName(n);
    const cutiSet = cutiByName.get(key) || new Set<number>();
    const izinSet = izinByName.get(key) || new Set<number>();
    return {
      name:n, counts:{...already} as Record<ShiftType,number>,
      target, remaining, totalShifts: (already.Malam||0)+(already.Pagi||0)+(already.Sore||0),
      offCount:0, cooldownUntil:startDay, consec:0,
      pendingType:null, pendingContinueDay:null, lastBlockType:null, lastType:null,
      cutiSet, izinSet, cutiDays: cutiSet.size, izinDays: izinSet.size, maxStreak:0, curStreak:0, _rand: Math.random()
    };
  });

  // Seed from prev 2 days
  type Hist = { dayOffset:number, type: ShiftType | 'OFF' };
  const histByName = new Map<string, Hist[]>();
  people.forEach(p=> histByName.set(normName(p.name), []));
  prev.forEach((pd, idx)=>{
    const offset = prev.length===2 ? (idx===0?-2:-1) : -1;
    const assignMap = new Map<string, ShiftType>();
    for(const t of SHIFT_TYPES){
      const nm = (pd.assign as Record<string,string>)[t];
      if(nm) assignMap.set(normName(nm), t as ShiftType);
    }
    const offSet = new Set((pd.off||[]).map(normName));
    people.forEach(p=>{
      const key=normName(p.name);
      const arr=histByName.get(key)!;
      if(assignMap.has(key)) arr.push({dayOffset:offset, type: assignMap.get(key)!});
      else arr.push({dayOffset:offset, type:'OFF'});
    });
  });
  people.forEach(p=>{
    const key=normName(p.name);
    const h=histByName.get(key)!;
    h.sort((a,b)=>a.dayOffset-b.dayOffset);
    if(h.length===0) return;
    const last = h[h.length-1];
    const secondLast = h.length>=2 ? h[h.length-2] : null;
    if(last.type!=='OFF'){
      if(secondLast && secondLast.type===last.type){
        p.cooldownUntil = startDay+2;
        p.lastBlockType = last.type;
        p.lastType = last.type;
        p.consec = 0;
      } else {
        p.pendingType = last.type;
        p.pendingContinueDay = startDay;
        p.consec = 1;
        p.lastType = last.type;
        p.lastBlockType = null;
        p.cooldownUntil = startDay;
      }
    } else {
      p.cooldownUntil = startDay;
      p.lastType = null;
      p.consec = 0;
      const lastWork = [...h].reverse().find(x=> x.type!=='OFF');
      if(lastWork) p.lastBlockType = lastWork.type as ShiftType;
    }
  });

  const FORWARD_NEXT: Record<ShiftType,ShiftType> = {Malam:"Pagi", Pagi:"Sore", Sore:"Malam"};
  const schedule: DayRecord[] = [];
  const warnings: string[] = [];

  // Phase 1: generate without izin as constraint (cuti only), izin will be swapped after
  for(let d=startDay; d<=N; d++){
    const dateObj = new Date(year, month, d);
    const dow = dateObj.getDay();
    const slot: Partial<Record<ShiftType,number>> = {};
    const usedToday = new Set<number>();
    const cutiToday = new Set<number>();
    people.forEach((p,i)=>{ if(p.cutiSet.has(d)) cutiToday.add(i); });
    // izin NOT treated as cuti in phase1

    for(let i=0;i<5;i++){
      const p=people[i];
      if(p.pendingType && p.pendingContinueDay===d){
        if(cutiToday.has(i)){
          warnings.push(`Hari ${d}: ${p.name} jadwal lanjut ${p.pendingType} tapi cuti — dialihkan.`);
          p.pendingType=null; p.pendingContinueDay=null; p.cooldownUntil=d+1; p.consec=0;
          continue;
        }
        slot[p.pendingType]=i;
        usedToday.add(i);
        p.counts[p.pendingType]++; p.totalShifts++;
        p.remaining[p.pendingType]=Math.max(0,p.remaining[p.pendingType]-1);
        p.cooldownUntil=d+2; p.lastBlockType=p.pendingType; p.lastType=p.pendingType;
        p.pendingType=null; p.pendingContinueDay=null; p.consec=0;
      }
    }

    const emptyTypes = (SHIFT_TYPES as readonly ShiftType[]).filter(t=> !(t in slot));
    const forceShortIndex = (emptyTypes.length===3 && d>=N) ? Math.floor(Math.random()*3) : -1;

    for(let idx=0; idx<emptyTypes.length; idx++){
      const type = emptyTypes[idx];
      let pool = people.map((_,i)=>i).filter(i=> !usedToday.has(i) && !cutiToday.has(i) && people[i].cooldownUntil <= d);
      if(pool.length===0){
        pool = people.map((_,i)=>i).filter(i=> !usedToday.has(i) && !cutiToday.has(i));
        if(pool.length>0) warnings.push(`Hari ${d} ${type}: semua orang masih cooldown — rotasi terpaksa dilanggar.`);
        else { warnings.push(`Hari ${d} ${type}: semua orang cuti — slot kosong!`); continue; }
      }
      const forwardPool = pool.filter(i=>{
        const last=people[i].lastBlockType;
        if(!last) return true;
        return FORWARD_NEXT[last]===type;
      });
      let candidates = forwardPool.length>0 ? forwardPool : pool;
      if(forwardPool.length===0 && pool.length>0){
        const anyWithLast = pool.some(i=> people[i].lastBlockType!=null);
        if(anyWithLast) warnings.push(`Hari ${d} ${type}: terpaksa shift mundur (bukan Malam→Pagi→Sore) karena ketersediaan.`);
      }
      // scoring with backup priority on cuti days
      const hasCutiToday = cutiToday.size>0;
      candidates.sort((a,b)=>{
        const pa=people[a], pb=people[b];
        // if cuti day, prioritize backupOrder
        if(hasCutiToday){
          const ra=backupRank.get(normName(pa.name)) ?? 999;
          const rb=backupRank.get(normName(pb.name)) ?? 999;
          if(ra!==rb) return ra-rb;
        }
        if(pb.remaining[type]!==pa.remaining[type]) return pb.remaining[type]-pa.remaining[type];
        const ra=pa.remaining.Malam+pa.remaining.Pagi+pa.remaining.Sore;
        const rb=pb.remaining.Malam+pb.remaining.Pagi+pb.remaining.Sore;
        if(rb!==ra) return rb-ra;
        if(pa.totalShifts!==pb.totalShifts) return pa.totalShifts - pb.totalShifts;
        if(pa.cooldownUntil!==pb.cooldownUntil) return pa.cooldownUntil - pb.cooldownUntil;
        if(pa.curStreak!==pb.curStreak) return pa.curStreak - pb.curStreak;
        return pa._rand - pb._rand;
      });
      const chosen=candidates[0];
      const p=people[chosen];
      slot[type]=chosen; usedToday.add(chosen);
      p.counts[type]++; p.totalShifts++; p.remaining[type]=Math.max(0,p.remaining[type]-1);
      p.lastType=type;
      const makeShort = (idx===forceShortIndex) || (d===N) || p.cutiSet.has(d+1);
      if(d+1<=N && !makeShort){
        p.pendingType=type; p.pendingContinueDay=d+1; p.consec=1;
      } else {
        p.cooldownUntil=d+2; p.lastBlockType=type; p.consec=0;
      }
    }

    const dayRecord: DayRecord = { day:d, date:dateObj, dow, assign:{} as Record<ShiftType,string>, off:[] };
    for(const t of SHIFT_TYPES){
      const idx=slot[t];
      dayRecord.assign[t]= idx!==undefined ? people[idx].name : "(kosong)";
    }
    for(let i=0;i<5;i++){
      if(!usedToday.has(i)){
        people[i].offCount++;
        people[i].curStreak=0;
        dayRecord.off.push(people[i].name);
      } else {
        people[i].curStreak++;
        people[i].maxStreak=Math.max(people[i].maxStreak, people[i].curStreak);
      }
    }
    schedule.push(dayRecord);
  }

  // Phase 2: Izin swaps — pindah jadwal tanpa mengurangi proporsi
  const swaps: IzinSwap[] = [];
  // group izin moves by from day ascending
  const sortedIzin = [...izinMoves].sort((a,b)=> a.from-b.from);
  for(const mv of sortedIzin){
    const personKey=normName(mv.person);
    const personIdx=people.findIndex(p=> normName(p.name)===personKey);
    if(personIdx===-1){ warnings.push(`Izin ${mv.person} tgl ${mv.from}: nama tidak ditemukan.`); continue; }
    const p=people[personIdx];
    if(mv.from < startDay || mv.from > N){ warnings.push(`Izin ${p.name} tgl ${mv.from}: di luar rentang.`); continue; }
    if(p.cutiSet.has(mv.from)){ warnings.push(`Izin ${p.name} tgl ${mv.from}: hari itu sudah cuti — izin tidak perlu.`); continue; }
    const dayRec = schedule.find(r=> r.day===mv.from);
    if(!dayRec){ warnings.push(`Izin ${p.name} tgl ${mv.from}: hari tidak ada di jadwal.`); continue; }
    // find which shift person is on that day
    let fromShift: ShiftType | null = null;
    for(const t of SHIFT_TYPES) if(dayRec.assign[t]===p.name) fromShift=t;
    if(!fromShift){
      warnings.push(`Izin ${p.name} tgl ${mv.from}: sudah libur hari itu — tidak perlu pindah.`);
      continue;
    }
    // pick backup for izin day: best available off person (excluding cuti on that day, excluding izin person)
    const izinDayCuti = new Set<number>();
    people.forEach((pp,i)=>{ if(pp.cutiSet.has(mv.from)) izinDayCuti.add(i); });
    // candidates are off persons that day
    const offCandidates = dayRec.off.map(n=>{
      const idx=people.findIndex(pp=> pp.name===n);
      return idx;
    }).filter(idx=> idx!==-1 && !izinDayCuti.has(idx));
    if(offCandidates.length===0){
      warnings.push(`Izin ${p.name} tgl ${mv.from} ${fromShift}: tidak ada backup off yang tersedia — izin ditunda.`);
      continue;
    }
    // choose backup using rank + fairness
    offCandidates.sort((a,b)=>{
      const ra=backupRank.get(normName(people[a].name))??999;
      const rb=backupRank.get(normName(people[b].name))??999;
      if(ra!==rb) return ra-rb;
      // also prefer those with lower total shifts (need)
      return people[a].totalShifts - people[b].totalShifts;
    });
    const backupIdx = offCandidates[0];
    const backupName = people[backupIdx].name;

    // find replacement day
    let toDay: number | null = mv.to ?? null;
    let toShift: ShiftType | null = null;
    let swappedWith: string | null = null;

    const isValidReplacement = (d: number, shift: ShiftType): boolean => {
      if(d<=mv.from || d<startDay || d> N) return false;
      if(p.cutiSet.has(d) || p.izinSet.has(d)) return false; // p wants to be off there? but replacement should be where p is off and can work
      const rec=schedule.find(r=> r.day===d);
      if(!rec) return false;
      if(rec.assign[shift]===p.name) return false; // already assigned
      if(rec.assign[shift]==="(kosong)") return true; // empty slot ideal
      // check if rec.off includes p (p is off)
      if(!rec.off.includes(p.name)) return false;
      // check backup/cuti not blocking
      const candIdx=people.findIndex(pp=> pp.name===rec.assign[shift]);
      if(candIdx!==-1 && people[candIdx].cutiSet.has(d)) return false; // shouldn't swap cuti person
      // streak/cooldown rough check: p must not be cooldown on d (we track via people cooldownUntil but that is post generation, not updated after swaps)
      // For simplicity allow if p not already assigned previous day same block? Check previous day
      return true;
    };

    if(toDay!==null){
      // manual toDay specified: find shift where p is off
      const rec=schedule.find(r=> r.day===toDay);
      if(!rec || !rec.off.includes(p.name)){
        warnings.push(`Izin ${p.name} tgl ${mv.from}→${toDay}: tgl tujuan bukan hari libur ${p.name} — auto cari tgl lain.`);
        toDay=null;
      } else {
        // find shift to swap: prefer same type as fromShift if that shift occupant exists and not cuti
        if(rec.assign[fromShift] && rec.assign[fromShift]!=="(kosong)" && !people.find(pp=> pp.name===rec.assign[fromShift])?.cutiSet.has(toDay)){
          toShift=fromShift; swappedWith=rec.assign[fromShift];
        } else {
          // find any shift
          for(const t of SHIFT_TYPES){
            if(rec.assign[t] && rec.assign[t]!=="(kosong)"){
              const occ=people.find(pp=> pp.name===rec.assign[t]);
              if(occ && !occ.cutiSet.has(toDay)){ toShift=t; swappedWith=rec.assign[t]; break; }
            }
          }
          if(!toShift){
            warnings.push(`Izin ${p.name} tgl ${mv.from}→${toDay}: tgl tujuan tidak ada shift yang bisa di-swap.`);
            toDay=null;
          }
        }
      }
    }
    if(toDay===null){
      // auto find next feasible day
      let found=false;
      for(let d=mv.from+1; d<=N && !found; d++){
        if(p.cutiSet.has(d) || p.izinSet.has(d)) continue;
        const rec=schedule.find(r=> r.day===d);
        if(!rec || !rec.off.includes(p.name)) continue;
        // try same shift first
        if(isValidReplacement(d, fromShift)){
          toDay=d; toShift=fromShift; swappedWith=rec.assign[fromShift]; found=true; break;
        }
        for(const t of SHIFT_TYPES){
          if(t===fromShift) continue;
          if(isValidReplacement(d,t)){ toDay=d; toShift=t; swappedWith=rec.assign[t]; found=true; break; }
        }
      }
      if(!found){
        warnings.push(`Izin ${p.name} tgl ${mv.from} ${fromShift}: tidak ada tgl pengganti kosong — jadwal tgl ${mv.from} tetap, proporsi tetap terjaga via fairness (total shift tidak berkurang karena izin tetap dihitung?).`);
        continue;
      }
    }
    // perform swap: izinDay: p out, backup in; toDay: swappedWith out, p in
    // update counts
    // izinDay
    dayRec.assign[fromShift]=backupName;
    dayRec.off = dayRec.off.filter(n=> n!==backupName);
    if(!dayRec.off.includes(p.name)) dayRec.off.push(p.name);
    // adjust counts: p loses one, backup gains one on izinDay (but p will gain back on toDay, so net same)
    // To keep counts correct, we decrement/increment
    p.counts[fromShift]--; // p loses
    people[backupIdx].counts[fromShift]++;

    // toDay
    const toRec=schedule.find(r=> r.day===toDay!)!;
    const occName=toRec.assign[toShift!];
    const occIdx=people.findIndex(pp=> pp.name===occName);
    toRec.assign[toShift!]=p.name;
    toRec.off = toRec.off.filter(n=> n!==p.name);
    if(occIdx!==-1){
      toRec.off.push(occName);
      // counts: occ loses, p gains
      people[occIdx].counts[toShift!]--;
      people[occIdx].totalShifts--;
      // occ offCount increment? we track offCount via people.offCount but that was computed from schedule; we need to keep consistent: offCount reflects schedule.
      // For stats, we recompute offCount later from schedule or adjust.
      swappedWith=occName;
    } else {
      // empty slot
      swappedWith="(kosong)";
      toRec.off = toRec.off.filter(n=> n!==p.name);
    }
    p.counts[toShift!]++; // p gains back (net 0 if same type, else per-type shifts but total same)
    // totalShifts net 0 for p, but backup and swapped person changed
    people[backupIdx].totalShifts++;
    if(occIdx!==-1) people[occIdx].totalShifts--; // but we already did counts; keep total consistent
    // p total unchanged (lose then gain)
    // update izin tracking
    swaps.push({ person:p.name, fromDay: mv.from, fromShift, toDay: toDay!, toShift: toShift!, swappedWith, backupOnFrom: backupName });
  }

  // Recompute offCount and maxStreak from final schedule for accuracy
  people.forEach(p=>{ p.offCount=0; p.curStreak=0; p.maxStreak=0; });
  for(const r of schedule){
    for(let i=0;i<people.length;i++){
      const pp=people[i];
      if(r.off.includes(pp.name)){
        pp.offCount++; pp.curStreak=0;
      } else {
        // they worked
        pp.curStreak++; pp.maxStreak=Math.max(pp.maxStreak, pp.curStreak);
      }
    }
  }
  // fairness and coverage
  const totals=people.map(p=> p.totalShifts);
  const avg=totals.reduce((a,b)=>a+b,0)/totals.length;
  const variance=totals.reduce((a,b)=> a+ (b-avg)*(b-avg),0)/totals.length;
  const fairness = Math.sqrt(variance);
  const coverage = schedule.every(r=> SHIFT_TYPES.every(t=> r.assign[t]!=="(kosong)")) ? 100 : Math.round(schedule.filter(r=> SHIFT_TYPES.every(t=> r.assign[t]!=="(kosong)")).length / schedule.length *100);

  for(const p of people){
    const remTotal=p.remaining.Malam+p.remaining.Pagi+p.remaining.Sore;
    if(remTotal>0) warnings.push(`${p.name}: sisa jatah ${remTotal} shift tidak terpenuhi karena cuti/cooldown.`);
  }

  return { people, schedule, warnings, daysInMonth:N, month, year, startDay, prev, cuti: (cutiInput||[]), izin: izinMoves, swaps, backupOrder: ordered, stats:{ totalSlots, fairness: Number(fairness.toFixed(2)), coverage } };
}

export function weekNumberFor(dateObj: Date, firstDate: Date){
  let wk=1; const d0=new Date(firstDate); const cur=new Date(dateObj); const cursor=new Date(d0);
  while(cursor < cur){ cursor.setDate(cursor.getDate()+1); if(cursor.getDay()===1) wk++; }
  return wk;
}
