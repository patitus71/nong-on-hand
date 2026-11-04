import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';
import { ACTIVE_TASK_LINK } from '@/lib/tagsServer';

/**
 * POST /api/tags/[id]/move — body { toTagId, archiveFrom } — ADMIN เท่านั้น
 * ย้ายลิงก์ ticket ทั้งหมดจาก Tag นี้ไป toTagId ใน transaction เดียว (ใช้ตอนขึ้น sprint ใหม่)
 * - ticket ที่มี toTag อยู่แล้ว → ข้าม (ไม่สร้างซ้ำ) แต่ก็เอา Tag เดิมออกเหมือนกัน
 * - ห้ามย้ายไป Tag ที่ archived หรือไป Tag ตัวเอง
 * - นับเฉพาะ ticket ที่ยังไม่ถูกลบ (ให้ตรงกับเลขที่ Admin เห็น) — ลิงก์ของ task ที่ถูกลบแล้วคงไว้เป็นประวัติ
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (requireAdmin(session.user as SessionUser)) {
    return new Response('เฉพาะ ADMIN เท่านั้นที่ย้าย ticket ระหว่าง Tag ได้', { status: 403 });
  }

  const body = await req.json().catch(() => null) as { toTagId?: unknown; archiveFrom?: unknown } | null;
  if (!body || typeof body.toTagId !== 'string' || !body.toTagId) {
    return new Response('กรุณาเลือก Tag ปลายทาง', { status: 400 });
  }
  if (body.archiveFrom !== undefined && typeof body.archiveFrom !== 'boolean') {
    return new Response('archiveFrom ต้องเป็น true/false', { status: 400 });
  }
  const toTagId = body.toTagId;
  const archiveFrom = body.archiveFrom === true;
  if (toTagId === params.id) return new Response('ย้ายไป Tag เดิมไม่ได้ — เลือก Tag ปลายทางอื่น', { status: 400 });

  const [from, to] = await Promise.all([
    prisma.tag.findUnique({ where: { id: params.id }, select: { id: true } }),
    prisma.tag.findUnique({ where: { id: toTagId }, select: { id: true, name: true, isArchived: true } }),
  ]);
  if (!from) return new Response('ไม่พบ Tag ต้นทาง', { status: 404 });
  if (!to) return new Response('ไม่พบ Tag ปลายทาง', { status: 404 });
  if (to.isArchived) return new Response(`Tag ปลายทาง "${to.name}" ถูก Archive แล้ว — กู้คืนก่อนหรือเลือก Tag อื่น`, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    // re-check ปลายทางใน transaction กันมีคน archive แทรกระหว่างทาง
    const toNow = await tx.tag.findUnique({ where: { id: toTagId }, select: { isArchived: true } });
    if (!toNow || toNow.isArchived) throw new MoveConflict('Tag ปลายทางเพิ่งถูก Archive — ลองใหม่อีกครั้ง');

    const links = await tx.taskTag.findMany({
      where: { tagId: from.id, ...ACTIVE_TASK_LINK },
      select: { taskId: true },
    });
    const taskIds = links.map(l => l.taskId);
    let moved = 0;
    if (taskIds.length > 0) {
      const created = await tx.taskTag.createMany({
        data: taskIds.map(taskId => ({ taskId, tagId: toTagId })),
        skipDuplicates: true, // ticket ที่มี toTag อยู่แล้ว → ข้าม
      });
      moved = created.count;
      await tx.taskTag.deleteMany({ where: { tagId: from.id, taskId: { in: taskIds } } });
    }
    if (archiveFrom) await tx.tag.update({ where: { id: from.id }, data: { isArchived: true } });
    return { total: taskIds.length, moved, skipped: taskIds.length - moved, archivedFrom: archiveFrom };
  }).catch((e) => {
    if (e instanceof MoveConflict) return e;
    throw e;
  });

  if (result instanceof MoveConflict) return new Response(result.message, { status: 409 });
  return NextResponse.json(result);
}

class MoveConflict extends Error {}
