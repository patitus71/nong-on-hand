import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessSquad, type SessionUser } from '@/lib/rbac';

export async function POST(req: Request, { params }: { params: { retroId: string; itemId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const item = await prisma.retroItem.findUnique({
    where:  { id: params.itemId },
    select: { retroId: true, retro: { select: { squadId: true, status: true } } },
  });
  if (!item || item.retroId !== params.retroId) return new Response('Not Found', { status: 404 });
  if (!canAccessSquad(user, item.retro.squadId)) return new Response('Forbidden', { status: 403 });
  if (item.retro.status !== 'OPEN') return new Response('Retro นี้ปิดแล้ว โหวตไม่ได้', { status: 403 });

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
