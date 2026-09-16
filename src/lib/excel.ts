import * as XLSX from "xlsx";
import { MONTH_NAMES, DOW_NAMES, SHIFT_TYPES, weekNumberFor } from "./scheduler";
import type { SchedulerResult, DayRecord } from "./scheduler";

export function downloadExcel(result: SchedulerResult, month: number, year: number) {
  if (!result) return;
  const wb = XLSX.utils.book_new();
  // Sheet 1: Jadwal Harian + indikator cuti
  const header = ["Tanggal","Hari","Malam (23.00-07.00)","Pagi (07.00-15.00)","Sore (15.00-23.00)","Libur","Cuti"];
  const schedRows: (string | number)[][] = [header];
  result.schedule.forEach(r=> {
    const cutiOnDay = result.cuti.filter(c=> c.days.includes(r.day)).map(c=>c.person).join(", ") || "-";
    schedRows.push([`${r.day} ${MONTH_NAMES[month]} ${year}`, DOW_NAMES[r.dow], r.assign.Malam, r.assign.Pagi, r.assign.Sore, r.off.join(" & "), cutiOnDay]);
  });
  // prev 2 days rows at top if exist
  if(result.prev && result.prev.length){
    const prevRows: (string|number)[][] = [["-- 2 HARI SEBELUM BULAN INI (input) --"]];
    result.prev.forEach((pd,i)=>{
      const label = result.prev.length===2 ? (i===0? "H-2":"H-1") : "H-1";
      prevRows.push([label, "", pd.assign.Malam, pd.assign.Pagi, pd.assign.Sore, pd.off.join(" & "), ""]);
    });
    prevRows.push([]); // spacer
    schedRows.splice(1,0, ...prevRows);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(schedRows);
  (ws1 as unknown as Record<string, unknown>)["!cols"]=[{wch:20},{wch:10},{wch:16},{wch:16},{wch:16},{wch:24},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws1, "Jadwal Harian");

  // Sheet 2: Rekap Mingguan
  const firstDate=result.schedule[0].date;
  const weeks: Record<number,DayRecord[]> = {};
  result.schedule.forEach(row=>{ const wk=weekNumberFor(row.date, firstDate); if(!weeks[wk]) weeks[wk]=[]; weeks[wk].push(row); });
  const weekRows: (string|number)[][] = [["Minggu","Rentang Tanggal","Nama","Malam","Pagi","Sore","Libur","Cuti","Total Shift"]];
  Object.keys(weeks).sort((a,b)=>Number(a)-Number(b)).forEach(wk=>{
    const rows=weeks[Number(wk)]; const rangeLabel=`${rows[0].day} - ${rows[rows.length-1].day} ${MONTH_NAMES[month]}`;
    const per: Record<string,Record<string,number>> = {};
    result.people.forEach(p=> per[p.name]={Malam:0,Pagi:0,Sore:0,Off:0,Cuti:0});
    rows.forEach(r=>{ SHIFT_TYPES.forEach(t=> per[r.assign[t]][t]++); r.off.forEach(n=> { per[n].Off++; if((per[n] as Record<string,number>).Cuti!==undefined && result.cuti.find(c=> c.person===n && c.days.includes(r.day))) per[n].Cuti++; }); });
    result.people.forEach(p=>{
      const c=per[p.name]; const cutiCnt = result.cuti.find(x=> x.person===p.name)?.days.filter(d=> rows.some(r=> r.day===d)).length || 0;
      weekRows.push([`Minggu ${wk}`,rangeLabel,p.name,c.Malam,c.Pagi,c.Sore,c.Off,cutiCnt,c.Malam+c.Pagi+c.Sore]);
    });
  });
  const ws2=XLSX.utils.aoa_to_sheet(weekRows);
  (ws2 as unknown as Record<string, unknown>)["!cols"]=[{wch:10},{wch:18},{wch:16},{wch:8},{wch:8},{wch:8},{wch:8},{wch:8},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws2, "Rekap Mingguan");

  // Sheet 3: Rekap Bulanan + Cuti
  const monthRows: (string|number)[][] = [["Nama","Target Malam","Target Pagi","Target Sore","Realisasi Malam","Realisasi Pagi","Realisasi Sore","Libur","Cuti","Total Shift","Max Streak"]];
  result.people.forEach(p=> monthRows.push([p.name, p.target.Malam, p.target.Pagi, p.target.Sore, p.counts.Malam, p.counts.Pagi, p.counts.Sore, p.offCount, p.cutiDays, p.totalShifts, p.maxStreak]));
  // fairness row
  monthRows.push([]);
  monthRows.push(["Fairness (stddev total shift)", result.stats.fairness, "Coverage", result.stats.coverage+"%"]);
  if(result.warnings.length) { monthRows.push([]); monthRows.push(["Catatan"]); result.warnings.forEach(w=> monthRows.push([w])); }
  const ws3=XLSX.utils.aoa_to_sheet(monthRows);
  (ws3 as unknown as Record<string, unknown>)["!cols"]=[{wch:16},{wch:12},{wch:12},{wch:12},{wch:14},{wch:14},{wch:14},{wch:10},{wch:10},{wch:12},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws3, "Rekap Bulanan");

  // Sheet 4: Daftar Cuti
  const cutiRows: (string|number)[][] = [["Nama","Tanggal Cuti (tgl)","Jumlah Hari"]];
  result.cuti.forEach(c=> cutiRows.push([c.person, c.days.sort((a,b)=>a-b).join(", ")||"-", c.days.length]));
  if(result.cuti.length===0) cutiRows.push(["-","Tidak ada cuti","0"]);
  const ws4=XLSX.utils.aoa_to_sheet(cutiRows);
  (ws4 as unknown as Record<string, unknown>)["!cols"]=[{wch:16},{wch:32},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws4, "Daftar Cuti");

  XLSX.writeFile(wb, `Jadwal-Shift-${MONTH_NAMES[month]}-${year}.xlsx`);
}
