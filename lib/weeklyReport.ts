// lib/weeklyReport.ts
// สร้าง Markdown report รายสัปดาห์จากข้อมูล 4 ส่วน + Dashboard Overview

import { format } from 'date-fns';

export interface CompletedTaskRow {
  id: string;
  title: string;
  squadName: string;
  assigneeName: string | null;
  normalMinutes: number;
  otMinutes: number;
  completedAt: Date;
}

export interface IssueLogRow {
  issueNote: string;
  resolutionNote: string | null;
  flaggedAt: Date;
  resolvedAt: Date | null;
  taskTitle: string;
  taskSquadName: string;
  assigneeName: string | null;
  normalMinutes: number;
  otMinutes: number;
  flaggedByName: string;
}

export interface DeletedTaskRow {
  id: string;
  title: string;
  squadName: string;
  deletedAt: Date;
  deletionFlagNote: string | null;
  deletedByName: string | null;
  deletedByRole: string | null;
}

export interface DashboardPersonRow {
  name: string;
  thisWeekTasks: number;
  thisWeekNormalMin: number;
  thisWeekOtMin: number;
  prevWeekTasks: number;
  prevWeekNormalMin: number;
  prevWeekOtMin: number;
}

export interface DashboardData {
  rows: DashboardPersonRow[];
  hasPrevWeek: boolean; // false ถ้า squad ยังไม่มีข้อมูลสัปดาห์ก่อน — ซ่อนคอลัมน์ Δ
}

export interface WeeklyReportData {
  squadName: string;
  weekStart: Date;
  weekEnd: Date;
  dashboard: DashboardData | null;
  completedTasks: CompletedTaskRow[];
  issueLogs: IssueLogRow[];
  deletedTasks: DeletedTaskRow[];
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

function fmtTime(normal: number, ot: number): string {
  if (normal === 0 && ot === 0) return '—';
  const parts = [`${fmtMin(normal)}`];
  if (ot > 0) parts.push(`OT ${fmtMin(ot)}`);
  return parts.join(' · ');
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} ชม.` : `${h}:${String(m).padStart(2, '0')} ชม.`;
}

function pctChange(prev: number, curr: number): string {
  if (prev === 0 && curr === 0) return '—';
  if (prev === 0) return `+${curr} (ใหม่)`;
  const pct = Math.round(((curr - prev) / prev) * 100);
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function buildInsight(rows: DashboardPersonRow[]): string {
  if (rows.length === 0) return '_ไม่มีข้อมูลสัปดาห์นี้_';
  const sorted = [...rows].sort((a, b) => b.thisWeekTasks - a.thisWeekTasks);
  const top = sorted[0];
  const improved = rows.filter(r => r.thisWeekTasks > r.prevWeekTasks);
  const declined = rows.filter(r => r.thisWeekTasks < r.prevWeekTasks && r.prevWeekTasks > 0);

  let text = `${top.name} มีงานที่เสร็จมากที่สุดในสัปดาห์นี้ (${top.thisWeekTasks} งาน`;
  text += top.thisWeekNormalMin > 0 ? `, ${fmtMin(top.thisWeekNormalMin)})` : ')';

  if (improved.length > 0) {
    text += ` — ${improved.map(r => r.name).join(', ')} ทำงานได้มากขึ้นกว่าสัปดาห์ก่อน`;
  }
  if (declined.length > 0) {
    text += ` — ${declined.map(r => r.name).join(', ')} มีงานเสร็จน้อยลงกว่าสัปดาห์ก่อน ควรตรวจสอบว่ามีปัญหาที่ยังค้างอยู่ในส่วนที่ 2 หรือไม่`;
  }
  return text;
}

export function generateWeeklyReportMarkdown(data: WeeklyReportData): string {
  const { squadName, weekStart, weekEnd, dashboard, completedTasks, issueLogs, deletedTasks, retro } = data;
  const lines: string[] = [];

  lines.push(`# Weekly Report — ${squadName}`);
  lines.push(`**ช่วงสัปดาห์**: ${fmt(weekStart)} – ${fmt(weekEnd)}`);
  lines.push('');

  // ─── Dashboard Overview ───────────────────────────────────────────────────────
  if (dashboard && dashboard.rows.length > 0) {
    lines.push('## Dashboard — สรุปภาพรวม');
    lines.push('');

    if (dashboard.hasPrevWeek) {
      lines.push('| คน | สัปดาห์ก่อน (งาน) | สัปดาห์นี้ (งาน) | Δ งาน | สัปดาห์ก่อน (ชม.) | สัปดาห์นี้ (ชม.) | Δ ชม. |');
      lines.push('|---|---|---|---|---|---|---|');
      for (const r of dashboard.rows) {
        const dTask = pctChange(r.prevWeekTasks, r.thisWeekTasks);
        const dTime = pctChange(r.prevWeekNormalMin, r.thisWeekNormalMin);
        lines.push(`| ${r.name} | ${r.prevWeekTasks} | ${r.thisWeekTasks} | ${dTask} | ${fmtMin(r.prevWeekNormalMin)} | ${fmtMin(r.thisWeekNormalMin)} | ${dTime} |`);
      }
    } else {
      lines.push('| คน | งานที่เสร็จ | เวลารวม |');
      lines.push('|---|---|---|');
      for (const r of dashboard.rows) {
        lines.push(`| ${r.name} | ${r.thisWeekTasks} | ${fmtMin(r.thisWeekNormalMin)} |`);
      }
    }
    lines.push('');
    lines.push(`_${buildInsight(dashboard.rows)}_`);
    lines.push('');
  }

