// lib/personalReport.ts
// สร้าง Markdown report สรุปงานส่วนตัวจาก my-board (ไม่บันทึก DB)

import { format } from 'date-fns';
import { formatMinutes } from './timeCalc';

export interface PersonalReportTask {
  id: string;
  title: string;
  laneName: string;
  completedAt: Date | null;
  totalNormalMin: number;
  totalOtMin: number;
}

export interface PersonalReportData {
  userName: string;
  weekStart: Date;
  weekEnd: Date;
  tasks: PersonalReportTask[];
}

const fmt = (d: Date) => format(d, 'dd/MM/yyyy');

const LANE_ORDER = ['To Do', 'In Progress', 'Review', 'Done'];

export function generatePersonalReportMarkdown(data: PersonalReportData): string {
  const { userName, weekStart, weekEnd, tasks } = data;
  const lines: string[] = [];

  lines.push(`# รายงานสรุปงานส่วนตัว — ${userName}`);
  lines.push(`**ช่วงสัปดาห์**: ${fmt(weekStart)} – ${fmt(weekEnd)}`);
  lines.push('');

  // ─── งานทั้งหมด แบ่งตามเลน ─────────────────────────────
  lines.push('## งานทั้งหมด');

  const byLane = new Map<string, PersonalReportTask[]>();
  for (const t of tasks) {
    const arr = byLane.get(t.laneName) ?? [];
    arr.push(t);
    byLane.set(t.laneName, arr);
  }

  const orderedKeys = [
    ...LANE_ORDER.filter(l => byLane.has(l)),
    ...Array.from(byLane.keys()).filter(l => !LANE_ORDER.includes(l)),
  ];

  if (orderedKeys.length === 0) {
    lines.push('_ยังไม่มีงานบนบอร์ด_');
  } else {
    for (const laneName of orderedKeys) {
      const laneTasks = byLane.get(laneName)!;
      lines.push(`\n### ${laneName} (${laneTasks.length} งาน)`);
      for (const t of laneTasks) {
        if (laneName === 'Done') {
          const doneDate = t.completedAt ? ` — เสร็จ: ${fmt(t.completedAt)}` : '';
          const timeStr =
            t.totalNormalMin > 0 || t.totalOtMin > 0
              ? ` — Normal: ${formatMinutes(t.totalNormalMin)}${
                  t.totalOtMin > 0 ? ` · OT: ${formatMinutes(t.totalOtMin)}` : ''
                }`
              : '';
          lines.push(`- ${t.title}${doneDate}${timeStr}`);
        } else {
          lines.push(`- ${t.title}`);
        }
      }
    }
  }
  lines.push('');

  // ─── สรุปเวลา (เฉพาะ Done) ─────────────────────────────
  const doneTasks   = tasks.filter(t => t.laneName === 'Done');
  const totalNormal = doneTasks.reduce((s, t) => s + t.totalNormalMin, 0);
  const totalOt     = doneTasks.reduce((s, t) => s + t.totalOtMin, 0);

  lines.push('## สรุปเวลา (เฉพาะงานที่ Done)');
  if (doneTasks.length === 0) {
    lines.push('_ยังไม่มีงานที่เสร็จ_');
  } else {
    lines.push(`- **รวม Normal**: ${formatMinutes(totalNormal)} ชม.`);
    if (totalOt > 0) lines.push(`- **รวม OT**: ${formatMinutes(totalOt)} ชม.`);
    lines.push(`- **จำนวนงาน Done**: ${doneTasks.length} รายการ`);
  }

  return lines.join('\n');
}
