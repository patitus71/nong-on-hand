import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ensureSquadBoard } from '@/lib/squadBoard';
import { sendLineGroupMessageWithMention, MentionContext, thaiDate } from '@/lib/lineNotify';

export async function POST(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { assigneeId } = await req.json();
  if (!assigneeId) return new Response('assigneeId required', { status: 400 });

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: { id: true, squadId: true, laneId: true, isCancelled: true },
  });
  if (!task) return new Response('Not Found', { status: 404 });
  if (!task.squadId) return new Response('Task has no squad', { status: 400 });
  if (task.isCancelled) return new Response('งานนี้ถูกยกเลิกแล้ว claim ต่อไม่ได้อีก', { status: 403 });

  // Verify assignee belongs to the same squad (ADMIN exempt)
  if (user.role !== 'ADMIN') {
    const assignee = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { squadId: true },
    });
    if (!assignee || assignee.squadId !== task.squadId) {
      return new Response('Invalid assignee', { status: 400 });
    }
  }

  // Find "To do" lane in the squad's SQUAD board — auto-create board if it doesn't exist yet
  let todoLane = await prisma.lane.findFirst({
    where: {
      name: { in: ['To do', 'To Do'] },
      board: { type: 'SQUAD', owner: { squadId: task.squadId } },
    },
  });

  if (!todoLane) {
    const squad = await prisma.squad.findUnique({
      where:  { id: task.squadId },
      select: { name: true },
    });
    const board = await ensureSquadBoard(task.squadId, user.id, squad?.name ?? '');
    const lane = board?.lanes.find(l => l.name === 'To do');
    if (!lane) return new Response('Board setup error', { status: 500 });
    todoLane = lane;
  }

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      assigneeId,
      laneId: todoLane.id,
      ...(!task.laneId ? { pulledIntoBoardAt: new Date() } : {}),
    },
  });

  // LINE notification — non-blocking, ไม่ error ถ้าส่งไม่สำเร็จ
  void (async () => {
    try {
      const [assignee, squad] = await Promise.all([
        prisma.user.findUnique({
          where:  { id: assigneeId },
          select: { name: true, lineUserId: true, lineDisplayName: true },
        }),
        prisma.squad.findUnique({
          where:  { id: task.squadId! },
          select: { name: true, lineGroupId: true },
        }),
      ]);

      if (!squad?.lineGroupId || !assignee) return;

      // สร้าง Notification ในแอปสำหรับ assignee
      await prisma.notification.create({
        data: {
          userId:        assigneeId,
          message:       `งาน "${updated.title}" ถูกมอบหมายให้คุณ`,
          relatedTaskId: updated.id,
        },
      });

      const dueDateStr = updated.dueDate ? thaiDate(updated.dueDate) : 'ไม่ระบุ';

      const ctx = new MentionContext();
      const mention = ctx.slot(assignee.lineDisplayName ?? assignee.name, assignee.lineUserId);
      const text = [
        `📌 ${mention} ได้รับมอบหมายงานใหม่`,
        `งาน: ${updated.title}`,
        `Squad: ${squad.name}`,
        `มอบหมายโดย: ${user.name}`,
        `กำหนดเสร็จ: ${dueDateStr}`,
      ].join('\n');
      await sendLineGroupMessageWithMention(squad.lineGroupId, text, ctx);
    } catch (err) {
      console.error('[claim] LINE notification error:', err);
    }
  })();

  return Response.json(updated);
}
