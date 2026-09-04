// lib/squadLineMessages.ts
// Shared standup/EOD message builders — imported by both per-squad and all-squads LINE send routes

import { prisma } from '@/lib/prisma';
import { computeSquadBoardStatus } from '@/lib/importTasks';
import { thaiDate, MentionContext } from '@/lib/lineNotify';
import { calcSprintDurationDays } from '@/lib/sprint';

// LINE hard limit is 5,000 chars; leave buffer for mention prefix
export const LINE_CHAR_LIMIT = 4800;

// ─── Standup ──────────────────────────────────────────────────────────────────

type TaskItem = { title: string; hasIssue: boolean; issueNote: string | null };

type StandupPerson = {
  displayName: string;
  lineUserId:  string | null;
  doing:       TaskItem[];
  queue:       TaskItem[];
};

async function fetchStandupPersons(squadId: string): Promise<Map<string, StandupPerson>> {
  // laneId, not pulledIntoBoardAt, is the "on board" signal — pulledIntoBoardAt is set
  // only by the import pull-in flow, so tasks created directly on a board never have it.
  const tasks = await prisma.task.findMany({
    where: {
      squadId,
      deletedAt:   null,
      laneId:      { not: null },
      isCancelled: false,
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
//
// Bucket order per task (mirrors the Squad Board's own mental model — a flagged
// card is pulled out of its normal lane into a separate "มีปัญหา" area, and a
// cancelled task keeps hasIssue=true forever by design — see schema comment on
// Task.cancelNote — so isCancelled MUST be checked before hasIssue, else every
// cancelled task would show up as an "unresolved" issue forever):
//   1. isCancelled  → Cancel (today) bucket, only if cancelledAt falls in today's ICT range
//   2. hasIssue     → squad-level 🚩 Issues (unresolved) list, no date filter, not per-person
//   3. else         → lane.name (today-filtered only for Done)

type EodPerson = {
  displayName: string;
  lineUserId:  string | null;
  todo:        string[];
  inProgress:  string[];
  review:      string[];
  doneToday:   string[];
  cancelToday: string[];
};

function eodPersonTotal(p: EodPerson): number {
  return p.todo.length + p.inProgress.length + p.review.length + p.doneToday.length + p.cancelToday.length;
}

async function fetchEodData(squadId: string): Promise<{
  byAssignee: Map<string, EodPerson>;
  issues:     string[];
}> {
  const ictOffset  = 7 * 60 * 60 * 1000;
  const todayICT   = new Date(Date.now() + ictOffset);
  const yyyymmdd   = todayICT.toISOString().slice(0, 10);
  const todayStart = new Date(`${yyyymmdd}T00:00:00+07:00`);
  const todayEnd   = new Date(`${yyyymmdd}T23:59:59.999+07:00`);

  const tasks = await prisma.task.findMany({
    where:  { squadId, deletedAt: null },
    select: {
      id: true, title: true, hasIssue: true, isCancelled: true,
      completedAt: true, cancelledAt: true, assigneeId: true,
      assignee: { select: { name: true, lineDisplayName: true, lineUserId: true } },
      lane:     { select: { name: true } },
    },
  });

  const byAssignee = new Map<string, EodPerson>();
  const issues: string[] = [];

  const personEntry = (task: (typeof tasks)[number]): EodPerson => {
    const key = task.assigneeId!;
    if (!byAssignee.has(key)) {
      byAssignee.set(key, {
        displayName: task.assignee!.lineDisplayName ?? task.assignee!.name,
        lineUserId:  task.assignee!.lineUserId,
        todo: [], inProgress: [], review: [], doneToday: [], cancelToday: [],
      });
    }
    return byAssignee.get(key)!;
  };

  for (const task of tasks) {
    if (task.hasIssue && !task.isCancelled) {
      issues.push(task.title);
      continue;
    }
    if (!task.assigneeId || !task.assignee) continue;

    if (task.isCancelled) {
      if (task.cancelledAt && task.cancelledAt >= todayStart && task.cancelledAt <= todayEnd) {
        personEntry(task).cancelToday.push(task.title);
      }
      continue;
    }

    const laneName = task.lane?.name?.toLowerCase();
    if (laneName === 'done') {
      if (task.completedAt && task.completedAt >= todayStart && task.completedAt <= todayEnd) {
        personEntry(task).doneToday.push(task.title);
      }
    } else if (laneName === 'to do') {
      personEntry(task).todo.push(task.title);
    } else if (laneName === 'in progress') {
      personEntry(task).inProgress.push(task.title);
    } else if (laneName === 'review') {
      personEntry(task).review.push(task.title);
    }
  }

  return { byAssignee, issues };
}

/** One person's block — null if they have nothing to show (rule: omit entirely). */
function formatEodPersonBlock(person: EodPerson, ctx?: MentionContext): string | null {
  if (eodPersonTotal(person) === 0) return null;

  const nameTag = ctx ? ctx.slot(person.displayName, person.lineUserId) : `@${person.displayName}`;
  const lines: string[] = [nameTag];

  const sub = (label: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(label);
    for (const title of items) lines.push(`- ${title}`);
    lines.push('');
  };
  sub('Todo', person.todo);
  sub('In Progress', person.inProgress);
  sub('Review', person.review);
  sub('Done (today)', person.doneToday);
  sub('Cancel (today)', person.cancelToday);

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

function formatEodIssuesBlock(issues: string[]): string {
  return ['🚩 Issues (unresolved)', ...issues.map(title => `- ${title}`)].join('\n');
}

/**
 * Builds the person blocks + squad-wide issues block + total task count for one squad.
 * total = sum of the 5 per-person buckets across everyone (rule: excludes unresolved
 * issues, since those tasks are already pulled out of the 5 buckets above).
 */
function buildEodSquadParts(
  squadName:  string,
  byAssignee: Map<string, EodPerson>,
  issues:     string[],
  ctx?:       MentionContext,
): { header: string; blocks: string[] } {
  let total = 0;
  const personBlocks: string[] = [];
  for (const [, person] of Array.from(byAssignee)) {
    total += eodPersonTotal(person);
    const block = formatEodPersonBlock(person, ctx);
    if (block) personBlocks.push(block);
  }

  const blocks = [...personBlocks];
  if (issues.length > 0) blocks.push(formatEodIssuesBlock(issues));

  const header = `📍 ${squadName} — ${total} ${total === 1 ? 'task' : 'tasks'}`;
  return { header, blocks };
}

function formatEodSquadSection(
  squadName:  string,
  byAssignee: Map<string, EodPerson>,
  issues:     string[],
  ctx?:       MentionContext,
): string {
  const { header, blocks } = buildEodSquadParts(squadName, byAssignee, issues, ctx);
  return [header, ...blocks].join('\n\n');
}

/** Per-squad: chunked EOD output with date header */
export async function buildEodChunks(
  squadId:   string,
  squadName: string,
  ctx?:      MentionContext,
): Promise<string[]> {
  const ictOffset = 7 * 60 * 60 * 1000;
  const todayICT  = new Date(Date.now() + ictOffset);
  const todayTH   = thaiDate(todayICT);

  const { byAssignee, issues } = await fetchEodData(squadId);
  const { header: squadHeader, blocks } = buildEodSquadParts(squadName, byAssignee, issues, ctx);

  const globalHeader = `EOD Summary — (${todayTH})`;

  if (blocks.length === 0) {
    return [`${globalHeader}\n\n${squadHeader}`];
  }

  const firstBody = `${globalHeader}\n\n${squadHeader}\n\n`;
  const contBase  = `EOD Summary — (${todayTH}) (cont.)\n\n${squadHeader}\n\n`;

  const chunks: string[] = [];
  let body = firstBody;

  for (const block of blocks) {
    const candidate = body + block + '\n\n';
    if (candidate.length > LINE_CHAR_LIMIT && body !== firstBody && body !== contBase) {
      chunks.push(body.trimEnd());
      body = contBase + block + '\n\n';
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
  const { byAssignee, issues } = await fetchEodData(squadId);
  return formatEodSquadSection(squadName, byAssignee, issues, ctx);
}

// ─── End of Sprint ─────────────────────────────────────────────────────────────
//
// One-shot summary sent right when a sprint is closed (app/api/sprints/[sprintId]/close).
// Unlike EOD, empty categories are shown as "_ไม่มี_" rather than omitted — this is a
// whole-sprint retrospective, not a daily digest, so every category should be visible.
// No @mention — plain text is fine (rule: QA_LEAD/ADMIN closing the sprint already reads it).

/**
 * Builds the "End of Sprint" report for the given (already-closed) sprint.
 * Reads sprint.closedAt back from the DB rather than taking a Date param, so the
 * header and the TaskIssueLog.flaggedAt upper bound always agree with what was persisted.
 */
export async function buildEndOfSprintReport(sprintId: string): Promise<string[]> {
  const sprint = await prisma.sprint.findUnique({
    where:  { id: sprintId },
    select: {
      id: true, name: true, startedAt: true, closedAt: true,
      squad: { select: { name: true } },
    },
  });
  if (!sprint) throw new Error(`Sprint ${sprintId} not found`);

  const closedAt = sprint.closedAt ?? new Date();
  const ictOffset = 7 * 60 * 60 * 1000;

  const tasks = await prisma.task.findMany({
    where:  { sprintId, deletedAt: null },
    select: {
      id: true, title: true, isCancelled: true, assigneeId: true,
      assignee: { select: { name: true, lineDisplayName: true } },
      lane:     { select: { name: true } },
    },
  });

  const doneByAssignee   = new Map<string, { name: string; titles: string[] }>();
  const cancelByAssignee = new Map<string, { name: string; titles: string[] }>();
  const carried = { todo: [] as string[], inProgress: [] as string[], review: [] as string[] };

  for (const task of tasks) {
    const personName = task.assignee ? (task.assignee.lineDisplayName ?? task.assignee.name) : null;

    if (task.isCancelled) {
      if (task.assigneeId && personName) {
        if (!cancelByAssignee.has(task.assigneeId)) cancelByAssignee.set(task.assigneeId, { name: personName, titles: [] });
        cancelByAssignee.get(task.assigneeId)!.titles.push(task.title);
      }
      continue;
    }

    const laneName = task.lane?.name?.toLowerCase();
    if (laneName === 'done') {
      if (task.assigneeId && personName) {
        if (!doneByAssignee.has(task.assigneeId)) doneByAssignee.set(task.assigneeId, { name: personName, titles: [] });
        doneByAssignee.get(task.assigneeId)!.titles.push(task.title);
      }
    } else if (laneName === 'to do') {
      carried.todo.push(task.title);
    } else if (laneName === 'in progress') {
      carried.inProgress.push(task.title);
    } else if (laneName === 'review') {
      carried.review.push(task.title);
    }
  }

  const issueLogs = await prisma.taskIssueLog.findMany({
    where: {
      task:      { sprintId },
      flaggedAt: { gte: sprint.startedAt, lte: closedAt },
    },
    select:  { resolvedAt: true, task: { select: { title: true } } },
    orderBy: { flaggedAt: 'asc' },
  });

  const doneCount    = Array.from(doneByAssignee.values()).reduce((n, p) => n + p.titles.length, 0);
  const cancelCount  = Array.from(cancelByAssignee.values()).reduce((n, p) => n + p.titles.length, 0);
  const carriedCount = carried.todo.length + carried.inProgress.length + carried.review.length;

  const durationDays = calcSprintDurationDays(sprint.startedAt, closedAt);
  const startedTH    = thaiDate(new Date(sprint.startedAt.getTime() + ictOffset));
  const closedTH     = thaiDate(new Date(closedAt.getTime() + ictOffset));

  const headerPart = [
    `📊 End of Sprint — ${sprint.name} (${sprint.squad.name})`,
    `${startedTH} – ${closedTH} (${durationDays} วัน)`,
  ].join('\n');

  const doneLines = [`✅ Done (${doneCount})`];
  if (doneByAssignee.size === 0) {
    doneLines.push('_ไม่มี_');
  } else {
    for (const [, p] of Array.from(doneByAssignee)) {
      doneLines.push(`@${p.name}`);
      for (const title of p.titles) doneLines.push(`- ${title}`);
    }
  }

  const cancelLines = [`🚫 Cancelled (${cancelCount})`];
  if (cancelByAssignee.size === 0) {
    cancelLines.push('_ไม่มี_');
  } else {
    for (const [, p] of Array.from(cancelByAssignee)) {
      cancelLines.push(`@${p.name}`);
      for (const title of p.titles) cancelLines.push(`- ${title}`);
    }
  }

  const issueLines = [`🚩 Issues encountered (${issueLogs.length})`];
  if (issueLogs.length === 0) {
    issueLines.push('_ไม่มี_');
  } else {
    for (const log of issueLogs) {
      issueLines.push(`- ${log.task.title} (${log.resolvedAt ? 'แก้แล้ว' : 'ยังไม่แก้'})`);
    }
  }

  const carriedLines = [`➡️ Carried to next sprint (${carriedCount})`];
  const carriedSub = (label: string, items: string[]) => {
    carriedLines.push(`${label}:`);
    if (items.length === 0) carriedLines.push('_ไม่มี_');
    else for (const title of items) carriedLines.push(`- ${title}`);
  };
  carriedSub('Todo', carried.todo);
  carriedSub('In Progress', carried.inProgress);
  carriedSub('Review', carried.review);

  const parts = [headerPart, doneLines.join('\n'), cancelLines.join('\n'), issueLines.join('\n'), carriedLines.join('\n')];
  return mergeIntoChunks(parts);
}
