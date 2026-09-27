import * as XLSX from "xlsx";
import { MONTH_NAMES, DOW_NAMES, SHIFT_TYPES, weekNumberFor } from "./scheduler";
import type { SchedulerResult, DayRecord } from "./scheduler";

export function downloadExcel(result: SchedulerResult, month: number, year: number) {
  if (!result) return;
  const wb = XLSX.utils.book_new();
  const header = ["Tanggal","Hari","Malam (23.00-07.00)","Pagi (07.00-15.00)","Sore (15.00-23.00)","Libur","Cuti","Izin"];
  const schedRows: (string | number)[][] = [header];
  
  result.schedule.forEach(r=> {
    const cutiOnDay = r.leaves.join(", ") || "-";
    const izinNote = r.izins.join(", ") || "-";
    schedRows.push([`${r.day} ${MONTH_NAMES[month]} ${year}`, DOW_NAMES[r.dow], r.assign.Malam, r.assign.Pagi, r.assign.Sore, r.off.join(" & "), cutiOnDay, izinNote]);
  });

  const ws1 = XLSX.utils.aoa_to_sheet(schedRows);
  (ws1 as unknown as Record<string, unknown>)["!cols"]=[{wch:20},{wch:10},{wch:16},{wch:16},{wch:16},{wch:24},{wch:18},{wch:42}];
  XLSX.utils.book_append_sheet(wb, ws1, "Jadwal Harian");

  const monthRows: (string|number)[][] = [["Nama","Target Malam","Target Pagi","Target Sore","Realisasi Malam","Realisasi Pagi","Realisasi Sore","Total Shift"]];
  result.people.forEach(p=> monthRows.push([p.name, p.target.Malam, p.target.Pagi, p.target.Sore, p.counts.Malam, p.counts.Pagi, p.counts.Sore, p.totalShifts]));
  
  const ws3=XLSX.utils.aoa_to_sheet(monthRows);
  (ws3 as unknown as Record<string, unknown>)["!cols"]=[{wch:16},{wch:12},{wch:12},{wch:12},{wch:14},{wch:14},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws3, "Rekap Bulanan");

  XLSX.writeFile(wb, `Jadwal-Shift-${MONTH_NAMES[month]}-${year}.xlsx`);
}
