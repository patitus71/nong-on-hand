import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessSquad, canCreateTask, type SessionUser } from '@/lib/rbac';

export async function POST(req: Request, { params }: { params: { retroId: string; itemId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;
  // แปลงเป็นงาน = สร้างงานใหม่ → ต้องสร้างงานได้ (QA_MANAGER ไม่ได้)
  if (!canCreateTask(user)) return new Response('Forbidden', { status: 403 });

  const item = await prisma.retroItem.findUnique({
    where:   { id: params.itemId },
    include: { retro: { select: { squadId: true } } },
  });
  if (!item) return new Response('Not Found', { status: 404 });
  if (!canAccessSquad(user, item.retro.squadId)) return new Response('Forbidden', { status: 403 });
  if (item.linkedTaskId) return Response.json({ taskId: item.linkedTaskId }); // already converted

  const { taskPoint } = await req.json().catch(() => ({})) as { taskPoint?: number | null };
  // Task Point ไม่บังคับ — ไม่ส่ง/null = "–" (ยังไม่ตั้ง point, estimate ว่าง) ตั้งทีหลังบนการ์ดได้
  let pointMapping: { point: number; hours: number } | null = null;
  if (taskPoint !== undefined && taskPoint !== null) {
    if (typeof taskPoint !== 'number' || isNaN(taskPoint)) {
      return new Response('taskPoint ต้องเป็นตัวเลข', { status: 400 });
    }
    pointMapping = await prisma.taskPointMapping.findUnique({ where: { point: taskPoint } });
    if (!pointMapping) return new Response(`ไม่พบ Task Point ${taskPoint} ใน config — ตั้งค่าได้ที่ Admin Panel`, { status: 400 });
  }

  const task = await prisma.task.create({
    data: {
      title:          item.content,
      squadId:        item.retro.squadId,
      assigneeId:     item.ownerId ?? user.id,
      source:         'MANUAL',
      taskPoint:      pointMapping?.point ?? null,
      estimatedHours: pointMapping?.hours ?? null,
    },
  });

  await prisma.retroItem.update({
    where: { id: params.itemId },
    data:  { linkedTaskId: task.id },
  });

  return Response.json({ taskId: task.id });
}
