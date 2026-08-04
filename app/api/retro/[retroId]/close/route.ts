import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(_req: Request, { params }: { params: { retroId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const retro = await prisma.retro.update({
    where: { id: params.retroId },
    data:  { status: 'CLOSED', closedAt: new Date() },
  });

  return Response.json(retro);
}
