import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditTaskContent, type SessionUser } from '@/lib/rbac';
import { flattenTaskTags, parseTagIds, TASK_TAGS_INCLUDE } from '@/lib/tags';
import { checkAttachableTagIds } from '@/lib/tagsServer';

/**
 * PUT /api/tasks/[taskId]/tags — body { tagIds: string[] } — set Tag ทั้งชุดของ ticket
 * สิทธิ์เดียวกับการแก้ title/description (canEditTaskContent)
 * Tag ที่ archived: ติดเพิ่มไม่ได้ แต่ถ้าติดอยู่แล้วคงไว้ได้ / เอาออกได้
 */
export async function PUT(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const body = await req.json().catch(() => null) as { tagIds?: unknown } | null;
  if (!body || body.tagIds === undefined) return new Response('ต้องส่ง tagIds', { status: 400 });
  const parsed = parseTagIds(body.tagIds);
  if (!parsed.ok) return new Response(parsed.error, { status: 400 });
  const tagIds = parsed.value;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId, deletedAt: null },
    select: { id: true, assigneeId: true, squadId: true, tags: { select: { tagId: true } } },
  });
  if (!task) return new Response('ไม่พบงานนี้', { status: 404 });
  if (!canEditTaskContent(user, task)) return new Response('ไม่มีสิทธิ์แก้ Tag ของงานนี้', { status: 403 });

  const current = new Set(task.tags.map(t => t.tagId));
  const err = await checkAttachableTagIds(prisma, tagIds, current);
  if (err) return new Response(err, { status: 400 });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.taskTag.deleteMany({ where: { taskId: task.id, tagId: { notIn: tagIds } } });
    const toAdd = tagIds.filter(id => !current.has(id));
    if (toAdd.length > 0) {
      await tx.taskTag.createMany({ data: toAdd.map(tagId => ({ taskId: task.id, tagId })), skipDuplicates: true });
    }
    return tx.task.findUniqueOrThrow({ where: { id: task.id }, select: { id: true, ...TASK_TAGS_INCLUDE } });
  });

  revalidatePath('/tasks');
  revalidatePath('/squads/[squadId]', 'page');
  return NextResponse.json({ id: updated.id, tags: flattenTaskTags(updated.tags) });
}
