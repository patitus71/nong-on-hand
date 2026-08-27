// app/api/cron/eod/route.ts
//
// ยิงจาก external scheduler (cron-job.org) ทุก ~5-10 นาที — Vercel Hobby plan
// ไม่รองรับ cron ถี่กว่ารายวัน และ GitHub Actions schedule trigger ไม่น่าเชื่อถือ
// พอสำหรับ interval ระดับนาที (ทดลองแล้วดีเลย์ได้เป็นชั่วโมง) จึงย้ายมาใช้
// external cron service เป็นตัวยิง request เข้ามาแทน endpoint นี้ไม่เปลี่ยน
// security model ใดๆ
//
// ส่ง EOD summary ไปยัง squad ที่ตั้ง eodAutoSendEnabled=true และเวลาปัจจุบัน (ICT)
// อยู่ในช่วง [eodSendTime, eodSendTime + WINDOW_MINUTES) — ดู lib/cronWindow.ts
// สำหรับเหตุผลที่เทียบเป็นช่วงแทนตรงเป๊ะ (scheduler ไม่การันตีความแม่นยำระดับนาที)
//
// Security: CRON_SECRET fail-closed — ถ้าไม่ได้ตั้งค่า หรือ header ไม่ตรง → 401 ทันที
// Dedup: lastEodSentAt ต้องเก่ากว่า WINDOW_MINUTES ที่แล้ว ไม่งั้นข้าม (กัน cron รันซ้อน)

import { prisma } from '@/lib/prisma';
import {
  buildEodBlock,
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
        eodAutoSendEnabled: true,
        eodSendTime:        { not: null },
      },
    },
    select: {
      id: true, name: true, lineGroupId: true,
      notificationSettings: { select: { eodSendTime: true, lastEodSentAt: true } },
    },
  });

  const squads = candidates.filter(s => {
    const ns = s.notificationSettings;
    if (!ns?.eodSendTime) return false;
    if (!inSendWindow(ns.eodSendTime, nowMinutes)) return false;
    if (alreadySentThisWindow(ns.lastEodSentAt)) return false;
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
    const ictNow   = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const todayTH  = thaiDate(ictNow);
    const parts: string[] = [`EOD Summary — (${todayTH})\nDone · In Progress · In Review · 🚩 Issue`];

    for (const sq of groupSquads) {
      parts.push(await buildEodBlock(sq.id, sq.name, ctx));
    }

    let chunks = mergeIntoChunks(parts);
    chunks     = await appendQaMgrFooter(chunks, ctx);

    console.log(`[cron/eod] nowMinutes=${nowMinutes} group=${groupId} squads=${groupSquads.map(s => s.name).join(',')} chunks=${chunks.length}`);

    let groupSent = false;
    for (let i = 0; i < chunks.length; i++) {
      const r = await sendLineGroupMessageWithMention(groupId, chunks[i], ctx);
      if (r.success) {
        fired++;
        groupSent = true;
      } else {
        console.error(`[cron/eod] group=${groupId} chunk=${i}:`, r.reason);
      }
    }

    // Update lastEodSentAt for all squads in this group (dedup)
    if (groupSent) {
      await prisma.notificationSettings.updateMany({
        where:  { squadId: { in: groupSquads.map(s => s.id) } },
        data:   { lastEodSentAt: new Date() },
      });
    }
  }

  return Response.json({ ok: true, fired, nowMinutes, groupCount: byGroup.size });
}
