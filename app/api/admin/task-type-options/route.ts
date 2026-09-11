import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminOrQaLead, type SessionUser } from '@/lib/rbac';

// GET เปิดให้ ADMIN + QA_LEAD (ใช้ดึง dropdown ที่หน้า import งาน) — แก้ไขได้เฉพาะ ADMIN
export async function GET() {
  const session = await getServerSession(authOptions);
  const denied = requireAdminOrQaLead(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const rows = await prisma.taskTypeOption.findMany({ orderBy: { order: 'asc' } });
  return Response.json(rows);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const { label } = await req.json() as { label?: string };
  const trimmed = label?.trim();
  if (!trimmed) return new Response('label required', { status: 400 });

  const max = await prisma.taskTypeOption.aggregate({ _max: { order: true } });
  const row = await prisma.taskTypeOption.create({
    data: { label: trimmed, order: (max._max.order ?? -1) + 1 },
  });
  return Response.json(row, { status: 201 });
}
