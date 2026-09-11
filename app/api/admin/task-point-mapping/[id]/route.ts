import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const row = await prisma.taskPointMapping.findUnique({ where: { id: params.id } });
  if (!row) return new Response('Not found', { status: 404 });

  const { point, hours } = await req.json() as { point?: number; hours?: number };
  const data: { point?: number; hours?: number } = {};

  if (point !== undefined) {
    if (typeof point !== 'number' || isNaN(point)) return new Response('point ต้องเป็นตัวเลข', { status: 400 });
    const conflict = await prisma.taskPointMapping.findUnique({ where: { point } });
    if (conflict && conflict.id !== params.id) return new Response(`มี point ${point} อยู่แล้ว`, { status: 409 });
    data.point = point;
  }
  if (hours !== undefined) {
    if (typeof hours !== 'number' || isNaN(hours)) return new Response('hours ต้องเป็นตัวเลข', { status: 400 });
    data.hours = hours;
  }
  if (Object.keys(data).length === 0) return new Response('nothing to update', { status: 400 });

  const updated = await prisma.taskPointMapping.update({ where: { id: params.id }, data });
  return Response.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const row = await prisma.taskPointMapping.findUnique({ where: { id: params.id } });
  if (!row) return new Response('Not found', { status: 404 });

  await prisma.taskPointMapping.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
}
