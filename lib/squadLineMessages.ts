// lib/squadLineMessages.ts
// Shared standup/EOD message builders — imported by both per-squad and all-squads LINE send routes

import { prisma } from '@/lib/prisma';
import { computeSquadBoardStatus } from '@/lib/importTasks';
import { thaiDate, formatMinutes } from '@/lib/lineNotify';

export const HINT_RELINK =
  '💡 บางบัญชียังไม่มีชื่อ LINE — พิมพ์ /link <username> ในกลุ่มนี้อีกครั้งเพื่ออัปเดต';

// LINE hard limit is 5,000 chars; leave buffer for mention prefix
export const LINE_CHAR_LIMIT = 4800;

// ─── Standup ──────────────────────────────────────────────────────────────────

export async function buildStandupText(squadId: string, squadName: string): Promise<string> {
  const tasks = await prisma.task.findMany({
    where: {
      squadId,
      deletedAt:         null,
      pulledIntoBoardAt: { not: null },
      laneId:            { not: null },
    },
    select: {
      id: true, title: true, hasIssue: true, assigneeId: true, laneId: true,
      assignee: { select: { name: true, lineDisplayName: true } },
      lane:     { select: { name: true } },
    },
    orderBy: { order: 'asc' },
  });

  const byAssignee = new Map<string, { displayName: string; doing: string[]; queue: string[] }>();
  for (const task of tasks) {
    if (!task.assigneeId || !task.assignee) continue;
    const status = computeSquadBoardStatus(task);
    if (status === 'Done') continue;
    if (!byAssignee.has(task.assigneeId)) {
      byAssignee.set(task.assigneeId, {
        displayName: task.assignee.lineDisplayName ?? task.assignee.name,
        doing: [], queue: [],
      });
    }
    const entry = byAssignee.get(task.assigneeId)!;
    const label = task.title + (task.hasIssue ? ' 🚩 มีปัญหา' : '');
    if (status === 'On-Board In Progress' || status === 'มีปัญหา') {
      entry.doing.push(label);
    } else {
      entry.queue.push(label);
    }
  }

  const todayTH = thaiDate(new Date());
  const lines: string[] = [`☀️ Standup เช้านี้ — ${squadName} (${todayTH})`];
  let totalOnBoard = 0;

  for (const [, person] of Array.from(byAssignee)) {
    lines.push('');
    lines.push(`@${person.displayName}`);
    for (const t of person.doing) lines.push(`  • กำลังทำ: ${t}`);
    for (const t of person.queue) lines.push(`  • คิวถัดไป: ${t}`);
    totalOnBoard += person.doing.length + person.queue.length;
  }

  lines.push('');
  lines.push(byAssignee.size === 0 ? 'ไม่มีงานในบอร์ดวันนี้' : `รวม ${totalOnBoard} งาน On-Board วันนี้`);
  return lines.join('\n');
}

/**
 * Combine per-squad standup texts into chunks, splitting at squad boundaries
 * when the concatenated text would exceed LINE_CHAR_LIMIT.
 */
