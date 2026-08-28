import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canDeleteTask, canEditTaskContent, type SessionUser } from '@/lib/rbac';
import { buildTaskDeletionNotifications } from '@/lib/notifications';
import { sendLineGroupMessageWithMention, MentionContext } from '@/lib/lineNotify';
import { revalidatePath } from 'next/cache';

export async function PATCH(
  req: Request,
  { params }: { params: { taskId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const body = await req.json() as {
    title?: string; description?: string; reviewerId?: string | null; prLink?: string | null;
    requiresReview?: boolean;
  };
  const { title, description, reviewerId, prLink, requiresReview } = body;

  if (
    title === undefined && description === undefined && reviewerId === undefined &&
    prLink === undefined && requiresReview === undefined
  ) {
    return new Response('Bad Request', { status: 400 });
  }
  if (title !== undefined && !title.trim()) {
    return new Response('ชื่องานต้องมีอย่างน้อย 1 ตัวอักษร', { status: 400 });
  }
  if (prLink !== undefined && prLink !== null) {
    try {
      const parsed = new URL(prLink);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return new Response('PR link ต้องขึ้นต้นด้วย http:// หรือ https://', { status: 400 });
      }
    } catch {
      return new Response('PR link ไม่ถูกต้อง — ต้องเป็น URL ที่ถูกต้อง', { status: 400 });
    }
  }

  const task = await prisma.task.findUnique({
    where: { id: params.taskId, deletedAt: null },
    select: { id: true, assigneeId: true, squadId: true, reviewerId: true },
  });
  if (!task) return new Response('Not Found', { status: 404 });
  if (!canEditTaskContent(user, task)) return new Response('Forbidden', { status: 403 });

  const data: Record<string, unknown> = {};
  if (title !== undefined) data.title = title.trim();
  if (description !== undefined) data.description = description.trim() || null;
  if (reviewerId !== undefined) data.reviewerId = reviewerId;
  if (prLink !== undefined) data.prLink = prLink ? prLink.trim() : null;
  if (requiresReview !== undefined) data.requiresReview = requiresReview;

  const updated = await prisma.task.update({
    where: { id: task.id },
    data,
    select: { id: true, title: true, description: true, reviewerId: true, prLink: true, requiresReview: true },
  });

  // LINE notification — ส่งเฉพาะตอนตั้ง reviewer ใหม่จริง (ไม่ใช่ unset หรือค่าเดิม)
  if (reviewerId && reviewerId !== task.reviewerId && task.squadId) {
    const squadId = task.squadId;
    void (async () => {
      try {
        const [reviewer, squad, assignee] = await Promise.all([
          prisma.user.findUnique({
            where:  { id: reviewerId },
            select: { name: true, lineUserId: true, lineDisplayName: true },
          }),
          prisma.squad.findUnique({
            where:  { id: squadId },
            select: { name: true, lineGroupId: true },
          }),
          task.assigneeId
            ? prisma.user.findUnique({ where: { id: task.assigneeId }, select: { name: true } })
            : Promise.resolve(null),
        ]);

        if (!squad?.lineGroupId || !reviewer) return;

        await prisma.notification.create({
          data: {
            userId:        reviewerId,
            message:       `งาน "${updated.title}" ต้องการให้คุณ Review`,
            relatedTaskId: updated.id,
          },
        });

        const ctx = new MentionContext();
        const mention = ctx.slot(reviewer.lineDisplayName ?? reviewer.name, reviewer.lineUserId);
        const text = [
          `🔍 ${mention} received a review request`,
          `Task: ${updated.title}`,
          `Squad: ${squad.name}`,
          `Sent by: ${assignee?.name ?? session.user?.name ?? 'Unknown'}`,
          ...(updated.prLink ? [`🔗 PR: ${updated.prLink}`] : []),
        ].join('\n');
        const r = await sendLineGroupMessageWithMention(squad.lineGroupId, text, ctx);
        if (!r.success) console.error('[task PATCH] LINE review-request notification failed:', r.reason);
      } catch (err) {
        console.error('[task PATCH] LINE review-request notification error:', err);
      }
    })();
  }

  revalidatePath('/tasks');
  revalidatePath('/squads/[squadId]', 'page');
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { taskId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId, deletedAt: null },
    select: {
      id: true,
      title: true,
      squadId: true,
      source: true,
      pulledIntoBoardAt: true,
      flaggedForDeletion: true,
      assigneeId: true,
      deletionFlaggedById: true,
    },
  });

  if (!task) return new Response('Not Found', { status: 404 });

  if (!canDeleteTask(user, task)) {
    return new Response('Forbidden — ไม่มีสิทธิ์ลบงานนี้', { status: 403 });
  }

  const notifRows = buildTaskDeletionNotifications({
    id: task.id,
    title: task.title,
    assigneeId: task.assigneeId,
    deletionFlaggedById: task.deletionFlaggedById,
    deletedById: user.id,
  });

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: task.id }, data: { deletedAt: new Date(), deletedById: user.id } });
    if (notifRows.length > 0) {
      await tx.notification.createMany({ data: notifRows });
    }
  });

  revalidatePath('/tasks');
  revalidatePath('/squads/[squadId]', 'page');
  return NextResponse.json({ ok: true });
}
