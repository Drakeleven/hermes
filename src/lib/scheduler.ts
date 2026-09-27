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
  backupRank: number;
  izinDays: number[];
  _rand: number;
};

export type DayRecord = { 
  day: number; 
  date: Date; 
  dow: number; 
  assign: Record<ShiftType, string>; 
  off: string[];
  leaves: string[];
  izins: string[];
};

export type LeaveRequest = {
  name: string;
  day: number;
};

export type IzinRequest = {
  name: string;
  day: number;
  swapDay?: number;
};

export type PrevShift = {
  day: number;
  assign: Record<ShiftType, string>;
};

export type SchedulerResult = { 
  people: Person[]; 
  schedule: DayRecord[]; 
  warnings: string[]; 
  daysInMonth: number 
};

export function weekNumberFor(d: Date, firstDate: Date): number {
  const diff = d.getTime() - firstDate.getTime();
  const dayIdx = Math.floor(diff / (1000 * 60 * 60 * 24));
  const firstDayDow = firstDate.getDay();
  const offset = firstDayDow === 0 ? 6 : firstDayDow - 1; 
  return Math.floor((dayIdx + offset) / 7) + 1;
}

export function runSchedulerV3(
  names: string[], 
  year: number, 
  month: number, 
  daysInMonth: number, 
  startDay: number, 
  existingCounts: Record<ShiftType, number>[] | null,
  prevShifts: PrevShift[] = [],
  leaves: LeaveRequest[] = [],
  izins: IzinRequest[] = [],
  backupRanks: number[] = [1,2,3,4,5]
): SchedulerResult {
  const N = daysInMonth;
  startDay = startDay || 1;
  
  // Target kaku sesuai request: 18 total, 6-7 per shift
  const TARGET_TOTAL = 18;
  const TARGET_PER_TYPE = 6; 

  const people: Person[] = names.map((n, i) => {
    const target: Record<ShiftType, number> = { Malam: TARGET_PER_TYPE, Pagi: TARGET_PER_TYPE, Sore: TARGET_PER_TYPE };
    // Jika 18 total dan min 6 per tipe, maka 6+6+6=18. Pas.
    
    const already = (existingCounts && existingCounts[i]) ? existingCounts[i] : { Malam: 0, Pagi: 0, Sore: 0 };
    const remaining: Record<ShiftType, number> = {
      Malam: Math.max(0, target.Malam - already.Malam),
      Pagi: Math.max(0, target.Pagi - already.Pagi),
      Sore: Math.max(0, target.Sore - already.Sore),
    };

    let cooldown = startDay;
    let pending: ShiftType | null = null;
    let pendingDay: number | null = null;
    let lastType: ShiftType | null = null;

    const sortedPrev = [...prevShifts].sort((a, b) => b.day - a.day);
    if (sortedPrev.length > 0) {
      const lastDay = sortedPrev[0];
      const type = (Object.keys(lastDay.assign) as ShiftType[]).find(k => lastDay.assign[k] === n);
      if (type) {
        lastType = type;
        const prevPrevDay = sortedPrev[1];
        const prevType = prevPrevDay ? (Object.keys(prevPrevDay.assign) as ShiftType[]).find(k => prevPrevDay.assign[k] === n) : null;
        if (prevType === type) cooldown = startDay + 1;
        else { pending = type; pendingDay = startDay; }
      }
    }

    return { 
      name: n, counts: { ...already }, target, remaining, 
      totalShifts: already.Malam + already.Pagi + already.Sore, 
      offCount: 0, cooldownUntil: cooldown, 
      pendingType: pending, pendingContinueDay: pendingDay, 
      lastBlockType: lastType,
      backupRank: backupRanks[i] || (i + 1),
      izinDays: izins.filter(iz => iz.name === n).map(iz => iz.day),
      _rand: Math.random() 
    };
  });

  const FORWARD_NEXT: Record<ShiftType, ShiftType> = { Malam: "Pagi", Pagi: "Sore", Sore: "Malam" };
  const schedule: DayRecord[] = [];
  const warnings: string[] = [];

  for (let d = startDay; d <= N; d++) {
    const dateObj = new Date(year, month, d);
    const dow = dateObj.getDay();
    const slot: Partial<Record<ShiftType, number>> = {};
    const usedToday = new Set<number>();
    const leavesToday = leaves.filter(l => l.day === d).map(l => l.name);
    const izinsToday = izins.filter(iz => iz.day === d).map(iz => iz.name);

    // 1. Forced pending (2nd day of block)
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (p.pendingType && p.pendingContinueDay === d) {
        if (leavesToday.includes(p.name) || izinsToday.includes(p.name)) {
          // Jika cuti/izin, batalkan pending, cari orang lain nanti di step 2
          p.pendingType = null;
          p.pendingContinueDay = null;
          continue;
        }
        slot[p.pendingType] = i;
        usedToday.add(i);
        p.counts[p.pendingType]++;
        p.totalShifts++;
        p.remaining[p.pendingType] = Math.max(0, p.remaining[p.pendingType] - 1);
        p.cooldownUntil = d + 2;
        p.lastBlockType = p.pendingType;
        p.pendingType = null;
        p.pendingContinueDay = null;
      }
    }

    // 2. Fill empty slots
    for (const type of SHIFT_TYPES) {
      if (slot[type] !== undefined) continue;

      const candidates = [];
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        if (usedToday.has(i)) continue;
        if (leavesToday.includes(p.name)) continue;
        if (izinsToday.includes(p.name)) continue;
        if (d < p.cooldownUntil) continue;

        const nextTarget = p.lastBlockType ? FORWARD_NEXT[p.lastBlockType] : null;
        if (nextTarget && type !== nextTarget) continue;

        if (p.remaining[type] > 0) candidates.push(i);
      }

      if (candidates.length === 0) {
        // Emergency: Abaikan sequence & cooldown jika benar2 kosong karena cuti massal
        for (let i = 0; i < people.length; i++) {
          const p = people[i];
          if (usedToday.has(i)) continue;
          if (leavesToday.includes(p.name)) continue;
          if (izinsToday.includes(p.name)) continue;
          candidates.push(i);
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const pa = people[a], pb = people[b];
          // Prioritas: Sisa jatah terbanyak -> Backup rank terkecil -> Random
          if (pa.remaining[type] !== pb.remaining[type]) return pb.remaining[type] - pa.remaining[type];
          if (pa.backupRank !== pb.backupRank) return pa.backupRank - pb.backupRank;
          return pa._rand - pb._rand;
        });
        const chosenIdx = candidates[0];
        const p = people[chosenIdx];
        slot[type] = chosenIdx;
        usedToday.add(chosenIdx);
        
        p.counts[type]++;
        p.totalShifts++;
        p.remaining[type] = Math.max(0, p.remaining[type] - 1);
        p.pendingType = type;
        p.pendingContinueDay = d + 1;
      } else {
        warnings.push(`Tgl ${d}: Slot ${type} kosong.`);
      }
    }

    const assign: Record<ShiftType, string> = { Malam: "-", Pagi: "-", Sore: "-" };
    const off: string[] = [];
    SHIFT_TYPES.forEach(t => { if (slot[t] !== undefined) assign[t] = people[slot[t]].name; });
    names.forEach(n => { if (!Object.values(assign).includes(n) && !leavesToday.includes(n) && !izinsToday.includes(n)) off.push(n); });

    schedule.push({ day: d, date: dateObj, dow, assign, off, leaves: leavesToday, izins: izinsToday });
    people.forEach(p => p._rand = Math.random());
  }

  return { people, schedule, warnings, daysInMonth };
}
