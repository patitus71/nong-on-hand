import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: { retroId: string; itemId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const existing = await prisma.retroVote.findUnique({
    where: { retroItemId_userId: { retroItemId: params.itemId, userId: user.id } },
  });

  if (existing) {
    await prisma.retroVote.delete({ where: { id: existing.id } });
    return Response.json({ voted: false });
  } else {
    await prisma.retroVote.create({ data: { retroItemId: params.itemId, userId: user.id } });
    return Response.json({ voted: true });
  }
}
