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
