import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';
import { duplicateTagMessage, validateTagKind, validateTagName, validateTagUrl } from '@/lib/tags';
import { findDuplicateTag, isUniqueViolation, TAG_WITH_COUNT_SELECT, toTagResponse } from '@/lib/tagsServer';

// GET /api/tags?includeArchived=0|1 — ทุก role ที่ login อ่านได้ (ใช้ใน TagPicker + Admin Panel)
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const includeArchived = new URL(req.url).searchParams.get('includeArchived') === '1';
  const rows = await prisma.tag.findMany({
    where: includeArchived ? {} : { isArchived: false },
    select: TAG_WITH_COUNT_SELECT,
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
  return NextResponse.json(rows.map(toTagResponse));
}

// POST /api/tags — ADMIN เท่านั้น
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const denied = requireAdmin(session.user as SessionUser);
  if (denied) return new Response('เฉพาะ ADMIN เท่านั้นที่สร้าง Tag ได้', { status: 403 });

  const body = await req.json().catch(() => null) as { name?: unknown; kind?: unknown; url?: unknown } | null;
  if (!body) return new Response('Bad Request', { status: 400 });

  const name = validateTagName(body.name);
  if (!name.ok) return new Response(name.error, { status: 400 });
  const kind = validateTagKind(body.kind ?? 'OTHER');
  if (!kind.ok) return new Response(kind.error, { status: 400 });
  const url = validateTagUrl(body.url);
  if (!url.ok) return new Response(url.error, { status: 400 });

  if (await findDuplicateTag(name.value, kind.value)) {
    return new Response(duplicateTagMessage(name.value, kind.value), { status: 409 });
  }

  try {
    const row = await prisma.tag.create({
      data: { name: name.value, kind: kind.value, url: url.value },
      select: TAG_WITH_COUNT_SELECT,
    });
    return NextResponse.json(toTagResponse(row), { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return new Response(duplicateTagMessage(name.value, kind.value), { status: 409 });
    throw e;
  }
}
