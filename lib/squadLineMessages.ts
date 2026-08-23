// lib/squadLineMessages.ts
// Shared standup/EOD message builders — imported by both per-squad and all-squads LINE send routes

import { prisma } from '@/lib/prisma';
import { computeSquadBoardStatus } from '@/lib/importTasks';
import { thaiDate, formatMinutes } from '@/lib/lineNotify';

export const HINT_RELINK =
  '💡 บางบัญชียังไม่มีชื่อ LINE — พิมพ์ /link <username> ในกลุ่มนี้อีกครั้งเพื่ออัปเดต';

// LINE hard limit is 5,000 chars; leave buffer for mention prefix
export const LINE_CHAR_LIMIT = 4800;

const DIVIDER = '━━━━━━━━━━━━━━';

// ─── Standup ──────────────────────────────────────────────────────────────────

type StandupPerson = { displayName: string; doing: string[]; queue: string[] };

async function fetchStandupPersons(squadId: string): Promise<Map<string, StandupPerson>> {
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

  const byAssignee = new Map<string, StandupPerson>();
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
  return byAssignee;
}

function formatStandupBody(byAssignee: Map<string, StandupPerson>): { lines: string[]; totalOnBoard: number } {
  const lines: string[] = [];
  let totalOnBoard = 0;
  for (const [, person] of Array.from(byAssignee)) {
    lines.push('');
    lines.push(`@${person.displayName}`);
    for (const t of person.doing) lines.push(`  • กำลังทำ: ${t}`);
    for (const t of person.queue) lines.push(`  • คิวถัดไป: ${t}`);
    totalOnBoard += person.doing.length + person.queue.length;
  }
  return { lines, totalOnBoard };
}

/** Per-squad: full standup block with date header + squad divider section */
export async function buildStandupText(squadId: string, squadName: string): Promise<string> {
  const byAssignee = await fetchStandupPersons(squadId);
  const { lines, totalOnBoard } = formatStandupBody(byAssignee);
  const todayTH = thaiDate(new Date(Date.now() + 7 * 60 * 60 * 1000));
  return [
    `☀️ Standup เช้านี้ — (${todayTH})`,
    DIVIDER,
    `📍 ${squadName}`,
    DIVIDER,
    ...lines,
    '',
    byAssignee.size === 0 ? 'ไม่มีงานในบอร์ดวันนี้' : `รวม ${totalOnBoard} งาน On-Board วันนี้`,
  ].join('\n');
}

/** Send-all: squad section with divider header — caller prepends the global date header */
export async function buildStandupBlock(squadId: string, squadName: string): Promise<string> {
  const byAssignee = await fetchStandupPersons(squadId);
  const { lines, totalOnBoard } = formatStandupBody(byAssignee);
  return [
    DIVIDER,
    `📍 ${squadName}`,
    DIVIDER,
    ...lines,
    '',
    byAssignee.size === 0 ? 'ไม่มีงานในบอร์ดวันนี้' : `รวม ${totalOnBoard} งาน On-Board วันนี้`,
  ].join('\n');
}

/**
 * Pack an array of text blocks into as few LINE messages as possible,
 * splitting only when the next block would push past LINE_CHAR_LIMIT.
 */
export function mergeIntoChunks(parts: string[]): string[] {
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

async function fetchEodData(squadId: string) {
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

  return { statusCount, totalRemaining, doneToday, byAssignee };
}

function buildEodFooterLines(
  statusCount:    Record<string, number>,
  totalRemaining: number,
  doneToday:      Array<{
    title: string;
    assignee: { name: string } | null;
    timeLogs: Array<{ normalMinutes: number | null; otMinutes: number | null }>;
  }>
): string[] {
  const statusOrder  = ['To do list', 'On-Board', 'On-Board In Progress', 'Wait for review', 'มีปัญหา'];
  const summaryParts = statusOrder
    .filter(s => statusCount[s])
    .map(s => `${EOD_STATUS_LABELS[s] ?? s}: ${statusCount[s]}`);

  const lines = [
    `งานที่เหลือ (ยังไม่ Done): ${totalRemaining} งาน`,
    ...(summaryParts.length > 0 ? [`  ${summaryParts.join(' · ')}`] : []),
    '',
    `งานที่เสร็จวันนี้: ${doneToday.length} งาน`,
  ];

  if (doneToday.length === 0) {
    lines.push('  ไม่มีงานที่เสร็จวันนี้');
  } else {
    for (const t of doneToday) {
      const totalMin = t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0) + (l.otMinutes ?? 0), 0);
      const timeStr  = totalMin > 0 ? ` (${formatMinutes(totalMin)})` : '';
      lines.push(`  • ${t.assignee?.name ?? 'ไม่ระบุ'}: ${t.title}${timeStr}`);
    }
  }
  return lines;
}

