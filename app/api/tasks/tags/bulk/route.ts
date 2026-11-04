import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditTaskContent, type SessionUser } from '@/lib/rbac';

const MAX_TASKS = 500;

/**
 * POST /api/tasks/tags/bulk — body { taskIds, tagId, mode: "add" | "remove" }
 * ใส่/เอา Tag เดียวออกจากหลาย ticket พร้อมกัน — all-or-nothing:
 * ถ้ามี ticket ไหนที่ผู้ใช้ไม่มีสิทธิ์แก้ → 403 ทั้งชุด (ไม่ทำครึ่งๆ กลางๆ)
 * mode=add ห้ามใช้ Tag ที่ archived; mode=remove ใช้ได้เสมอ
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const body = await req.json().catch(() => null) as { taskIds?: unknown; tagId?: unknown; mode?: unknown } | null;
  if (!body) return new Response('Bad Request', { status: 400 });
  const { tagId, mode } = body;
  if (mode !== 'add' && mode !== 'remove') return new Response('mode ต้องเป็น add หรือ remove', { status: 400 });
  if (typeof tagId !== 'string' || !tagId) return new Response('กรุณาเลือก Tag', { status: 400 });
  if (!Array.isArray(body.taskIds) || body.taskIds.length === 0 || body.taskIds.some(x => typeof x !== 'string' || !x)) {
    return new Response('กรุณาเลือกงานอย่างน้อย 1 รายการ', { status: 400 });
  }
  const taskIds = Array.from(new Set(body.taskIds as string[]));
  if (taskIds.length > MAX_TASKS) return new Response(`เลือกได้สูงสุด ${MAX_TASKS} งานต่อครั้ง`, { status: 400 });

  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true, name: true, isArchived: true } });
  if (!tag) return new Response('ไม่พบ Tag นี้', { status: 404 });
  if (mode === 'add' && tag.isArchived) return new Response(`Tag "${tag.name}" ถูก Archive แล้ว — ติดเพิ่มไม่ได้`, { status: 400 });

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, deletedAt: null },
    select: { id: true, assigneeId: true, squadId: true },
  });
  if (tasks.length !== taskIds.length) return new Response('ไม่พบงานบางรายการ — อาจถูกลบไปแล้ว ลองรีเฟรชหน้า', { status: 404 });
  const forbidden = tasks.filter(t => !canEditTaskContent(user, t));
  if (forbidden.length > 0) {
    return new Response(`ไม่มีสิทธิ์แก้ Tag ของงาน ${forbidden.length} รายการที่เลือก — ไม่ได้เปลี่ยนอะไรเลย`, { status: 403 });
  }

  let changed: number;
  if (mode === 'add') {
    const r = await prisma.taskTag.createMany({ data: taskIds.map(taskId => ({ taskId, tagId })), skipDuplicates: true });
    changed = r.count;
  } else {
    const r = await prisma.taskTag.deleteMany({ where: { tagId, taskId: { in: taskIds } } });
    changed = r.count;
  }

  revalidatePath('/tasks');
  revalidatePath('/squads/[squadId]', 'page');
  return NextResponse.json({ mode, tagId, requested: taskIds.length, changed });
}
