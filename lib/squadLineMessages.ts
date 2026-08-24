// lib/squadLineMessages.ts
// Shared standup/EOD message builders — imported by both per-squad and all-squads LINE send routes

import { prisma } from '@/lib/prisma';
import { computeSquadBoardStatus } from '@/lib/importTasks';
import { thaiDate, MentionContext } from '@/lib/lineNotify';

// LINE hard limit is 5,000 chars; leave buffer for mention prefix
export const LINE_CHAR_LIMIT = 4800;

function truncateNote(note: string, maxLen = 80): string {
  return note.length > maxLen ? note.slice(0, maxLen) + '...' : note;
}

// ─── Standup ──────────────────────────────────────────────────────────────────

type TaskItem = { title: string; hasIssue: boolean; issueNote: string | null };

type StandupPerson = {
  displayName: string;
  lineUserId:  string | null;
  doing:       TaskItem[];
  queue:       TaskItem[];
};

async function fetchStandupPersons(squadId: string): Promise<Map<string, StandupPerson>> {
  const tasks = await prisma.task.findMany({
    where: {
      squadId,
      deletedAt:         null,
      pulledIntoBoardAt: { not: null },
      laneId:            { not: null },
    },
    select: {
      id: true, title: true, hasIssue: true, issueNote: true, assigneeId: true, laneId: true,
      assignee: { select: { name: true, lineDisplayName: true, lineUserId: true } },
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
        lineUserId:  task.assignee.lineUserId,
        doing: [], queue: [],
      });
    }
    const entry = byAssignee.get(task.assigneeId)!;
    const item: TaskItem = { title: task.title, hasIssue: task.hasIssue, issueNote: task.issueNote };
    if (status === 'On-Board In Progress' || status === 'มีปัญหา') {
      entry.doing.push(item);
    } else {
      entry.queue.push(item);
    }
  }
  return byAssignee;
}

function formatStandupSquadSection(
  squadName:  string,
  byAssignee: Map<string, StandupPerson>,
  ctx?:       MentionContext,
): string {
  const total = Array.from(byAssignee.values()).reduce(
    (n, p) => n + p.doing.length + p.queue.length, 0,
  );
  if (total === 0) return `📍 ${squadName} — No tasks today`;

  const lines: string[] = [`📍 ${squadName} — ${total} ${total === 1 ? 'task' : 'tasks'}`];
  for (const [, person] of Array.from(byAssignee)) {
    const nameTag = ctx
      ? ctx.slot(person.displayName, person.lineUserId)
      : `@${person.displayName}`;
    lines.push(nameTag);
    for (const item of person.doing) lines.push(`In Progress: ${item.title}`);
    for (const item of person.queue) lines.push(`Next up: ${item.title}`);
  }
  return lines.join('\n');
}

/** Per-squad: full standup with date header + legend */
export async function buildStandupText(
  squadId:   string,
  squadName: string,
  ctx?:      MentionContext,
): Promise<string> {
  const byAssignee = await fetchStandupPersons(squadId);
  const todayTH    = thaiDate(new Date(Date.now() + 7 * 60 * 60 * 1000));
  const header     = `Standup — (${todayTH})\nIn Progress · Next up`;
  const section    = formatStandupSquadSection(squadName, byAssignee, ctx);
  return `${header}\n\n${section}`;
}

/** Send-all: squad section only — caller prepends global date header */
export async function buildStandupBlock(
  squadId:   string,
  squadName: string,
  ctx?:      MentionContext,
): Promise<string> {
  const byAssignee = await fetchStandupPersons(squadId);
  return formatStandupSquadSection(squadName, byAssignee, ctx);
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

function eodLabel(status: string): string {
  if (status === 'มีปัญหา')             return '🚩 Issue:';
  if (status === 'Done')                 return 'Done:';
  if (status === 'On-Board In Progress') return 'In Progress:';
  if (status === 'Wait for review')      return 'In Review:';
  return '';
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
      id: true, title: true, hasIssue: true, issueNote: true, laneId: true,
      assigneeId: true, completedAt: true,
      assignee: { select: { name: true, lineDisplayName: true, lineUserId: true } },
      lane:     { select: { name: true } },
    },
  });

  let totalRemaining = 0;
  for (const task of tasks) {
    if (computeSquadBoardStatus(task) !== 'Done') totalRemaining++;
  }

  const doneTodayCount = tasks.filter(
    t => t.completedAt && t.completedAt >= todayStart && t.completedAt <= todayEnd,
  ).length;

  const byAssignee = new Map<string, {
    displayName: string;
    lineUserId:  string | null;
    taskLines:   string[];
  }>();
  for (const task of tasks) {
    if (!task.assigneeId || !task.assignee) continue;
    const status = computeSquadBoardStatus(task);
    if (!EOD_SHOW.has(status)) continue;
    if (!byAssignee.has(task.assigneeId)) {
      byAssignee.set(task.assigneeId, {
        displayName: task.assignee.lineDisplayName ?? task.assignee.name,
        lineUserId:  task.assignee.lineUserId,
        taskLines:   [],
      });
    }
    const entry    = byAssignee.get(task.assigneeId)!;
    entry.taskLines.push(`${eodLabel(status)} ${task.title}`);
    const noteText = task.issueNote?.trim();
    if (task.hasIssue && noteText) {
      entry.taskLines.push(`   🚨 ${truncateNote(noteText)}`);
    }
  }

  return { totalRemaining, doneTodayCount, byAssignee };
}

