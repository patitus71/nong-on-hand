import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { note } = await req.json();

  const task = await prisma.task.findUnique({ where: { id: params.taskId } });
  if (!task) return new Response('Not Found', { status: 404 });
  if (!task.squadId) return new Response('Task ไม่มี squad', { status: 400 });

  // หา retro ที่ OPEN ของ squad นี้
  let retro = await prisma.retro.findFirst({
    where: { squadId: task.squadId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  });

  // ถ้าไม่มี → สร้างใหม่อัตโนมัติ
  if (!retro) {
    const count = await prisma.retro.count({ where: { squadId: task.squadId } });
    retro = await prisma.retro.create({
      data: { squadId: task.squadId, title: `Retro #${count + 1}`, status: 'OPEN' },
    });
  }

  const item = await prisma.retroItem.create({
    data: {
      retroId:     retro.id,
      category:    'TO_IMPROVE',
      content:     note || task.issueNote || task.title,
      authorId:    user.id,
      linkedTaskId: params.taskId,
    },
  });

  // Mark task ว่ามีปัญหา ถ้ายังไม่ได้ mark
  if (!task.hasIssue) {
    await prisma.task.update({ where: { id: params.taskId }, data: { hasIssue: true, issueNote: note || task.issueNote } });
  }

  return Response.json({ retroId: retro.id, squadId: task.squadId, item });
}
