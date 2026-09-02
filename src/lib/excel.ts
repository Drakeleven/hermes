import * as XLSX from "xlsx";
import { MONTH_NAMES, DOW_NAMES, SHIFT_TYPES, weekNumberFor } from "./scheduler";
import type { SchedulerResult, DayRecord } from "./scheduler";

export function downloadExcel(result: SchedulerResult, month: number, year: number) {
  if (!result) return;
  const wb = XLSX.utils.book_new();
  const schedRows: (string | number)[][] = [["Tanggal","Hari","Malam (23.00-07.00)","Pagi (07.00-15.00)","Sore (15.00-23.00)","Libur"]];
  result.schedule.forEach(r=> schedRows.push([`${r.day} ${MONTH_NAMES[month]} ${year}`, DOW_NAMES[r.dow], r.assign.Malam, r.assign.Pagi, r.assign.Sore, r.off.join(" & ")]));
  const ws1 = XLSX.utils.aoa_to_sheet(schedRows);
  (ws1 as unknown as Record<string, unknown>)["!cols"]=[{wch:20},{wch:10},{wch:16},{wch:16},{wch:16},{wch:22}];
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
  (ws2 as unknown as Record<string, unknown>)["!cols"]=[{wch:10},{wch:18},{wch:16},{wch:8},{wch:8},{wch:8},{wch:8},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws2, "Rekap Mingguan");
  const monthRows: (string|number)[][] = [["Nama","Total Malam","Total Pagi","Total Sore","Total Libur","Total Shift Bulan Ini"]];
  result.people.forEach(p=> monthRows.push([p.name, p.counts.Malam, p.counts.Pagi, p.counts.Sore, p.offCount, p.totalShifts]));
  const ws3=XLSX.utils.aoa_to_sheet(monthRows);
  (ws3 as unknown as Record<string, unknown>)["!cols"]=[{wch:16},{wch:12},{wch:12},{wch:12},{wch:12},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws3, "Rekap Bulanan");
  XLSX.writeFile(wb, `Jadwal-Shift-${MONTH_NAMES[month]}-${year}.xlsx`);
}
