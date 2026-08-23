// app/api/squads/[squadId]/line-send/route.ts
// กดส่ง standup หรือ EOD summary เข้า LINE group ของ squad นี้โดย QA_LEAD/ADMIN/floating-pool

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageSprint, type SessionUser } from '@/lib/rbac';
import {
  buildStandupText,
  buildEodChunks,
} from '@/lib/squadLineMessages';
import {
  sendLineGroupMessageWithMention,
  MentionContext,
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

  const ctx = new MentionContext();
  let result: { success: boolean; reason?: string };

  if (type === 'standup') {
    const text = await buildStandupText(squad.id, squad.name, ctx);
    result = await sendLineGroupMessageWithMention(squad.lineGroupId, text, ctx);
  } else {
    const chunks = await buildEodChunks(squad.id, squad.name, ctx);
    result = { success: true };
    for (const chunk of chunks) {
      const r = await sendLineGroupMessageWithMention(squad.lineGroupId, chunk, ctx);
      if (!r.success) { result = r; break; }
    }
  }

  if (!result.success) {
    console.error(`[line-send/${type}] squad=${squad.name}:`, result.reason);
  }

  return Response.json({ ok: result.success, reason: result.reason });
}
