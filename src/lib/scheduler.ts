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
export type DayRecord = { day: number; date: Date; dow: number; assign: Record<ShiftType,string>; off: string[]; leaves: string[]; izins: string[] };
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
  backupOrder: string[];
  extraShiftAssign?: Record<ShiftType, string>; // Specify who gets extra shift on 31-day months
};

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
  const { names, year, month, daysInMonth:N, cuti: cutiInput, izin: izinInput, backupOrder, extraShiftAssign } = input;
  let startDay = input.startDay || 1;
  if(startDay<1) startDay=1; if(startDay>N) startDay=N;
  
  // Accept lookback as long as user inputs
  const prev: PrevDay[] = (input.prev||[]);
  const existingCounts = input.existingCounts;

  const totalSlots = 3 * (N - startDay + 1);

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
    izinByName.get(key)!.add(m.from);
    izinMoves.push(m);
  });

  const backupRank = new Map<string, number>();
  const ordered = (backupOrder && backupOrder.length? backupOrder : names);
  ordered.forEach((n,i)=>{
    const key=normName(n);
    if(!backupRank.has(key)) backupRank.set(key,i);
  });
  names.forEach(n=>{
    const k=normName(n);
    if(!backupRank.has(k)) backupRank.set(k, 999);
  });

  const people: Person[] = names.map((n,i)=>{
    // Base is 18 (6/6/6)
    const target: Record<ShiftType,number> = {Malam: 6, Pagi: 6, Sore: 6};
    
    // On 31-day months (total 93 shifts), 3 extra shifts must be distributed (+1 per type)
    if (N === 31 && extraShiftAssign) {
      SHIFT_TYPES.forEach(t => {
        if (extraShiftAssign[t] && normName(extraShiftAssign[t]) === normName(n)) {
          target[t] += 1; // total target for this person becomes 19 for this shift
        }
      });
    }

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

  // Seed from previous days history (dynamic lookback)
  type Hist = { dayOffset:number, type: ShiftType | 'OFF' };
  const histByName = new Map<string, Hist[]>();
  people.forEach(p=> histByName.set(normName(p.name), []));
  prev.forEach((pd, idx)=>{
    const offset = idx - prev.length; // e.g. -2, -1
    const assignMap = new Map<string, ShiftType>();
    for(const t of SHIFT_TYPES){
      const nm = (pd.assign as Record<string,string>)[t];
      if(nm) assignMap.set(normName(nm), t as ShiftType);
    }
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

  for(let d=startDay; d<=N; d++){
    const dateObj = new Date(year, month, d);
    const dow = dateObj.getDay();
    const slot: Partial<Record<ShiftType,number>> = {};
    const usedToday = new Set<number>();
    const cutiToday = new Set<number>();
    people.forEach((p,i)=>{ if(p.cutiSet.has(d)) cutiToday.add(i); });

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
      let pool = people.map((_,i)=>i).filter(i=> {
        if (usedToday.has(i) || cutiToday.has(i)) return false;
        if (people[i].cooldownUntil > d) return false;
        const limit = (N === 31 && extraShiftAssign && Object.values(extraShiftAssign).some(val => normName(val) === normName(people[i].name))) ? 19 : 18;
        if (people[i].totalShifts >= limit) return false;
        return true;
      });
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
      
      const hasCutiToday = cutiToday.size>0;
      candidates.sort((a,b)=>{
        const pa=people[a], pb=people[b];
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

    const dayRecord: DayRecord = { day:d, date:dateObj, dow, assign:{} as Record<ShiftType,string>, off:[], leaves: [], izins: [] };
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

  // Phase 2: Izin swaps
  const swaps: IzinSwap[] = [];
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
    
    let fromShift: ShiftType | null = null;
    for(const t of SHIFT_TYPES) if(dayRec.assign[t]===p.name) fromShift=t;
    if(!fromShift){
      warnings.push(`Izin ${p.name} tgl ${mv.from}: sudah libur hari itu — tidak perlu pindah.`);
      continue;
    }
    
    const izinDayCuti = new Set<number>();
    people.forEach((pp,i)=>{ if(pp.cutiSet.has(mv.from)) izinDayCuti.add(i); });
    const offCandidates = dayRec.off.map(n=>{
      const idx=people.findIndex(pp=> pp.name===n);
      return idx;
    }).filter(idx=> idx!==-1 && !izinDayCuti.has(idx));
    if(offCandidates.length===0){
      warnings.push(`Izin ${p.name} tgl ${mv.from} ${fromShift}: tidak ada backup off yang tersedia — izin ditunda.`);
      continue;
    }
    
    offCandidates.sort((a,b)=>{
      const ra=backupRank.get(normName(people[a].name))??999;
      const rb=backupRank.get(normName(people[b].name))??999;
      if(ra!==rb) return ra-rb;
      return people[a].totalShifts - people[b].totalShifts;
    });
    const backupIdx = offCandidates[0];
    const backupName = people[backupIdx].name;

    let toDay: number | null = mv.to ?? null;
    let toShift: ShiftType | null = null;
    let swappedWith: string | null = null;

    const isValidReplacement = (d: number, shift: ShiftType): boolean => {
      if(d<=mv.from || d<startDay || d> N) return false;
      if(p.cutiSet.has(d) || p.izinSet.has(d)) return false;
      const rec=schedule.find(r=> r.day===d);
      if(!rec) return false;
      if(rec.assign[shift]===p.name) return false;
      if(rec.assign[shift]==="(kosong)") return true;
      if(!rec.off.includes(p.name)) return false;
      const candIdx=people.findIndex(pp=> pp.name===rec.assign[shift]);
      if(candIdx!==-1 && people[candIdx].cutiSet.has(d)) return false;
      return true;
    };

    if(toDay!==null){
      const rec=schedule.find(r=> r.day===toDay);
      if(!rec || !rec.off.includes(p.name)){
        warnings.push(`Izin ${p.name} tgl ${mv.from}→${toDay}: tgl tujuan bukan hari libur ${p.name} — auto cari tgl lain.`);
        toDay=null;
      } else {
        if(rec.assign[fromShift] && rec.assign[fromShift]!=="(kosong)" && !people.find(pp=> pp.name===rec.assign[fromShift])?.cutiSet.has(toDay)){
          toShift=fromShift; swappedWith=rec.assign[fromShift];
        } else {
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
      let found=false;
      for(let d=mv.from+1; d<=N && !found; d++){
        if(p.cutiSet.has(d) || p.izinSet.has(d)) continue;
        const rec=schedule.find(r=> r.day===d);
        if(!rec || !rec.off.includes(p.name)) continue;
        if(isValidReplacement(d, fromShift)){
          toDay=d; toShift=fromShift; swappedWith=rec.assign[fromShift]; found=true; break;
        }
        for(const t of SHIFT_TYPES){
          if(t===fromShift) continue;
          if(isValidReplacement(d,t)){ toDay=d; toShift=t; swappedWith=rec.assign[t]; found=true; break; }
        }
      }
      if(!found){
        warnings.push(`Izin ${p.name} tgl ${mv.from} ${fromShift}: tidak ada tgl pengganti kosong.`);
        continue;
      }
    }

    dayRec.assign[fromShift]=backupName;
    dayRec.off = dayRec.off.filter(n=> n!==backupName);
    if(!dayRec.off.includes(p.name)) dayRec.off.push(p.name);
    
    p.counts[fromShift]--;
    people[backupIdx].counts[fromShift]++;

    const toRec=schedule.find(r=> r.day===toDay!)!;
    const occName=toRec.assign[toShift!];
    const occIdx=people.findIndex(pp=> pp.name===occName);
    toRec.assign[toShift!]=p.name;
    toRec.off = toRec.off.filter(n=> n!==p.name);
    if(occIdx!==-1){
      toRec.off.push(occName);
      people[occIdx].counts[toShift!]--;
      people[occIdx].totalShifts--;
      swappedWith=occName;
    } else {
      swappedWith="(kosong)";
      toRec.off = toRec.off.filter(n=> n!==p.name);
    }
    p.counts[toShift!]++;
    people[backupIdx].totalShifts++;
    if(occIdx!==-1) people[occIdx].totalShifts--;
    
    swaps.push({ person:p.name, fromDay: mv.from, fromShift, toDay: toDay!, toShift: toShift!, swappedWith, backupOnFrom: backupName });
  }

  people.forEach(p=>{ p.offCount=0; p.curStreak=0; p.maxStreak=0; });
  for(const r of schedule){
    for(let i=0;i<people.length;i++){
      const pp=people[i];
      if(r.off.includes(pp.name)){
        pp.offCount++; pp.curStreak=0;
      } else {
        pp.curStreak++; pp.maxStreak=Math.max(pp.maxStreak, pp.curStreak);
      }
    }
  }

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
