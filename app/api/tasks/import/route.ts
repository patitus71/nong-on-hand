import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sanitizeJiraUrl } from '@/lib/jira';
import { canAccessSquad } from '@/lib/rbac';

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

  const batch = await prisma.importBatch.create({
    data: {
      fileName: fileName || 'import.csv',
      uploadedById: user.id,
      rowCount: rows.length,
    },
  });

  await prisma.task.createMany({
    data: rows.map((row: any) => ({
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
      importBatchId:    batch.id,
    })),
  });

  return Response.json({ batchId: batch.id, count: rows.length });
}
