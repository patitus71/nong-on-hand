import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });

  const { squadId, title } = await req.json();
  if (!squadId || !title?.trim()) return new Response('squadId and title required', { status: 400 });

  const retro = await prisma.retro.create({
    data: { squadId, title: title.trim(), status: 'OPEN' },
  });

  return Response.json(retro);
}