function formatEodSquadSection(
  squadName:      string,
  totalRemaining: number,
  doneTodayCount: number,
  byAssignee:     Map<string, { displayName: string; lineUserId: string | null; taskLines: string[] }>,
  ctx?:           MentionContext,
): string {
  const header = `📍 ${squadName} — Remaining ${totalRemaining} · Done ${doneTodayCount}`;
  if (byAssignee.size === 0) return header;

  const lines: string[] = [header];
  for (const [, person] of Array.from(byAssignee)) {
    const nameTag = ctx
      ? ctx.slot(person.displayName, person.lineUserId)
      : `@${person.displayName}`;
    lines.push(nameTag);
    lines.push(...person.taskLines);
  }
  return lines.join('\n');
}

/** Per-squad: chunked EOD output with date header + legend */
export async function buildEodChunks(
  squadId:   string,
  squadName: string,
  ctx?:      MentionContext,
): Promise<string[]> {
  const ictOffset = 7 * 60 * 60 * 1000;
  const todayICT  = new Date(Date.now() + ictOffset);
  const todayTH   = thaiDate(todayICT);

  const { totalRemaining, doneTodayCount, byAssignee } = await fetchEodData(squadId);

  const globalHeader = `EOD Summary — (${todayTH})\nDone · In Progress · In Review · 🚩 Issue`;
  const squadHeader  = `📍 ${squadName} — Remaining ${totalRemaining} · Done ${doneTodayCount}`;

  if (byAssignee.size === 0) {
    return [`${globalHeader}\n\n${squadHeader}`];
  }

  const personBlocks: string[] = [];
  for (const [, person] of Array.from(byAssignee)) {
    const nameTag = ctx
      ? ctx.slot(person.displayName, person.lineUserId)
      : `@${person.displayName}`;
    personBlocks.push([nameTag, ...person.taskLines].join('\n'));
  }

  const firstBody = `${globalHeader}\n\n${squadHeader}\n`;
  const contBase  = `EOD Summary — (${todayTH}) (cont.)\n\n${squadHeader}\n`;

  const chunks: string[] = [];
  let body = firstBody;

  for (const block of personBlocks) {
    const candidate = body + block + '\n';
    if (candidate.length > LINE_CHAR_LIMIT && body !== firstBody) {
      chunks.push(body.trimEnd());
      body = contBase + block + '\n';
    } else {
      body = candidate;
    }
  }

  chunks.push(body.trimEnd());
  return chunks;
}

/**
 * Query QA_MANAGER users with LINE linked, embed them into ctx, and return the footer line.
 * Returns '' if no managers have lineUserId — caller skips appending.
 */
async function buildQaMgrLine(ctx: MentionContext): Promise<string> {
  const managers = await prisma.user.findMany({
    where: { role: 'QA_MANAGER', active: true, deletedAt: null },
    select: { name: true, lineDisplayName: true, lineUserId: true },
    orderBy: { name: 'asc' },
  });
  const linked = managers.filter(m => m.lineUserId);
  console.log(`[QA_MGR] total=${managers.length} linked=${linked.length} names=${managers.map(m => m.name).join(',')}`);
  if (linked.length === 0) return '';
  return linked.map(m => ctx.slot(m.lineDisplayName ?? m.name, m.lineUserId)).join(' ');
}

/**
 * Append QA_MANAGER mention footer to the last chunk.
 * If the footer would push the last chunk over LINE_CHAR_LIMIT, it becomes its own chunk.
 * Returns the (possibly extended) chunks array — same reference if no managers are linked.
 */
export async function appendQaMgrFooter(
  chunks: string[],
  ctx:    MentionContext,
): Promise<string[]> {
  const footer = await buildQaMgrLine(ctx);
  if (!footer) return chunks;

  const last      = chunks[chunks.length - 1];
  const candidate = last + '\n\n' + footer;
  if (candidate.length <= LINE_CHAR_LIMIT) {
    chunks[chunks.length - 1] = candidate;
  } else {
    chunks.push(footer);
  }
  return chunks;
}

/** Send-all: squad EOD section — caller prepends the global date header */
export async function buildEodBlock(
  squadId:   string,
  squadName: string,
  ctx?:      MentionContext,
): Promise<string> {
  const { totalRemaining, doneTodayCount, byAssignee } = await fetchEodData(squadId);
  return formatEodSquadSection(squadName, totalRemaining, doneTodayCount, byAssignee, ctx);
}
