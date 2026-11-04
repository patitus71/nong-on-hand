import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sanitizeJiraUrl } from '@/lib/jira';
import { canAccessSquad } from '@/lib/rbac';
import { randomBytes } from 'crypto';
import { parseTagIds } from '@/lib/tags';
import { checkAttachableTagIds } from '@/lib/tagsServer';

// id รูปแบบเดียวกับ cuid ของ Prisma (ขึ้นต้น c + ตัวเล็ก/ตัวเลข ~25 ตัว) — ต้องรู้ id ก่อน insert
// เพราะ createMany ไม่คืน id กลับมา แต่ต้องใช้ผูก TaskTag ต่อแถวใน transaction เดียวกัน
function newTaskId(): string {
  return 'c' + Date.now().toString(36) + randomBytes(9).toString('hex').slice(0, 16);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  if (!['ADMIN', 'QA_LEAD'].includes(user.role)) {
    return new Response('Forbidden', { status: 403 });
  }

  const { fileName, rows } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response('rows required', { status: 400 });
  }

  // QA_LEAD import ได้เฉพาะ squad ตัวเอง (floating pool ได้ทุก squad) — ไม่งั้นยัดงานเข้าทีมอื่นได้
  const foreign = rows.find((row: any) => row.squadId && !canAccessSquad(user, String(row.squadId)));
  if (foreign) {
    return new Response('Forbidden — import ได้เฉพาะ squad ของตัวเอง', { status: 403 });
  }

  // Tags ต่อแถว (ไม่บังคับ) — เลือกได้เฉพาะ Tag ที่ ADMIN สร้างไว้และยังไม่ archived; ห้ามสร้าง Tag ใหม่ระหว่าง import
  const rowTagIds: string[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const parsed = parseTagIds(rows[i]?.tagIds);
    if (!parsed.ok) return new Response(`แถวที่ ${i + 1}: ${parsed.error}`, { status: 400 });
    rowTagIds.push(parsed.value);
  }
  const allTagIds = Array.from(new Set(rowTagIds.flat()));
  if (allTagIds.length > 0) {
    const tagErr = await checkAttachableTagIds(prisma, allTagIds);
    if (tagErr) return new Response(tagErr, { status: 400 });
  }

  const taskIds = rows.map(() => newTaskId());
  const batchId = newTaskId();
  const taskTagRows = rowTagIds.flatMap((ids, i) => ids.map(tagId => ({ taskId: taskIds[i], tagId })));

  // batch + task + TaskTag ใน transaction เดียว — พังกลางทางจะไม่เหลือ batch/งานครึ่งๆ กลางๆ
  await prisma.$transaction([
    prisma.importBatch.create({
      data: {
        id: batchId,
        fileName: fileName || 'import.csv',
        uploadedById: user.id,
        rowCount: rows.length,
      },
    }),
    prisma.task.createMany({
    data: rows.map((row: any, i: number) => ({
      id:               taskIds[i],
      title:            String(row.title).trim(),
      description:      row.description ? String(row.description).trim() : null,
      squadId:          row.squadId ?? null,
      estimatedHours:   row.estimateHours ? Number(row.estimateHours) : null,
      taskType:         row.taskType ? String(row.taskType).trim() : null,
      taskPoint:        row.taskPoint !== undefined && row.taskPoint !== null ? Number(row.taskPoint) : null,
      jiraTicketNo:     row.jiraTicketNo ? String(row.jiraTicketNo).trim() : null,
      jiraUrl:          sanitizeJiraUrl(row.jiraUrl),
      jiraStatus:       row.jiraStatus ? String(row.jiraStatus).trim() : null,
      source:           'IMPORTED',
      importBatchId:    batchId,
    })),
    }),
    ...(taskTagRows.length > 0 ? [prisma.taskTag.createMany({ data: taskTagRows, skipDuplicates: true })] : []),
  ]);

  return Response.json({ batchId, count: rows.length, taggedRows: rowTagIds.filter(ids => ids.length > 0).length });
}
