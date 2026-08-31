import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditSquadBoard, type SessionUser } from '@/lib/rbac';

export async function PATCH(_req: Request, { params }: { params: { retroId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const existing = await prisma.retro.findUnique({
    where: { id: params.retroId },
    select: { squadId: true },
  });
  if (!existing) return new Response('Not Found', { status: 404 });
  if (!canEditSquadBoard(user, existing.squadId) && !user.isFloatingPoolMember) {
    return new Response('Forbidden', { status: 403 });
  }

  const retro = await prisma.retro.update({
    where: { id: params.retroId },
    data:  { status: 'CLOSED', closedAt: new Date() },
  });

  return Response.json(retro);
}
