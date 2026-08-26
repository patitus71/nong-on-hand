import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

export async function GET() {
  const session = await getServerSession(authOptions);
  requireAdmin(session?.user as SessionUser | undefined);

  const squads = await prisma.squad.findMany({
    select: {
      id: true, name: true, isFloatingPool: true,
      _count: { select: { users: true } },
      notificationSettings: {
        select: {
          standupAutoSendEnabled: true, standupSendTime: true,
          eodAutoSendEnabled: true,     eodSendTime: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  return Response.json(squads);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  requireAdmin(session?.user as SessionUser | undefined);

  const { name } = await req.json() as { name?: string };
  const trimmed = name?.trim();
  if (!trimmed) return new Response('name required', { status: 400 });

  const existing = await prisma.squad.findUnique({ where: { name: trimmed } });
  if (existing) return new Response('ชื่อ Squad นี้มีอยู่แล้ว', { status: 409 });

  const squad = await prisma.squad.create({
    data: { name: trimmed },
    select: { id: true, name: true, _count: { select: { users: true } } },
  });

  return Response.json(squad, { status: 201 });
}
