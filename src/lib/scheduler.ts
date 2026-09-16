export const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"] as const;
export const DOW_NAMES = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"] as const;
export const SHIFT_TYPES = ["Malam","Pagi","Sore"] as const;
export type ShiftType = typeof SHIFT_TYPES[number];

// ── Types ────────────────────────────────────────────────────────────────────
export type PrevDay = { assign: Record<ShiftType,string>; off: string[] }; // 2 days before month
export type CutiEntry = { person: string; days: number[] }; // days in current month
export type Person = {
  name: string;
  counts: Record<ShiftType, number>;
  target: Record<ShiftType, number>;
  remaining: Record<ShiftType, number>;
  totalShifts: number;
  offCount: number;
  cooldownUntil: number;
  consec: number;               // consecutive days on same block type (0..2)
  pendingType: ShiftType | null;
  pendingContinueDay: number | null;
  lastBlockType: ShiftType | null;
  lastType: ShiftType | null;   // last assigned single day type
  cutiSet: Set<number>;
  cutiDays: number;
  maxStreak: number;            // track longest work streak
  curStreak: number;
  _rand: number;
};
export type DayRecord = { day: number; date: Date; dow: number; assign: Record<ShiftType,string>; off: string[]; isCutiDay?: boolean };
export type SchedulerResult = {
  people: Person[];
  schedule: DayRecord[];
  warnings: string[];
  daysInMonth: number;
  month:number; year:number;
  startDay:number;
  prev: PrevDay[];
  cuti: CutiEntry[];
  stats: { totalSlots:number; fairness: number; coverage: number };
};
export type SchedulerInput = {
  names: string[];
  year:number; month:number; daysInMonth:number;
  startDay:number;
  existingCounts: Record<ShiftType,number>[] | null;
  prev: PrevDay[];            // length 0..2, index 0 = day -2, index 1 = day -1
  cuti: CutiEntry[];          // per person
};

// ── helpers ──────────────────────────────────────────────────────────────────
function normName(s:string){ return s.trim().toLowerCase(); }

function buildTarget(names:string[], N:number, startDay:number): Record<string,number>[] {
  // Fair split of slots remaining from startDay..N
  const remainingDays = N - (startDay||1) + 1;
  const totalSlots = 3 * remainingDays;
  // Distribute fairly across 5 people (include already?). We'll compute base and let caller subtract existing.
  // For simplicity produce targetTotals for remaining period only.
  const base = Math.floor(totalSlots / 5);
  const extra = totalSlots - base*5;
  return names.map((_,i)=> {
    const t = base + (i < extra ? 1 : 0);
    const per = Math.floor(t/3);
    let rem = t - per*3;
    const order: ShiftType[] = ["Malam","Pagi","Sore"];
    const target: Record<ShiftType,number> = {Malam:per, Pagi:per, Sore:per};
    for(let k=0;k<rem;k++) target[order[(i+k)%3]]++;
    return target as unknown as Record<string,number>;
  });
}

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
  return runSchedulerV2({ names, year, month, daysInMonth, startDay, existingCounts, prev: prevInput||[], cuti: cutiInput||[] });
}