export function mergeStandupChunks(parts: string[]): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current ? current + '\n\n' + part : part;
    if (candidate.length > LINE_CHAR_LIMIT && current) {
      chunks.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ─── EOD ──────────────────────────────────────────────────────────────────────

const EOD_SHOW = new Set<string>(['On-Board In Progress', 'Wait for review', 'มีปัญหา', 'Done']);
const EOD_STATUS_LABELS: Record<string, string> = { 'มีปัญหา': '🚩มีปัญหา' };

export function eodStatusLabel(status: string): string {
  if (status === 'On-Board In Progress') return 'In Progress';
  if (status === 'Wait for review')      return 'Review';
  return EOD_STATUS_LABELS[status] ?? status;
}

export async function buildEodChunks(squadId: string, squadName: string): Promise<string[]> {
  const ictOffset  = 7 * 60 * 60 * 1000;
  const todayICT   = new Date(Date.now() + ictOffset);
  const yyyymmdd   = todayICT.toISOString().slice(0, 10);
  const todayStart = new Date(`${yyyymmdd}T00:00:00+07:00`);
  const todayEnd   = new Date(`${yyyymmdd}T23:59:59.999+07:00`);

  const tasks = await prisma.task.findMany({
    where:  { squadId, deletedAt: null },
    select: {
      id: true, title: true, hasIssue: true, laneId: true,
      assigneeId: true, completedAt: true,
      assignee: { select: { name: true, lineDisplayName: true } },
      lane:     { select: { name: true } },
      timeLogs: { where: { endAt: { not: null } }, select: { normalMinutes: true, otMinutes: true } },
    },
  });

  // Summary counts (all non-Done — shown in footer)
  const statusCount: Record<string, number> = {};
  let totalRemaining = 0;
  for (const task of tasks) {
    const status = computeSquadBoardStatus(task);
    if (status === 'Done') continue;
    statusCount[status] = (statusCount[status] ?? 0) + 1;
    totalRemaining++;
  }

  const doneToday = tasks.filter(
    t => t.completedAt && t.completedAt >= todayStart && t.completedAt <= todayEnd
  );

  const todayTH = thaiDate(todayICT);
  const header  = `📊 สรุปสิ้นวัน — ${squadName} (${todayTH})`;

  const statusOrder = ['To do list', 'On-Board', 'On-Board In Progress', 'Wait for review', 'มีปัญหา'];
  const summaryParts = statusOrder
    .filter(s => statusCount[s])
    .map(s => `${EOD_STATUS_LABELS[s] ?? s}: ${statusCount[s]}`);

  const footerLines: string[] = [
    `งานที่เหลือ (ยังไม่ Done): ${totalRemaining} งาน`,
    ...(summaryParts.length > 0 ? [`  ${summaryParts.join(' · ')}`] : []),
    '',
    `งานที่เสร็จวันนี้: ${doneToday.length} งาน`,
  ];
  if (doneToday.length === 0) {
    footerLines.push('  ไม่มีงานที่เสร็จวันนี้');
  } else {
    for (const t of doneToday) {
      const totalMin = t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0) + (l.otMinutes ?? 0), 0);
      const timeStr  = totalMin > 0 ? ` (${formatMinutes(totalMin)})` : '';
      footerLines.push(`  • ${t.assignee?.name ?? 'ไม่ระบุ'}: ${t.title}${timeStr}`);
    }
  }
  const footer = footerLines.join('\n');

  // Per-person blocks — only actionable statuses
  const byAssignee = new Map<string, { displayName: string; taskLines: string[] }>();
  for (const task of tasks) {
    if (!task.assigneeId || !task.assignee) continue;
    const status = computeSquadBoardStatus(task);
    if (!EOD_SHOW.has(status)) continue;
    if (!byAssignee.has(task.assigneeId)) {
      byAssignee.set(task.assigneeId, {
        displayName: task.assignee.lineDisplayName ?? task.assignee.name,
        taskLines:   [],
      });
    }
    byAssignee.get(task.assigneeId)!.taskLines.push(`  • ${task.title} (${eodStatusLabel(status)})`);
  }

  const personBlocks: string[] = [];
  for (const [, person] of Array.from(byAssignee)) {
    personBlocks.push([`@${person.displayName}`, ...person.taskLines].join('\n'));
  }

  // Chunk at person boundaries
  const chunks: string[] = [];
  let body = header + '\n';

  for (const block of personBlocks) {
    const candidate  = body + '\n' + block + '\n';
    const withFooter = candidate + '\n' + footer;
    if (withFooter.length > LINE_CHAR_LIMIT && body !== header + '\n') {
      chunks.push(body.trimEnd());
      body = `${header} (ต่อ)\n\n${block}\n`;
    } else {
      body = candidate;
    }
  }

  chunks.push(body.trimEnd() + '\n\n' + footer);
  return chunks;
}
