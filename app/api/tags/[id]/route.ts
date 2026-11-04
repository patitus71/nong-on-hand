import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';
import { duplicateTagMessage, validateTagKind, validateTagName, validateTagUrl, type TagKind } from '@/lib/tags';
import {
  ACTIVE_TASK_LINK, findDuplicateTag, isUniqueViolation, TAG_WITH_COUNT_SELECT, toTagResponse,
} from '@/lib/tagsServer';

async function guardAdmin(action: string): Promise<Response | null> {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (requireAdmin(session.user as SessionUser)) {
    return new Response(`เฉพาะ ADMIN เท่านั้นที่${action} Tag ได้`, { status: 403 });
  }
  return null;
}

// PATCH /api/tags/[id] — แก้ name/kind/url และ archive/restore (isArchived) — ADMIN เท่านั้น
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const denied = await guardAdmin('แก้ไข');
  if (denied) return denied;

  const existing = await prisma.tag.findUnique({ where: { id: params.id } });
  if (!existing) return new Response('ไม่พบ Tag นี้', { status: 404 });

  const body = await req.json().catch(() => null) as
    { name?: unknown; kind?: unknown; url?: unknown; isArchived?: unknown } | null;
  if (!body) return new Response('Bad Request', { status: 400 });

  const data: { name?: string; kind?: TagKind; url?: string | null; isArchived?: boolean } = {};
  if (body.name !== undefined) {
    const r = validateTagName(body.name);
    if (!r.ok) return new Response(r.error, { status: 400 });
    data.name = r.value;
  }
  if (body.kind !== undefined) {
    const r = validateTagKind(body.kind);
    if (!r.ok) return new Response(r.error, { status: 400 });
    data.kind = r.value;
  }
  if (body.url !== undefined) {
    const r = validateTagUrl(body.url);
    if (!r.ok) return new Response(r.error, { status: 400 });
    data.url = r.value;
  }
  if (body.isArchived !== undefined) {
    if (typeof body.isArchived !== 'boolean') return new Response('isArchived ต้องเป็น true/false', { status: 400 });
    data.isArchived = body.isArchived;
  }
  if (Object.keys(data).length === 0) return new Response('ไม่มีข้อมูลให้แก้ไข', { status: 400 });

  const finalName = data.name ?? existing.name;
  const finalKind = data.kind ?? existing.kind;
  if ((data.name !== undefined || data.kind !== undefined) && await findDuplicateTag(finalName, finalKind, existing.id)) {
    return new Response(duplicateTagMessage(finalName, finalKind), { status: 409 });
  }

  try {
    const row = await prisma.tag.update({ where: { id: existing.id }, data, select: TAG_WITH_COUNT_SELECT });
    return NextResponse.json(toTagResponse(row));
  } catch (e) {
    if (isUniqueViolation(e)) return new Response(duplicateTagMessage(finalName, finalKind), { status: 409 });
    throw e;
  }
}

/**
 * DELETE /api/tags/[id] — ลบจริงได้เฉพาะ Tag ที่ "ไม่มี ticket ผูกอยู่" (สำหรับกรณีสร้างผิด) — ADMIN เท่านั้น
 * Tag ที่มี ticket ผูก → 409 ให้ใช้ Archive แทน (ประวัติต้องไม่หาย)
 * ลิงก์ที่ค้างกับ task ที่ถูก soft-delete ไปแล้ว (ผู้ใช้มองไม่เห็น) ถูกล้างไปพร้อมกันใน transaction
 * FK TaskTag→Tag เป็น RESTRICT — ถ้ามีคนติด Tag นี้แทรกเข้ามาระหว่างนั้น DB จะปฏิเสธเอง
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const denied = await guardAdmin('ลบ');
  if (denied) return denied;

  const existing = await prisma.tag.findUnique({ where: { id: params.id }, select: { id: true, name: true } });
  if (!existing) return new Response('ไม่พบ Tag นี้', { status: 404 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const activeCount = await tx.taskTag.count({ where: { tagId: existing.id, ...ACTIVE_TASK_LINK } });
      if (activeCount > 0) return { blocked: activeCount };
      await tx.taskTag.deleteMany({ where: { tagId: existing.id } }); // เหลือแต่ของ task ที่ถูกลบแล้ว
      await tx.tag.delete({ where: { id: existing.id } });
      return { blocked: 0 };
    });
    if (result.blocked > 0) {
      return new Response(
        `Tag "${existing.name}" มี ${result.blocked} ticket ผูกอยู่ — ลบไม่ได้ ให้ใช้ Archive แทน (หรือย้าย/เอา Tag ออกจาก ticket ให้หมดก่อน)`,
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // P2003 = FK violation: มีคนติด Tag นี้แทรกเข้ามาพอดี
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2003') {
      return new Response(`Tag "${existing.name}" เพิ่งถูกติดกับ ticket — ลบไม่ได้ ให้ใช้ Archive แทน`, { status: 409 });
    }
    throw e;
  }
}