export function runSchedulerV2(input: SchedulerInput): SchedulerResult {
  const { names, year, month, daysInMonth:N, cuti: cutiInput } = input;
  let startDay = input.startDay || 1;
  if(startDay<1) startDay=1; if(startDay>N) startDay=N;
  const prev: PrevDay[] = (input.prev||[]).slice(-2); // keep last 2
  const existingCounts = input.existingCounts;

  const totalSlots = 3 * (N - startDay + 1);
  const base = Math.floor(totalSlots / 5);
  const extra = totalSlots - base*5;

  // Build person state
  const cutiByName = new Map<string, Set<number>>();
  (cutiInput||[]).forEach(c=>{
    const key=normName(c.person);
    const s=new Set<number>();
    (c.days||[]).forEach(d=>{ if(d>=startDay && d<=N) s.add(d); });
    // merge if same name multiple entries
    if(cutiByName.has(key)){
      const prevSet=cutiByName.get(key)!;
      s.forEach(v=> prevSet.add(v));
    } else cutiByName.set(key,s);
  });

  const people: Person[] = names.map((n,i)=>{
    const rawTargetBase = base + (i < extra ? 1 : 0);
    const perTypeBase = Math.floor(rawTargetBase/3);
    let rem = rawTargetBase - perTypeBase*3;
    const order: ShiftType[] = ["Malam","Pagi","Sore"];
    const target: Record<ShiftType,number> = {Malam:perTypeBase, Pagi:perTypeBase, Sore:perTypeBase};
    for(let k=0;k<rem;k++) target[order[(i+k)%3]]++;
    const already = (existingCounts && existingCounts[i]) ? existingCounts[i] : {Malam:0,Pagi:0,Sore:0};
    // Remaining cannot be negative — if already exceeds target, target expands to keep total fair (bug fix)
    const remaining: Record<ShiftType,number> = {
      Malam: Math.max(0, target.Malam - (already.Malam||0)),
      Pagi: Math.max(0, target.Pagi - (already.Pagi||0)),
      Sore: Math.max(0, target.Sore - (already.Sore||0)),
    };
    // If already beyond target, absorb by increasing target
    for(const t of SHIFT_TYPES){
      if((already[t]||0) > target[t]) {
        const diff=(already[t]||0)-target[t];
        target[t]+=diff;
        remaining[t]=0;
      }
    }
    // Include cuti days as off, reduce target proportionally? Keep target, but person will be unavailable those days.
    const key=normName(n);
    const cutiSet = cutiByName.get(key) || new Set<number>();
    return {
      name:n, counts:{...already} as Record<ShiftType,number>,
      target, remaining, totalShifts: (already.Malam||0)+(already.Pagi||0)+(already.Sore||0),
      offCount:0, cooldownUntil:startDay, consec:0,
      pendingType:null, pendingContinueDay:null, lastBlockType:null, lastType:null,
      cutiSet, cutiDays: cutiSet.size, maxStreak:0, curStreak:0, _rand: Math.random()
    };
  });

  // Seed state from prev 2 days to enforce no collision on tgl 1-2
  // Build lookup: name -> last duties on -2, -1
  type Hist = { dayOffset:number, type: ShiftType | 'OFF' };
  const histByName = new Map<string, Hist[]>();
  people.forEach(p=> histByName.set(normName(p.name), []));
  prev.forEach((pd, idx)=>{
    const offset = prev.length===2 ? (idx===0?-2:-1) : -1; // if only 1 provided, treat as -1
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
      else if(offSet.has(key)) arr.push({dayOffset:offset, type:'OFF'});
      else arr.push({dayOffset:offset, type:'OFF'}); // assume off if not listed
    });
  });

  // Initialize cooldown/pending/lastBlock from history
  people.forEach(p=>{
    const key=normName(p.name);
    const h=histByName.get(key)!;
    // Sort by offset ascending
    h.sort((a,b)=>a.dayOffset-b.dayOffset);
    if(h.length===0) return;
    // Check last 2 days were same type without gap => pending continuation
    // But spec: if last day (-1) is a work day, and day -2 same type, then person already did 2-day block => must be off on day 1
    // If last day (-1) is work but -2 different/off => person did 1st day of block => should continue same type on day startDay
    const last = h[h.length-1];
    const secondLast = h.length>=2 ? h[h.length-2] : null;
    if(last.type!=='OFF'){
      if(secondLast && secondLast.type===last.type){
        // completed 2-day block ending at -1 -> cooldown 2 days: off on 1 and 2
        p.cooldownUntil = startDay+2;
        p.lastBlockType = last.type;
        p.lastType = last.type;
        p.consec = 0;
      } else {
        // single day block starting at -1 -> need to continue same type on startDay
        p.pendingType = last.type;
        p.pendingContinueDay = startDay;
        p.consec = 1;
        p.lastType = last.type;
        p.lastBlockType = null;
        p.cooldownUntil = startDay; // will be set after completing
      }
    } else {
      // last was OFF -> free to start new block
      p.cooldownUntil = startDay;
      p.lastType = null;
      p.consec = 0;
      // infer lastBlockType from most recent work before OFF if any
      const lastWork = [...h].reverse().find(x=> x.type!=='OFF');
      if(lastWork) p.lastBlockType = lastWork.type as ShiftType;
    }
    // also track streak
    // curStreak not seeded from prev (start fresh)
  });

  const FORWARD_NEXT: Record<ShiftType,ShiftType> = {Malam:"Pagi", Pagi:"Sore", Sore:"Malam"};
  const schedule: DayRecord[] = [];
  const warnings: string[] = [];

  // Safety: prevent infinite loops
  for(let d=startDay; d<=N; d++){
    const dateObj = new Date(year, month, d);
    const dow = dateObj.getDay();
    const slot: Partial<Record<ShiftType,number>> = {};
    const usedToday = new Set<number>();
    const cutiToday = new Set<number>();
    people.forEach((p,i)=>{ if(p.cutiSet.has(d)) cutiToday.add(i); });

    // 1) pending continuations (must go first, even over cuti? but cuti overrides pending -> warning)
    for(let i=0;i<5;i++){
      const p=people[i];
      if(p.pendingType && p.pendingContinueDay===d){
        if(cutiToday.has(i)){
          warnings.push(`Hari ${d}: ${p.name} jadwal lanjut ${p.pendingType} tapi cuti — dialihkan.`);
          // skip this pending, treat as cooldown gap; reset pending
          p.pendingType=null; p.pendingContinueDay=null; p.cooldownUntil=d+1; p.consec=0;
          continue;
        }
        // enforce even if cooldown? pending overrides
        slot[p.pendingType]=i;
        usedToday.add(i);
        p.counts[p.pendingType]++; p.totalShifts++;
        p.remaining[p.pendingType]=Math.max(0,p.remaining[p.pendingType]-1);
        p.cooldownUntil=d+2; p.lastBlockType=p.pendingType; p.lastType=p.pendingType;
        p.pendingType=null; p.pendingContinueDay=null; p.consec=0; p.curStreak=0;
      }
    }

    const emptyTypes = (SHIFT_TYPES as readonly ShiftType[]).filter(t=> !(t in slot));
    // If 3 types empty and we are near month end, allow short blocks to avoid impossible
    const forceShortIndex = (emptyTypes.length===3 && d>=N) ? Math.floor(Math.random()*3) : -1;

    for(let idx=0; idx<emptyTypes.length; idx++){
      const type = emptyTypes[idx];
      // pool: available (cooldown ok, not cuti, not used today)
      let pool = people.map((_,i)=>i).filter(i=> !usedToday.has(i) && !cutiToday.has(i) && people[i].cooldownUntil <= d);
      if(pool.length===0){
        // try pool ignoring cooldown but respecting cuti
        pool = people.map((_,i)=>i).filter(i=> !usedToday.has(i) && !cutiToday.has(i));
        if(pool.length>0){
          warnings.push(`Hari ${d} ${type}: semua orang masih cooldown/baru blok 2 hari — rotasi terpaksa dilanggar.`);
        } else {
          warnings.push(`Hari ${d} ${type}: semua orang cuti/tidak tersedia — slot kosong!`);
          continue; // leave slot empty (should not happen with 5 people unless >3 cuti same day)
        }
      }
      // Prefer forward rotation (Malam->Pagi->Sore->Malam)
      // Also enforce: if someone would be assigned same type as lastBlockType but pool has alternative forward, deprioritize
      const forwardPool = pool.filter(i=>{
        const last=people[i].lastBlockType;
        if(!last) return true;
        return FORWARD_NEXT[last]===type;
      });
      let candidates = forwardPool.length>0 ? forwardPool : pool;
      if(forwardPool.length===0 && pool.length>0){
        // only warn if we had to break forward
        // but not if person's lastBlock is null
        const anyWithLast = pool.some(i=> people[i].lastBlockType!=null);
        if(anyWithLast) warnings.push(`Hari ${d} ${type}: terpaksa shift mundur (bukan ${Object.entries(FORWARD_NEXT).map(([k,v])=>`${k}→${v}`).join(', ')}) karena ketersediaan.`);
      }

      // Secondary filter: respect remaining fairness
      // Sort by score
      candidates.sort((a,b)=>{
        const pa=people[a], pb=people[b];
        // remaining for this type descending
        if(pb.remaining[type]!==pa.remaining[type]) return pb.remaining[type]-pa.remaining[type];
        // total remaining descending (overall need)
        const ra=pa.remaining.Malam+pa.remaining.Pagi+pa.remaining.Sore;
        const rb=pb.remaining.Malam+pb.remaining.Pagi+pb.remaining.Sore;
        if(rb!==ra) return rb-ra;
        // totalShifts ascending (balance)
        if(pa.totalShifts!==pb.totalShifts) return pa.totalShifts - pb.totalShifts;
        // cooldownUntil ascending
        if(pa.cooldownUntil!==pb.cooldownUntil) return pa.cooldownUntil - pb.cooldownUntil;
        // streak: prefer shorter curStreak
        if(pa.curStreak!==pb.curStreak) return pa.curStreak - pb.curStreak;
        return pa._rand - pb._rand;
      });
      const chosen=candidates[0];
      const p=people[chosen];
      slot[type]=chosen; usedToday.add(chosen);
      p.counts[type]++; p.totalShifts++; p.remaining[type]=Math.max(0,p.remaining[type]-1);
      p.lastType=type;
      // Determine if this should be 2-day block
      const makeShort = (idx===forceShortIndex) || (d===N) || p.cutiSet.has(d+1); // don't start block if cuti tomorrow
      if(d+1<=N && !makeShort){
        p.pendingType=type; p.pendingContinueDay=d+1; p.consec=1;
        // p.cooldownUntil stays until block completes
      } else {
        p.cooldownUntil=d+2; p.lastBlockType=type; p.consec=0;
      }
    }

    // Build day record
    const dayRecord: DayRecord = { day:d, date:dateObj, dow, assign:{} as Record<ShiftType,string>, off:[] };
    for(const t of SHIFT_TYPES){
      const idx=slot[t];
      if(idx!==undefined) dayRecord.assign[t]=people[idx].name;
      else dayRecord.assign[t]="(kosong)";
    }
    for(let i=0;i<5;i++){
      if(!usedToday.has(i)){
        people[i].offCount++;
        people[i].curStreak=0; // reset streak on off
        dayRecord.off.push(people[i].name);
      } else {
        people[i].curStreak++;
        people[i].maxStreak=Math.max(people[i].maxStreak, people[i].curStreak);
      }
    }
    schedule.push(dayRecord);
  }

  // Fairness metric: stddev of totalShifts
  const totals=people.map(p=> p.totalShifts);
  const avg=totals.reduce((a,b)=>a+b,0)/totals.length;
  const variance=totals.reduce((a,b)=> a+ (b-avg)*(b-avg),0)/totals.length;
  const fairness = Math.sqrt(variance);
  const coverage = schedule.every(r=> SHIFT_TYPES.every(t=> r.assign[t]!=="(kosong)")) ? 100 : Math.round(schedule.filter(r=> SHIFT_TYPES.every(t=> r.assign[t]!=="(kosong)")).length / schedule.length *100);

  // Final validationWarnings
  for(const p of people){
    const remTotal=p.remaining.Malam+p.remaining.Pagi+p.remaining.Sore;
    if(remTotal>0) warnings.push(`${p.name}: sisa jatah ${remTotal} shift tidak terpenuhi karena cuti/cooldown.`);
  }

  return { people, schedule, warnings, daysInMonth:N, month, year, startDay, prev, cuti: (cutiInput||[]), stats:{ totalSlots, fairness: Number(fairness.toFixed(2)), coverage } };
}

export function weekNumberFor(dateObj: Date, firstDate: Date){
  let wk=1; const d0=new Date(firstDate); const cur=new Date(dateObj); const cursor=new Date(d0);
  while(cursor < cur){ cursor.setDate(cursor.getDate()+1); if(cursor.getDay()===1) wk++; }
  return wk;
}
