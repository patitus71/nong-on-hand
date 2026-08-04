import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: { retroId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { category, content } = await req.json();
  if (!content?.trim()) return new Response('content required', { status: 400 });

  const item = await prisma.retroItem.create({
    data: { retroId: params.retroId, category, content: content.trim(), authorId: user.id },
    include: {
      author: { select: { name: true } },
      votes:  { select: { userId: true } },
    },
  });

  return Response.json(item);
}
