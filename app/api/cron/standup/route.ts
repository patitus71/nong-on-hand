// app/api/cron/standup/route.ts
//
// Vercel cron job: ส่ง standup ไปยัง squad ที่ตั้ง standupAutoSendEnabled=true
// และ standupSendTime ตรงกับเวลา ICT ปัจจุบัน (HH:MM)
//
// Security: CRON_SECRET fail-closed — ถ้าไม่ได้ตั้งค่า → 401 ทันที
// Dedup: ข้าม squad ที่เคยส่งภายใน 2 นาทีที่แล้ว (ป้องกัน Vercel retry ยิงซ้ำ)

import { prisma } from '@/lib/prisma';
import {
  buildStandupBlock,
  mergeIntoChunks,
  appendQaMgrFooter,
} from '@/lib/squadLineMessages';
import {
  sendLineGroupMessageWithMention,
  MentionContext,
  thaiDate,
} from '@/lib/lineNotify';

function currentIctHHMM(): string {
  const ict = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const h   = ict.getUTCHours().toString().padStart(2, '0');
  const m   = ict.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const nowICT    = currentIctHHMM();
  const dedupCutoff = new Date(Date.now() - 2 * 60 * 1000); // 2 min ago

  const squads = await prisma.squad.findMany({
    where: {
      lineGroupId: { not: null },
      notificationSettings: {
        standupAutoSendEnabled: true,
        standupSendTime:        nowICT,
        OR: [
          { lastStandupSentAt: null },
          { lastStandupSentAt: { lt: dedupCutoff } },
        ],
      },
    },
    select: { id: true, name: true, lineGroupId: true },
  });

  if (squads.length === 0) {
    return Response.json({ ok: true, fired: 0, time: nowICT });
  }

  // Group squads sharing the same LINE group → one combined message per group
  const byGroup = new Map<string, Array<{ id: string; name: string }>>();
  for (const s of squads) {
    const gid = s.lineGroupId!;
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid)!.push({ id: s.id, name: s.name });
  }

  let fired = 0;

  for (const [groupId, groupSquads] of Array.from(byGroup)) {
    const ctx      = new MentionContext();
    const todayTH  = thaiDate(new Date(Date.now() + 7 * 60 * 60 * 1000));
    const parts: string[] = [`Standup — (${todayTH})\nIn Progress · Next up`];

    for (const sq of groupSquads) {
      parts.push(await buildStandupBlock(sq.id, sq.name, ctx));
    }

    let chunks = mergeIntoChunks(parts);
    chunks     = await appendQaMgrFooter(chunks, ctx);

    console.log(`[cron/standup] time=${nowICT} group=${groupId} squads=${groupSquads.map(s => s.name).join(',')} chunks=${chunks.length}`);

    let groupSent = false;
    for (let i = 0; i < chunks.length; i++) {
      const r = await sendLineGroupMessageWithMention(groupId, chunks[i], ctx);
      if (r.success) {
        fired++;
        groupSent = true;
      } else {
        console.error(`[cron/standup] group=${groupId} chunk=${i}:`, r.reason);
      }
    }

    // Update lastStandupSentAt for all squads in this group (dedup)
    if (groupSent) {
      await prisma.notificationSettings.updateMany({
        where:  { squadId: { in: groupSquads.map(s => s.id) } },
        data:   { lastStandupSentAt: new Date() },
      });
    }
  }

  return Response.json({ ok: true, fired, time: nowICT, groupCount: byGroup.size });
}
