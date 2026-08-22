// app/api/cron/eod-summary/route.ts
//
// Vercel Cron Job — ส่งสรุปสิ้นวันเข้า LINE group ของแต่ละ squad (0 11 * * * UTC = 18:00 ICT)
// Security: ตรวจ Authorization: Bearer <CRON_SECRET> ที่ Vercel แนบให้อัตโนมัติ

import { prisma } from '@/lib/prisma';
import { sendLineTextMessage, thaiDate, formatMinutes } from '@/lib/lineNotify';
import { computeSquadBoardStatus } from '@/lib/importTasks';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  // คำนวณ "วันนี้" ใน timezone ICT (UTC+7)
  const now = new Date();
  const ictOffset = 7 * 60 * 60 * 1000;
  const todayICT = new Date(now.getTime() + ictOffset);
  const yyyymmdd = todayICT.toISOString().slice(0, 10); // "2026-08-22"
  const todayStart = new Date(`${yyyymmdd}T00:00:00+07:00`);
  const todayEnd   = new Date(`${yyyymmdd}T23:59:59.999+07:00`);

  const squads = await prisma.squad.findMany({
    where:  { lineGroupId: { not: null } },
    select: { id: true, name: true, lineGroupId: true },
  });

  const results: { squad: string; success: boolean; reason?: string }[] = [];

  for (const squad of squads) {
    // Query งานทั้งหมดของ squad ที่ยังไม่ลบ
    const tasks = await prisma.task.findMany({
      where: {
        squadId:   squad.id,
        deletedAt: null,
      },
      select: {
        id: true, title: true, hasIssue: true,
        assigneeId: true, completedAt: true,
        assignee: { select: { name: true } },
        lane:     { select: { name: true } },
        laneId: true,
        timeLogs: {
          where:  { endAt: { not: null } },
          select: { normalMinutes: true, otMinutes: true },
        },
      },
    });

    // นับงานที่เหลือ (ไม่ใช่ Done)
    const statusCount: Record<string, number> = {};
    let totalRemaining = 0;

    for (const task of tasks) {
      const status = computeSquadBoardStatus(task);
      if (status === 'Done') continue;
      statusCount[status] = (statusCount[status] ?? 0) + 1;
      totalRemaining++;
    }

    // งานที่เสร็จวันนี้
    const doneToday = tasks.filter(
      t => t.completedAt && t.completedAt >= todayStart && t.completedAt <= todayEnd
    );

    // Build message
    const todayTH = thaiDate(todayICT);
    const lines: string[] = [`📊 สรุปสิ้นวัน — ${squad.name} (${todayTH})`];
    lines.push('');

    // งานที่เหลือ
    lines.push(`งานที่เหลือ (ยังไม่ Done): ${totalRemaining} งาน`);

    const statusOrder = ['To do list', 'On-Board', 'On-Board In Progress', 'Wait for review', 'มีปัญหา'];
    const statusParts = statusOrder
      .filter(s => statusCount[s])
      .map(s => `${s}: ${statusCount[s]}`);
    if (statusParts.length > 0) {
      lines.push(`  ${statusParts.join(' · ')}`);
    }

    lines.push('');

    // งานที่เสร็จวันนี้
    lines.push(`งานที่เสร็จวันนี้: ${doneToday.length} งาน`);
    for (const task of doneToday) {
      const totalMin = task.timeLogs.reduce((sum, l) => sum + (l.normalMinutes ?? 0) + (l.otMinutes ?? 0), 0);
      const timeStr  = totalMin > 0 ? ` (${formatMinutes(totalMin)})` : '';
      const who      = task.assignee?.name ?? 'ไม่ระบุ';
      lines.push(`  • ${who}: ${task.title}${timeStr}`);
    }

    if (doneToday.length === 0) {
      lines.push('  ไม่มีงานที่เสร็จวันนี้');
    }

    const result = await sendLineTextMessage(squad.lineGroupId!, lines.join('\n'));
    results.push({ squad: squad.name, ...result });

    if (!result.success) {
      console.error(`[eod-summary] Failed to send LINE to squad ${squad.name}:`, result.reason);
    }
  }

  return Response.json({ ok: true, results });
}