/** Per-squad: chunked EOD output with date header + squad divider section */
export async function buildEodChunks(squadId: string, squadName: string): Promise<string[]> {
  const ictOffset = 7 * 60 * 60 * 1000;
  const todayICT  = new Date(Date.now() + ictOffset);
  const todayTH   = thaiDate(todayICT);

  const { statusCount, totalRemaining, doneToday, byAssignee } = await fetchEodData(squadId);

  const dateHeader   = `📊 สรุปสิ้นวัน — (${todayTH})`;
  const squadSection = `${DIVIDER}\n📍 ${squadName}\n${DIVIDER}`;
  const header       = `${dateHeader}\n${squadSection}`;
  const footer       = buildEodFooterLines(statusCount, totalRemaining, doneToday).join('\n');

  const personBlocks: string[] = [];
  for (const [, person] of Array.from(byAssignee)) {
    personBlocks.push([`@${person.displayName}`, ...person.taskLines].join('\n'));
  }

  const chunks: string[] = [];
  let body = header + '\n';

  for (const block of personBlocks) {
    const candidate  = body + '\n' + block + '\n';
    const withFooter = candidate + '\n' + footer;
    if (withFooter.length > LINE_CHAR_LIMIT && body !== header + '\n') {
      chunks.push(body.trimEnd());
      body = `${dateHeader} (ต่อ)\n${squadSection}\n\n${block}\n`;
    } else {
      body = candidate;
    }
  }

  chunks.push(body.trimEnd() + '\n\n' + footer);
  return chunks;
}

// ─── Assignee helpers for mentions ───────────────────────────────────────────

/** Distinct assigneeIds of tasks that appear in a standup (non-Done, on-board) */
export async function fetchStandupAssigneeIds(squadIds: string[]): Promise<string[]> {
  const tasks = await prisma.task.findMany({
    where: {
      squadId:           { in: squadIds },
      deletedAt:         null,
      pulledIntoBoardAt: { not: null },
      laneId:            { not: null },
    },
    select: { assigneeId: true, hasIssue: true, laneId: true, lane: { select: { name: true } } },
  });
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    if (computeSquadBoardStatus(task) !== 'Done') ids.add(task.assigneeId);
  }
  return Array.from(ids);
}

/** Distinct assigneeIds of tasks that appear in an EOD report */
export async function fetchEodAssigneeIds(squadIds: string[]): Promise<string[]> {
  const tasks = await prisma.task.findMany({
    where: { squadId: { in: squadIds }, deletedAt: null },
    select: { assigneeId: true, hasIssue: true, laneId: true, lane: { select: { name: true } } },
  });
  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    if (EOD_SHOW.has(computeSquadBoardStatus(task))) ids.add(task.assigneeId);
  }
  return Array.from(ids);
}

/** Send-all: squad EOD section with divider header — caller prepends the global date header */
export async function buildEodBlock(squadId: string, squadName: string): Promise<string> {
  const { statusCount, totalRemaining, doneToday, byAssignee } = await fetchEodData(squadId);
  const footerLines = buildEodFooterLines(statusCount, totalRemaining, doneToday);

  const lines: string[] = [DIVIDER, `📍 ${squadName}`, DIVIDER];
  for (const [, person] of Array.from(byAssignee)) {
    lines.push('');
    lines.push(`@${person.displayName}`);
    lines.push(...person.taskLines);
  }
  lines.push('');
  lines.push(...footerLines);
  return lines.join('\n');
}