  // ─── ส่วนที่ 1: งานที่ทำเสร็จ (1 แถวต่อ 1 task) ─────────────────────────────
  lines.push('## 1. งานที่ทำเสร็จในสัปดาห์นี้');
  if (completedTasks.length === 0) {
    lines.push('_ไม่มีงานที่เสร็จในช่วงนี้_');
  } else {
    lines.push('');
    lines.push('| SQ | คนทำ | Ticket | เวลาที่ log |');
    lines.push('|---|---|---|---|');
    for (const t of completedTasks) {
      const name = t.assigneeName ?? '(ยังไม่ assign)';
      const time = fmtTime(t.normalMinutes, t.otMinutes);
      lines.push(`| ${t.squadName} | ${name} | ${t.title} | ${time} |`);
    }
  }
  lines.push('');

  // ─── ส่วนที่ 2: ปัญหาที่เจอ ─────────────────────────────────────────────────
  lines.push('## 2. ปัญหาที่เจอในสัปดาห์นี้');
  if (issueLogs.length === 0) {
    lines.push('_ไม่มีปัญหาที่ถูก flag ในช่วงนี้_');
  } else {
    lines.push('');
    lines.push('| SQ | คนทำ | Ticket | เวลาที่ log | ปัญหา | สถานะ |');
    lines.push('|---|---|---|---|---|---|');
    for (const log of issueLogs) {
      const name   = log.assigneeName ?? '(ยังไม่ assign)';
      const time   = fmtTime(log.normalMinutes, log.otMinutes);
      const status = log.resolutionNote ? `_(✅ แก้แล้ว: ${log.resolutionNote})_` : '_(⚠ ยังไม่ resolve)_';
      lines.push(`| ${log.taskSquadName} | ${name} | ${log.taskTitle} | ${time} | ${log.issueNote} | ${status} |`);
    }
  }
  lines.push('');

  // ─── ส่วนที่ 3: Ticket ที่ถูกลบ ──────────────────────────────────────────────
  lines.push('## 3. Ticket ที่ถูกลบในสัปดาห์นี้');
  if (deletedTasks.length === 0) {
    lines.push('_ไม่มี ticket ที่ถูกลบในช่วงนี้_');
  } else {
    lines.push('');
    lines.push('| SQ | Ticket | ลบโดย | Role | เหตุผล |');
    lines.push('|---|---|---|---|---|');
    for (const t of deletedTasks) {
      const byName = t.deletedByName ?? '—';
      const byRole = t.deletedByRole ?? '—';
      const reason = t.deletionFlagNote ?? '(ลบโดยตรง)';
      lines.push(`| ${t.squadName} | ${t.title} | ${byName} | ${byRole} | ${reason} |`);
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
  const day = d.getDay();
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() + diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

/** คำนวณ dashboard rows จาก completedTasks ของสัปดาห์นี้ + สัปดาห์ก่อน */
export function buildDashboardRows(
  thisWeek: Array<{ assigneeName: string | null; normalMinutes: number; otMinutes: number }>,
  prevWeek: Array<{ assigneeName: string | null; normalMinutes: number; otMinutes: number }>,
): DashboardPersonRow[] {
  const map = new Map<string, DashboardPersonRow>();

  for (const t of thisWeek) {
    const name = t.assigneeName ?? '(ยังไม่ assign)';
    const r = map.get(name) ?? { name, thisWeekTasks: 0, thisWeekNormalMin: 0, thisWeekOtMin: 0, prevWeekTasks: 0, prevWeekNormalMin: 0, prevWeekOtMin: 0 };
    r.thisWeekTasks++;
    r.thisWeekNormalMin += t.normalMinutes;
    r.thisWeekOtMin     += t.otMinutes;
    map.set(name, r);
  }
  for (const t of prevWeek) {
    const name = t.assigneeName ?? '(ยังไม่ assign)';
    const r = map.get(name) ?? { name, thisWeekTasks: 0, thisWeekNormalMin: 0, thisWeekOtMin: 0, prevWeekTasks: 0, prevWeekNormalMin: 0, prevWeekOtMin: 0 };
    r.prevWeekTasks++;
    r.prevWeekNormalMin += t.normalMinutes;
    r.prevWeekOtMin     += t.otMinutes;
    map.set(name, r);
  }

  return Array.from(map.values()).sort((a, b) => b.thisWeekTasks - a.thisWeekTasks);
}
