export const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"] as const;
export const DOW_NAMES = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"] as const;
export const SHIFT_TYPES = ["Malam","Pagi","Sore"] as const;
export type ShiftType = typeof SHIFT_TYPES[number];

export type Person = {
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
export type DayRecord = { day: number; date: Date; dow: number; assign: Record<ShiftType,string>; off: string[] };
export type SchedulerResult = { people: Person[]; schedule: DayRecord[]; warnings: string[]; daysInMonth: number };

export function runScheduler(names: string[], year: number, month:number, daysInMonth:number, startDay:number, existingCounts: Record<ShiftType,number>[] | null): SchedulerResult {
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

export function weekNumberFor(dateObj: Date, firstDate: Date){
  let wk=1; const d0=new Date(firstDate); const cur=new Date(dateObj); const cursor=new Date(d0);
  while(cursor < cur){ cursor.setDate(cursor.getDate()+1); if(cursor.getDay()===1) wk++; }
  return wk;
}
