import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessSquad, type SessionUser } from '@/lib/rbac';

export async function POST(req: Request, { params }: { params: { retroId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const { category, content } = await req.json();
  if (!content?.trim()) return new Response('content required', { status: 400 });

  const retro = await prisma.retro.findUnique({ where: { id: params.retroId }, select: { squadId: true, status: true } });
  if (!retro) return new Response('Not Found', { status: 404 });
  if (!canAccessSquad(user, retro.squadId)) return new Response('Forbidden', { status: 403 });
  if (retro.status !== 'OPEN') return new Response('Retro นี้ปิดแล้ว เพิ่มรายการไม่ได้', { status: 403 });

  const item = await prisma.retroItem.create({
    data: { retroId: params.retroId, category, content: content.trim(), authorId: user.id },
    include: {
      author: { select: { name: true } },
      votes:  { select: { userId: true } },
    },
  });

  return Response.json(item);
}
