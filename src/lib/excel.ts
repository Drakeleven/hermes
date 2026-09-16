import * as XLSX from "xlsx";
import { MONTH_NAMES, DOW_NAMES, SHIFT_TYPES, weekNumberFor } from "./scheduler";
import type { SchedulerResult, DayRecord } from "./scheduler";

export function downloadExcel(result: SchedulerResult, month: number, year: number) {
  if (!result) return;
  const wb = XLSX.utils.book_new();
  const header = ["Tanggal","Hari","Malam (23.00-07.00)","Pagi (07.00-15.00)","Sore (15.00-23.00)","Libur","Cuti","Izin→Pindah"];
  const schedRows: (string | number)[][] = [header];
  // build map fromDay -> swap info
  const izinFromMap = new Map<number, string>();
  (result.swaps||[]).forEach(s=> izinFromMap.set(s.fromDay, `${s.person} izin ${s.fromShift} tgl ${s.fromDay} → tgl ${s.toDay} ${s.toShift} (ganti ${s.swappedWith}), backup ${s.backupOnFrom}`));
  result.schedule.forEach(r=> {
    const cutiOnDay = result.cuti.filter(c=> c.days.includes(r.day)).map(c=>c.person).join(", ") || "-";
    const izinNote = izinFromMap.get(r.day) || (r.day && result.izin.some(z=> z.from===r.day) ? "izin" : "-");
    schedRows.push([`${r.day} ${MONTH_NAMES[month]} ${year}`, DOW_NAMES[r.dow], r.assign.Malam, r.assign.Pagi, r.assign.Sore, r.off.join(" & "), cutiOnDay, izinNote]);
  });
  if(result.prev && result.prev.length){
    const prevRows: (string|number)[][] = [["-- 2 HARI SEBELUM BULAN INI (input) --"]];
    result.prev.forEach((pd,i)=>{
      prevRows.push([`H-${result.prev.length-i}`, "", pd.assign.Malam, pd.assign.Pagi, pd.assign.Sore, pd.off.join(" & "), "", ""]);
    });
    prevRows.push([]);
    schedRows.splice(1,0, ...prevRows);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(schedRows);
  (ws1 as unknown as Record<string, unknown>)["!cols"]=[{wch:20},{wch:10},{wch:16},{wch:16},{wch:16},{wch:24},{wch:18},{wch:42}];
  XLSX.utils.book_append_sheet(wb, ws1, "Jadwal Harian");

  const firstDate=result.schedule[0].date;
  const weeks: Record<number,DayRecord[]> = {};
  result.schedule.forEach(row=>{ const wk=weekNumberFor(row.date, firstDate); if(!weeks[wk]) weeks[wk]=[]; weeks[wk].push(row); });
  const weekRows: (string|number)[][] = [["Minggu","Rentang Tanggal","Nama","Malam","Pagi","Sore","Libur","Cuti","Izin","Total Shift"]];
  Object.keys(weeks).sort((a,b)=>Number(a)-Number(b)).forEach(wk=>{
    const rows=weeks[Number(wk)]; const rangeLabel=`${rows[0].day} - ${rows[rows.length-1].day} ${MONTH_NAMES[month]}`;
    const per: Record<string,Record<string,number>> = {};
    result.people.forEach(p=> per[p.name]={Malam:0,Pagi:0,Sore:0,Off:0,Cuti:0});
    rows.forEach(r=>{ SHIFT_TYPES.forEach(t=> per[r.assign[t]][t]++); r.off.forEach(n=> per[n].Off++); });
    result.people.forEach(p=>{
      const cutiCnt = result.cuti.find(x=> x.person===p.name)?.days.filter(d=> rows.some(r=> r.day===d)).length || 0;
      const izinCnt = result.swaps.filter(s=> s.person===p.name && rows.some(r=> r.day===s.fromDay)).length;
      const c=per[p.name];
      weekRows.push([`Minggu ${wk}`,rangeLabel,p.name,c.Malam,c.Pagi,c.Sore,c.Off - cutiCnt,cutiCnt,izinCnt,c.Malam+c.Pagi+c.Sore]);
    });
  });
  const ws2=XLSX.utils.aoa_to_sheet(weekRows);
  (ws2 as unknown as Record<string, unknown>)["!cols"]=[{wch:10},{wch:18},{wch:16},{wch:8},{wch:8},{wch:8},{wch:8},{wch:8},{wch:8},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws2, "Rekap Mingguan");

  const monthRows: (string|number)[][] = [["Nama","Target Malam","Target Pagi","Target Sore","Realisasi Malam","Realisasi Pagi","Realisasi Sore","Libur","Cuti","Izin","Total Shift","Max Streak"]];
  result.people.forEach(p=> monthRows.push([p.name, p.target.Malam, p.target.Pagi, p.target.Sore, p.counts.Malam, p.counts.Pagi, p.counts.Sore, p.offCount, p.cutiDays, p.izinDays, p.totalShifts, p.maxStreak]));
  monthRows.push([]);
  monthRows.push(["Backup Order (prioritas pengganti cuti/izin)", (result.backupOrder||[]).join(" → ")]);
  monthRows.push(["Fairness (stddev)", result.stats.fairness, "Coverage", result.stats.coverage+"%"]);
  if(result.swaps.length){ monthRows.push([]); monthRows.push(["Izin Swaps (pindah tanpa kurang proporsi)"]); result.swaps.forEach(s=> monthRows.push([`${s.person}: tgl ${s.fromDay} ${s.fromShift} → tgl ${s.toDay} ${s.toShift} | backup ${s.backupOnFrom} isi tgl ${s.fromDay}, ${s.swappedWith} diganti`])) ;}
  if(result.warnings.length) { monthRows.push([]); monthRows.push(["Catatan"]); result.warnings.forEach(w=> monthRows.push([w])); }
  const ws3=XLSX.utils.aoa_to_sheet(monthRows);
  (ws3 as unknown as Record<string, unknown>)["!cols"]=[{wch:16},{wch:12},{wch:12},{wch:12},{wch:14},{wch:14},{wch:14},{wch:10},{wch:10},{wch:10},{wch:12},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws3, "Rekap Bulanan");

  const cutiRows: (string|number)[][] = [["Nama","Tanggal Cuti","Jumlah"]];
  result.cuti.forEach(c=> cutiRows.push([c.person, c.days.sort((a,b)=>a-b).join(", ")||"-", c.days.length]));
  if(result.cuti.length===0) cutiRows.push(["-","-","0"]);
  const ws4=XLSX.utils.aoa_to_sheet(cutiRows);
  (ws4 as unknown as Record<string, unknown>)["!cols"]=[{wch:16},{wch:32},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws4, "Daftar Cuti");

  const izinRows: (string|number)[][] = [["Nama","Izin Tgl","Pindah Ke Tgl","Shift Asal→Tujuan","Backup Pengganti","Diganti"]];
  if(result.swaps.length===0) izinRows.push(["-","-","-","-","-","-"]);
  else result.swaps.forEach(s=> izinRows.push([s.person, s.fromDay, s.toDay, `${s.fromShift}→${s.toShift}`, s.backupOnFrom, s.swappedWith]));
  const ws5=XLSX.utils.aoa_to_sheet(izinRows);
  (ws5 as unknown as Record<string, unknown>)["!cols"]=[{wch:14},{wch:12},{wch:14},{wch:16},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws5, "Izin Pindah");

  XLSX.writeFile(wb, `Jadwal-Shift-${MONTH_NAMES[month]}-${year}.xlsx`);
}
