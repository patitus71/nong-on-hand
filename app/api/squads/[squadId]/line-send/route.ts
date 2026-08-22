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

  let text: string;

  if (type === 'standup') {
    text = await buildStandupText(squad.id, squad.name);
  } else {
    text = await buildEodText(squad.id, squad.name);
  }

  // เพิ่ม @mention prefix ถ้ามี manager ที่ link แล้ว
  const mentions = managers
    .filter(m => m.lineUserId)
    .map(m => ({ placeholderName: `@${m.lineDisplayName ?? m.name}`, userId: m.lineUserId! }));

  // แนะนำ user เก่าที่มี lineUserId แต่ยังไม่มี lineDisplayName ให้ /link ใหม่
  const needsRelinkHint = managers.some(m => m.lineUserId && !m.lineDisplayName);

  let fullText = text;
  if (needsRelinkHint) {
    fullText += '\n\n💡 บางบัญชียังไม่มีชื่อ LINE — พิมพ์ /link <username> ในกลุ่มนี้อีกครั้งเพื่ออัปเดต';
  }

  let result: { success: boolean; reason?: string };

  if (mentions.length > 0) {
    const mentionPrefix = mentions.map(m => m.placeholderName).join(' ') + '\n';
    result = await sendLineGroupMessageWithMention(squad.lineGroupId, mentionPrefix + fullText, mentions);
  } else {
    result = await sendLineTextMessage(squad.lineGroupId, fullText);
  }

  if (!result.success) {
    console.error(`[line-send/${type}] squad=${squad.name}:`, result.reason);
  }

  return Response.json({ ok: result.success, reason: result.reason });
}

// ─── message builders (reuse logic from cron routes) ─────────────────────────

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

async function buildEodText(squadId: string, squadName: string): Promise<string> {
  const ictOffset = 7 * 60 * 60 * 1000;
  const todayICT  = new Date(Date.now() + ictOffset);
  const yyyymmdd  = todayICT.toISOString().slice(0, 10);
  const todayStart = new Date(`${yyyymmdd}T00:00:00+07:00`);
  const todayEnd   = new Date(`${yyyymmdd}T23:59:59.999+07:00`);

  const tasks = await prisma.task.findMany({
    where:  { squadId, deletedAt: null },
    select: {
      id: true, title: true, hasIssue: true, laneId: true,
      assigneeId: true, completedAt: true,
      assignee: { select: { name: true } },
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

  const todayTH = thaiDate(todayICT);
  const lines: string[] = [`📊 สรุปสิ้นวัน — ${squadName} (${todayTH})`, ''];

  lines.push(`งานที่เหลือ (ยังไม่ Done): ${totalRemaining} งาน`);
  const statusOrder = ['To do list', 'On-Board', 'On-Board In Progress', 'Wait for review', 'มีปัญหา'];
  const parts = statusOrder.filter(s => statusCount[s]).map(s => `${s}: ${statusCount[s]}`);
  if (parts.length > 0) lines.push(`  ${parts.join(' · ')}`);

  lines.push('');
  lines.push(`งานที่เสร็จวันนี้: ${doneToday.length} งาน`);
  for (const t of doneToday) {
    const totalMin = t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0) + (l.otMinutes ?? 0), 0);
    const timeStr  = totalMin > 0 ? ` (${formatMinutes(totalMin)})` : '';
    lines.push(`  • ${t.assignee?.name ?? 'ไม่ระบุ'}: ${t.title}${timeStr}`);
  }
  if (doneToday.length === 0) lines.push('  ไม่มีงานที่เสร็จวันนี้');

  return lines.join('\n');
}
