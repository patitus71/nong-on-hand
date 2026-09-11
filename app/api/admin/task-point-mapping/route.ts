import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

// GET เปิดให้ทุก role ที่ login แล้ว (ใช้ดึง dropdown ตอนสร้างงานได้จากหลายจุด — Import,
// My Board quick-add, Squad Board quick-add, Retro convert-to-task) — แก้ไขได้เฉพาะ ADMIN
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const rows = await prisma.taskPointMapping.findMany({ orderBy: { point: 'asc' } });
  return Response.json(rows);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const { point, hours } = await req.json() as { point?: number; hours?: number };
  if (typeof point !== 'number' || isNaN(point)) return new Response('point ต้องเป็นตัวเลข', { status: 400 });
  if (typeof hours !== 'number' || isNaN(hours)) return new Response('hours ต้องเป็นตัวเลข', { status: 400 });

  const existing = await prisma.taskPointMapping.findUnique({ where: { point } });
  if (existing) return new Response(`มี point ${point} อยู่แล้ว`, { status: 409 });

  const row = await prisma.taskPointMapping.create({ data: { point, hours } });
  return Response.json(row, { status: 201 });
}
