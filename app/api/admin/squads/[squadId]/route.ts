import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

export async function PATCH(req: Request, { params }: { params: { squadId: string } }) {
  const session = await getServerSession(authOptions);
  requireAdmin(session?.user as SessionUser | undefined);

  const { name } = await req.json() as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) return new Response('name required', { status: 400 });

  const squad = await prisma.squad.findUnique({ where: { id: params.squadId } });
  if (!squad) return new Response('Not found', { status: 404 });

  const conflict = await prisma.squad.findUnique({ where: { name: trimmed } });
  if (conflict && conflict.id !== params.squadId) {
    return new Response('ชื่อ Squad นี้มีอยู่แล้ว', { status: 409 });
  }

  const updated = await prisma.squad.update({
    where: { id: params.squadId },
    data: { name: trimmed },
    select: { id: true, name: true, _count: { select: { users: true } } },
  });

  return Response.json(updated);
}
