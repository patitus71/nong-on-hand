// app/api/line/send-all/route.ts
// ส่ง standup/EOD ไปทุก squad ในขอบเขตของ user ครั้งเดียว
// Squad ที่ใช้ lineGroupId เดียวกันรวมเป็นข้อความเดียว ไม่ส่งซ้ำ

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canSendLineBroadcast, squadScopeFilter, type SessionUser } from '@/lib/rbac';
import {
  buildStandupBlock,
  buildEodBlock,
  mergeIntoChunks,
  appendQaMgrFooter,
} from '@/lib/squadLineMessages';
import {
  sendLineGroupMessageWithMention,
  MentionContext,
  thaiDate,
} from '@/lib/lineNotify';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser & { name: string };

  if (!canSendLineBroadcast(user)) {
    return new Response('Forbidden', { status: 403 });
  }

  const { type } = (await req.json()) as { type: 'standup' | 'eod' };
  if (type !== 'standup' && type !== 'eod') {
    return new Response('type must be standup or eod', { status: 400 });
  }

  // Squads in scope that have a LINE group configured
  const scopeFilter = squadScopeFilter(user);
  const squads = await prisma.squad.findMany({
    where:  { ...scopeFilter, lineGroupId: { not: null } },
    select: { id: true, name: true, lineGroupId: true },
    orderBy: { name: 'asc' },
  });

  if (squads.length === 0) {
    return Response.json({ ok: true, sentMessages: 0, totalSquads: 0, groupCount: 0 });
  }

  // Group squads by lineGroupId — squads sharing a group get one combined message
  const byGroup = new Map<string, Array<{ id: string; name: string }>>();
  for (const s of squads) {
    const gid = s.lineGroupId!;
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid)!.push({ id: s.id, name: s.name });
  }

  let sentMessages = 0;

  for (const [groupId, groupSquads] of Array.from(byGroup)) {
    const ctx = new MentionContext();
    let chunks: string[];

    if (type === 'standup') {
      const todayTH = thaiDate(new Date(Date.now() + 7 * 60 * 60 * 1000));
      const parts: string[] = [`Standup — (${todayTH})\nIn Progress · Next up`];
      for (const sq of groupSquads) {
        parts.push(await buildStandupBlock(sq.id, sq.name, ctx));
      }
      chunks = mergeIntoChunks(parts);
    } else {
      const ictOffset = 7 * 60 * 60 * 1000;
      const todayICT  = new Date(Date.now() + ictOffset);
      const todayTH   = thaiDate(todayICT);
      const parts: string[] = [`EOD Summary — (${todayTH})\nDone · In Progress · In Review · 🚩 Issue`];
      for (const sq of groupSquads) {
        parts.push(await buildEodBlock(sq.id, sq.name, ctx));
      }
      chunks = mergeIntoChunks(parts);
    }

    chunks = await appendQaMgrFooter(chunks, ctx);

    console.log(`[send-all/${type}] group=${groupId} squads=${groupSquads.map(s => s.name).join(',')} chunks=${chunks.length} mentions=${ctx.hasAny}`);

    for (let i = 0; i < chunks.length; i++) {
      const r = await sendLineGroupMessageWithMention(groupId, chunks[i], ctx);
      if (r.success) {
        sentMessages++;
      } else {
        console.error(`[send-all/${type}] group=${groupId} chunk=${i}:`, r.reason);
      }
    }
  }

  return Response.json({
    ok:           true,
    sentMessages,
    totalSquads:  squads.length,
    groupCount:   byGroup.size,
  });
}
