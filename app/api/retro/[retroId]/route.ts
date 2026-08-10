import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditSquadBoard } from '@/lib/rbac';
import type { SessionUser } from '@/lib/rbac';

export async function DELETE(_req: Request, { params }: { params: { retroId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const retro = await prisma.retro.findUnique({
    where: { id: params.retroId },
    select: { squadId: true },
  });
  if (!retro) return new NextResponse('ไม่พบ Retro', { status: 404 });

  if (!canEditSquadBoard(user, retro.squadId)) {
    return new NextResponse('ไม่มีสิทธิ์ลบ Retro นี้', { status: 403 });
  }

  await prisma.retro.delete({ where: { id: params.retroId } });

  return new NextResponse(null, { status: 204 });
}
