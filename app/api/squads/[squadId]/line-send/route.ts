// app/api/squads/[squadId]/line-send/route.ts
// กดส่ง standup หรือ EOD summary เข้า LINE group ของ squad นี้โดย QA_LEAD/ADMIN/floating-pool

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageSprint, type SessionUser } from '@/lib/rbac';
import {
  buildStandupText,
  buildEodChunks,
  HINT_RELINK,
  fetchStandupAssigneeIds,
  fetchEodAssigneeIds,
} from '@/lib/squadLineMessages';
import {
  sendLineTextMessage,
  sendLineGroupMessageWithMention,
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

  // Mentions = task assignees of this squad who have LINE linked (any role)
  const assigneeIds = type === 'standup'
    ? await fetchStandupAssigneeIds([squad.id])
    : await fetchEodAssigneeIds([squad.id]);

  const assigneeUsers = assigneeIds.length > 0
    ? await prisma.user.findMany({
        where:  { id: { in: assigneeIds }, lineUserId: { not: null }, active: true, deletedAt: null },
        select: { name: true, lineUserId: true, lineDisplayName: true },
      })
    : [];

  const mentions = assigneeUsers.map(u => ({
    placeholderName: `@${u.lineDisplayName ?? u.name}`,
    userId:          u.lineUserId!,
  }));

  console.log(`[line-send/${type}] squad=${squad.name} assignees=${assigneeIds.length} mentions=${JSON.stringify(mentions)}`);

  const needsRelinkHint = assigneeUsers.some(u => !u.lineDisplayName);

  let result: { success: boolean; reason?: string };

  if (type === 'standup') {
    let text = await buildStandupText(squad.id, squad.name);
    if (needsRelinkHint) text += '\n\n' + HINT_RELINK;

    result = mentions.length > 0
      ? await sendLineGroupMessageWithMention(squad.lineGroupId, text, mentions)
      : await sendLineTextMessage(squad.lineGroupId, text);
  } else {
    const chunks = await buildEodChunks(squad.id, squad.name);
    if (needsRelinkHint) chunks[chunks.length - 1] += '\n\n' + HINT_RELINK;

    result = { success: true };
    for (const chunk of chunks) {
      const r = mentions.length > 0
        ? await sendLineGroupMessageWithMention(squad.lineGroupId, chunk, mentions)
        : await sendLineTextMessage(squad.lineGroupId, chunk);
      if (!r.success) { result = r; break; }
    }
  }

  if (!result.success) {
    console.error(`[line-send/${type}] squad=${squad.name}:`, result.reason);
  }

  return Response.json({ ok: result.success, reason: result.reason });
}
