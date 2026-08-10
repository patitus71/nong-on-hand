// lib/weeklyReport.ts
// สร้าง Markdown report รายสัปดาห์จากข้อมูล 4 ส่วน

import { format } from 'date-fns';

export interface WeeklyReportData {
  squad: { name: string };
  weekStart: Date;
  weekEnd: Date;
  completedTasks: Array<{
    id: string;
    title: string;
    assignee: { name: string } | null;
    estimatedHours: number | null;
    completedAt: Date;
  }>;
  issueLogs: Array<{
    issueNote: string;
    resolutionNote: string | null;
    flaggedAt: Date;
    resolvedAt: Date | null;
    task: { id: string; title: string };
    flaggedBy: { name: string };
  }>;
  deletedTasks: Array<{
    id: string;
    title: string;
    deletedAt: Date;
    deletionFlagNote: string | null;
  }>;
  retro: {
    title: string;
    items: Array<{
      category: 'WENT_WELL' | 'TO_IMPROVE' | 'ACTION_ITEM';
      content: string;
      voteCount: number;
    }>;
  } | null;
}

const fmt = (d: Date) => format(d, 'dd/MM/yyyy');

export function generateWeeklyReportMarkdown(data: WeeklyReportData): string {
  const { squad, weekStart, weekEnd, completedTasks, issueLogs, deletedTasks, retro } = data;
  const lines: string[] = [];

  lines.push(`# Weekly Report — ${squad.name}`);
  lines.push(`**ช่วงสัปดาห์**: ${fmt(weekStart)} – ${fmt(weekEnd)}`);
  lines.push('');

  // ─── ส่วนที่ 1: งานที่ทำเสร็จ ───────────────────────────────────────────────
  lines.push('## 1. งานที่ทำเสร็จในสัปดาห์นี้');
  if (completedTasks.length === 0) {
    lines.push('_ไม่มีงานที่เสร็จในช่วงนี้_');
  } else {
    // group by assignee
    const byAssignee: Record<string, typeof completedTasks> = {};
    for (const t of completedTasks) {
      const key = t.assignee?.name ?? '(ยังไม่ assign)';
      if (!byAssignee[key]) byAssignee[key] = [];
      byAssignee[key].push(t);
    }
    for (const [name, tasks] of Object.entries(byAssignee)) {
      lines.push(`\n### ${name} (${tasks.length} งาน)`);
      for (const t of tasks) {
        const hrs = t.estimatedHours != null ? ` — ${t.estimatedHours} ชม.` : '';
        lines.push(`- ${t.title}${hrs}`);
      }
    }
  }
  lines.push('');

  // ─── ส่วนที่ 2: ปัญหาที่เจอ ─────────────────────────────────────────────────
  lines.push('## 2. ปัญหาที่เจอในสัปดาห์นี้');
  if (issueLogs.length === 0) {
    lines.push('_ไม่มีปัญหาที่ถูก flag ในช่วงนี้_');
  } else {
    for (const log of issueLogs) {
      lines.push(`\n**งาน**: ${log.task.title}`);
      lines.push(`- **ปัญหา**: ${log.issueNote}`);
      lines.push(`- **flag โดย**: ${log.flaggedBy.name} เมื่อ ${fmt(log.flaggedAt)}`);
      if (log.resolutionNote) {
        lines.push(`- **การแก้ไข**: ${log.resolutionNote}`);
        if (log.resolvedAt) lines.push(`- **แก้ไขเมื่อ**: ${fmt(log.resolvedAt)}`);
      } else {
        lines.push(`- **สถานะ**: ⚠ ยังไม่ได้แก้ไข`);
      }
    }
  }
  lines.push('');

  // ─── ส่วนที่ 3: Ticket ที่ถูกลบ ──────────────────────────────────────────────
  lines.push('## 3. Ticket ที่ถูกลบในสัปดาห์นี้');
  if (deletedTasks.length === 0) {
    lines.push('_ไม่มี ticket ที่ถูกลบในช่วงนี้_');
  } else {
    for (const t of deletedTasks) {
      const note = t.deletionFlagNote
        ? ` — เหตุผล: ${t.deletionFlagNote}`
        : ' — (ลบโดย Admin โดยตรง)';
      lines.push(`- ${t.title}${note}`);
    }
  }
  lines.push('');

  // ─── ส่วนที่ 4: สรุปจาก Retro ────────────────────────────────────────────────
  lines.push('## 4. สรุปจาก Retrospective');
  if (!retro) {
    lines.push('_ยังไม่มี Retro ในสัปดาห์นี้_');
  } else {
    lines.push(`**${retro.title}**`);
    const cats = [
      { key: 'WENT_WELL',   label: 'Went well' },
      { key: 'TO_IMPROVE',  label: 'To improve' },
      { key: 'ACTION_ITEM', label: 'Action items' },
    ] as const;
    for (const { key, label } of cats) {
      const items = retro.items.filter(i => i.category === key);
      if (items.length === 0) continue;
      lines.push(`\n### ${label}`);
      for (const item of items.sort((a, b) => b.voteCount - a.voteCount)) {
        const votes = item.voteCount > 0 ? ` _(▲ ${item.voteCount})_` : '';
        lines.push(`- ${item.content}${votes}`);
      }
    }
  }

  return lines.join('\n');
}

/** คืน weekStart (จันทร์) และ weekEnd (อาทิตย์) ของสัปดาห์ที่ date นั้นอยู่ */
export function getWeekBounds(date: Date): { weekStart: Date; weekEnd: Date } {
  const d = new Date(date);
  const day = d.getDay(); // 0=อาทิตย์ 1=จันทร์ ...
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}
