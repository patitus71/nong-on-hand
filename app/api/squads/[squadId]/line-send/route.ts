// app/api/squads/[squadId]/line-send/route.ts
// กดส่ง standup หรือ EOD summary เข้า LINE group ของ squad นี้โดย QA_LEAD/ADMIN/floating-pool

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageSprint, type SessionUser } from '@/lib/rbac';
import { computeSquadBoardStatus } from '@/lib/importTasks';
import {
  sendLineTextMessage,
  sendLineGroupMessageWithMention,
  thaiDate,
  formatMinutes,
} from '@/lib/lineNotify';

const HINT_RELINK = '💡 บางบัญชียังไม่มีชื่อ LINE — พิมพ์ /link <username> ในกลุ่มนี้อีกครั้งเพื่ออัปเดต';

export async function POST(
  req: Request,
  { params }: { params: { squadId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser & { name: string };

  if (!canManageSprint(user, params.squadId)) {
    return new Response('Forbidden', { status: 403 });
  }

  const { type } = (await req.json()) as { type: 'standup' | 'eod' };
  if (type !== 'standup' && type !== 'eod') {
    return new Response('type must be standup or eod', { status: 400 });
  }

  const squad = await prisma.squad.findUnique({
    where:  { id: params.squadId },
    select: { id: true, name: true, lineGroupId: true },
  });
  if (!squad) return new Response('Not Found', { status: 404 });
  if (!squad.lineGroupId) {
    return Response.json({ ok: false, reason: 'Squad ยังไม่ได้ตั้งค่า lineGroupId' }, { status: 422 });
  }

  // Query QA_MANAGER ที่ self-link บัญชี LINE แล้ว — ใช้ @mention ใน message
  const managers = await prisma.user.findMany({
    where:  { role: 'QA_MANAGER', lineUserId: { not: null }, active: true, deletedAt: null },
    select: { name: true, lineUserId: true, lineDisplayName: true },
  });

  const mentions = managers
    .filter(m => m.lineUserId)
    .map(m => ({ placeholderName: `@${m.lineDisplayName ?? m.name}`, userId: m.lineUserId! }));

  const needsRelinkHint = managers.some(m => m.lineUserId && !m.lineDisplayName);
  const mentionPrefix   = mentions.length > 0 ? mentions.map(m => m.placeholderName).join(' ') + '\n' : '';

  let result: { success: boolean; reason?: string };

  if (type === 'standup') {
    let text = await buildStandupText(squad.id, squad.name);
    if (needsRelinkHint) text += '\n\n' + HINT_RELINK;

    if (mentions.length > 0) {
      result = await sendLineGroupMessageWithMention(squad.lineGroupId, mentionPrefix + text, mentions);
    } else {
      result = await sendLineTextMessage(squad.lineGroupId, text);
    }
  } else {
    const chunks = await buildEodChunks(squad.id, squad.name);
    if (needsRelinkHint) chunks[chunks.length - 1] += '\n\n' + HINT_RELINK;

    result = { success: true };
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0 && mentions.length > 0;
      const msg     = isFirst ? mentionPrefix + chunks[i] : chunks[i];
      const r       = isFirst
        ? await sendLineGroupMessageWithMention(squad.lineGroupId, msg, mentions)
        : await sendLineTextMessage(squad.lineGroupId, msg);
      if (!r.success) { result = r; break; }
    }
  }

  if (!result.success) {
    console.error(`[line-send/${type}] squad=${squad.name}:`, result.reason);
  }

  return Response.json({ ok: result.success, reason: result.reason });
}

// ─── Standup builder (unchanged) ──────────────────────────────────────────────

async function buildStandupText(squadId: string, squadName: string): Promise<string> {
  const tasks = await prisma.task.findMany({
    where: {
      squadId,
      deletedAt:         null,
      pulledIntoBoardAt: { not: null },
      laneId:            { not: null },
    },
    select: {
      id: true, title: true, hasIssue: true, assigneeId: true, laneId: true,
      assignee: { select: { name: true } },
      lane:     { select: { name: true } },
    },
    orderBy: { order: 'asc' },
  });

  const byAssignee = new Map<string, { name: string; doing: string[]; queue: string[] }>();
  for (const task of tasks) {
    if (!task.assigneeId || !task.assignee) continue;
    const status = computeSquadBoardStatus(task);
    if (status === 'Done') continue;
    if (!byAssignee.has(task.assigneeId)) {
      byAssignee.set(task.assigneeId, { name: task.assignee.name, doing: [], queue: [] });
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
    lines.push(`🧑 ${person.name}`);
    for (const t of person.doing) lines.push(`  • กำลังทำ: ${t}`);
    for (const t of person.queue) lines.push(`  • คิวถัดไป: ${t}`);
    totalOnBoard += person.doing.length + person.queue.length;
  }

  lines.push('');
  lines.push(byAssignee.size === 0 ? 'ไม่มีงานในบอร์ดวันนี้' : `รวม ${totalOnBoard} งาน On-Board วันนี้`);
  return lines.join('\n');
}

// ─── EOD builder ──────────────────────────────────────────────────────────────

// Statuses shown in per-person list
const EOD_SHOW = new Set<string>(['On-Board In Progress', 'Wait for review', 'มีปัญหา', 'Done']);

function eodStatusLabel(status: string): string {
  if (status === 'On-Board In Progress') return 'In Progress';
  if (status === 'Wait for review')      return 'Review';
  return status; // 'Done' and 'มีปัญหา' displayed as-is
}

// LINE's hard limit is 5,000 chars; leave buffer for mention prefix
const EOD_CHAR_LIMIT = 4800;

async function buildEodChunks(squadId: string, squadName: string): Promise<string[]> {
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

  // ── Summary counts (all non-Done — shown in footer, unchanged) ───────────────
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
  const parts = statusOrder.filter(s => statusCount[s]).map(s => `${s}: ${statusCount[s]}`);

  const footerLines: string[] = [
    `งานที่เหลือ (ยังไม่ Done): ${totalRemaining} งาน`,
    ...(parts.length > 0 ? [`  ${parts.join(' · ')}`] : []),
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

  // ── Per-person blocks — only actionable statuses, skip To do list / On-Board ──
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

  // ── Chunk at person boundaries to stay under LINE's char limit ───────────────
  const chunks: string[] = [];
  let body = header + '\n';

  for (const block of personBlocks) {
    const candidate  = body + '\n' + block + '\n';
    const withFooter = candidate + '\n' + footer;
    if (withFooter.length > EOD_CHAR_LIMIT && body !== header + '\n') {
      // Flush current chunk without footer; continue on next chunk
      chunks.push(body.trimEnd());
      body = `${header} (ต่อ)\n\n${block}\n`;
    } else {
      body = candidate;
    }
  }

  // Last chunk always carries the footer
  chunks.push(body.trimEnd() + '\n\n' + footer);

  return chunks;
}
