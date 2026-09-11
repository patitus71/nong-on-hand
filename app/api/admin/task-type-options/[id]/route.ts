import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const row = await prisma.taskTypeOption.findUnique({ where: { id: params.id } });
  if (!row) return new Response('Not found', { status: 404 });

  const { label, order } = await req.json() as { label?: string; order?: number };
  const data: { label?: string; order?: number } = {};

  if (label !== undefined) {
    const trimmed = label.trim();
    if (!trimmed) return new Response('label required', { status: 400 });
    data.label = trimmed;
  }
  if (order !== undefined) {
    if (typeof order !== 'number' || isNaN(order)) return new Response('order ต้องเป็นตัวเลข', { status: 400 });
    data.order = order;
  }
  if (Object.keys(data).length === 0) return new Response('nothing to update', { status: 400 });

  const updated = await prisma.taskTypeOption.update({ where: { id: params.id }, data });
  return Response.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const row = await prisma.taskTypeOption.findUnique({ where: { id: params.id } });
  if (!row) return new Response('Not found', { status: 404 });

  await prisma.taskTypeOption.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
}
