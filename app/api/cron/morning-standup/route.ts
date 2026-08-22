// app/api/cron/morning-standup/route.ts
//
// Vercel Cron Job — ส่ง standup เช้าเข้า LINE group ของแต่ละ squad (0 2 * * * UTC = 09:00 ICT)
// Security: ตรวจ Authorization: Bearer <CRON_SECRET> ที่ Vercel แนบให้อัตโนมัติ

import { prisma } from '@/lib/prisma';
import { sendLineTextMessage, thaiDate } from '@/lib/lineNotify';
import { computeSquadBoardStatus } from '@/lib/importTasks';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const squads = await prisma.squad.findMany({
    where:  { lineGroupId: { not: null } },
    select: { id: true, name: true, lineGroupId: true },
  });

  const results: { squad: string; success: boolean; reason?: string }[] = [];

  for (const squad of squads) {
    const tasks = await prisma.task.findMany({
      where: {
        squadId:           squad.id,
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

    // Group tasks by assignee — แยก "กำลังทำ" vs "คิวถัดไป"
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
        // On-Board (To do lane, assigned), Wait for review
        entry.queue.push(label);
      }
    }

    // Build message
    const todayTH = thaiDate(new Date());
    const lines: string[] = [`☀️ Standup เช้านี้ — ${squad.name} (${todayTH})`];
    let totalOnBoard = 0;

    for (const [, person] of Array.from(byAssignee)) {
      lines.push('');
      lines.push(`🧑 ${person.name}`);
      for (const t of person.doing) {
        lines.push(`  • กำลังทำ: ${t}`);
      }
      for (const t of person.queue) {
        lines.push(`  • คิวถัดไป: ${t}`);
      }
      totalOnBoard += person.doing.length + person.queue.length;
    }

    if (byAssignee.size === 0) {
      lines.push('');
      lines.push('ไม่มีงานในบอร์ดวันนี้');
    } else {
      lines.push('');
      lines.push(`รวม ${totalOnBoard} งาน On-Board วันนี้`);
    }

    const result = await sendLineTextMessage(squad.lineGroupId!, lines.join('\n'));
    results.push({ squad: squad.name, ...result });

    if (!result.success) {
      console.error(`[standup] Failed to send LINE to squad ${squad.name}:`, result.reason);
    }
  }

  return Response.json({ ok: true, results });
}
