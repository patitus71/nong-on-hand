// app/api/cron/standup/route.ts
//
// ยิงจาก GitHub Actions (.github/workflows/notify-cron.yml) ทุก ~10 นาที
// — Vercel Hobby plan ไม่รองรับ cron ถี่กว่ารายวัน จึงย้ายมาให้ GitHub Actions
// เป็นตัวยิง request เข้ามาแทน endpoint นี้ไม่เปลี่ยน security model ใดๆ
//
// ส่ง standup ไปยัง squad ที่ตั้ง standupAutoSendEnabled=true และเวลาปัจจุบัน (ICT)
// อยู่ในช่วง [standupSendTime, standupSendTime + WINDOW_MINUTES) — ดู lib/cronWindow.ts
// สำหรับเหตุผลที่เทียบเป็นช่วงแทนตรงเป๊ะ (scheduler ไม่การันตีความแม่นยำระดับนาที)
//
// Security: CRON_SECRET fail-closed — ถ้าไม่ได้ตั้งค่า หรือ header ไม่ตรง → 401 ทันที
// Dedup: lastStandupSentAt ต้องเก่ากว่า WINDOW_MINUTES ที่แล้ว ไม่งั้นข้าม (กัน cron รันซ้อน)

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
import { currentIctMinutes, inSendWindow, alreadySentThisWindow } from '@/lib/cronWindow';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const nowMinutes = currentIctMinutes();

  const candidates = await prisma.squad.findMany({
    where: {
      lineGroupId: { not: null },
      notificationSettings: {
        standupAutoSendEnabled: true,
        standupSendTime:        { not: null },
      },
    },
    select: {
      id: true, name: true, lineGroupId: true,
      notificationSettings: { select: { standupSendTime: true, lastStandupSentAt: true } },
    },
  });

  const squads = candidates.filter(s => {
    const ns = s.notificationSettings;
    if (!ns?.standupSendTime) return false;
    if (!inSendWindow(ns.standupSendTime, nowMinutes)) return false;
    if (alreadySentThisWindow(ns.lastStandupSentAt)) return false;
    return true;
  });

  if (squads.length === 0) {
    return Response.json({ ok: true, fired: 0, nowMinutes });
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

    console.log(`[cron/standup] nowMinutes=${nowMinutes} group=${groupId} squads=${groupSquads.map(s => s.name).join(',')} chunks=${chunks.length}`);

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

  return Response.json({ ok: true, fired, nowMinutes, groupCount: byGroup.size });
}
