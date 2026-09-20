import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// เหมือน validation ของ prLink — ต้องเป็น http/https เท่านั้น กัน javascript: URI แม้ว่าค่าจะมาจาก
// client parse JSON แล้วก็ตาม (ไม่เชื่อ input จากฝั่ง client 100%) — url ที่ไม่ผ่านจะถูก drop เป็น null
// เฉยๆ ไม่ block ทั้ง batch import
function sanitizeJiraUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url.trim();
  } catch {
    return null;
  }
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
