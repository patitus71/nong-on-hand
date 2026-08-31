import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

export async function DELETE(_req: Request, { params }: { params: { squadId: string } }) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const squad = await prisma.squad.findUnique({ where: { id: params.squadId } });
  if (!squad) return new Response('Not found', { status: 404 });

  const [userCount, taskCount] = await Promise.all([
    prisma.user.count({ where: { squadId: params.squadId, deletedAt: null } }),
    prisma.task.count({ where: { squadId: params.squadId, deletedAt: null } }),
  ]);

  if (userCount > 0) {
    return new Response(`ยังมีสมาชิก ${userCount} คนในทีม — ย้ายออกหรือลบก่อน`, { status: 400 });
  }
  if (taskCount > 0) {
    return new Response(`ยังมีงาน ${taskCount} รายการในทีม — ลบงานออกก่อน`, { status: 400 });
  }

  await prisma.squad.delete({ where: { id: params.squadId } });
  return Response.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: { squadId: string } }) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const body = await req.json() as {
    name?: string;
    isFloatingPool?: boolean;
    notificationSettings?: {
      standupAutoSendEnabled: boolean;
      standupSendTime: string | null;
      eodAutoSendEnabled: boolean;
      eodSendTime: string | null;
    };
  };

  const squad = await prisma.squad.findUnique({ where: { id: params.squadId } });
  if (!squad) return new Response('Not found', { status: 404 });

  const data: { name?: string; isFloatingPool?: boolean } = {};

  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return new Response('name required', { status: 400 });
    const conflict = await prisma.squad.findUnique({ where: { name: trimmed } });
    if (conflict && conflict.id !== params.squadId) {
      return new Response('ชื่อ Squad นี้มีอยู่แล้ว', { status: 409 });
    }
    data.name = trimmed;
  }

  if (body.isFloatingPool !== undefined) {
    data.isFloatingPool = body.isFloatingPool;
  }

  if (body.notificationSettings !== undefined) {
    const ns = body.notificationSettings;
    await prisma.notificationSettings.upsert({
      where:  { squadId: params.squadId },
      update: {
        standupAutoSendEnabled: ns.standupAutoSendEnabled,
        standupSendTime:        ns.standupAutoSendEnabled ? (ns.standupSendTime ?? null) : null,
        eodAutoSendEnabled:     ns.eodAutoSendEnabled,
        eodSendTime:            ns.eodAutoSendEnabled ? (ns.eodSendTime ?? null) : null,
      },
      create: {
        squadId:               params.squadId,
        standupAutoSendEnabled: ns.standupAutoSendEnabled,
        standupSendTime:        ns.standupAutoSendEnabled ? (ns.standupSendTime ?? null) : null,
        eodAutoSendEnabled:     ns.eodAutoSendEnabled,
        eodSendTime:            ns.eodAutoSendEnabled ? (ns.eodSendTime ?? null) : null,
      },
    });

    if (Object.keys(data).length === 0) {
      const updated = await prisma.squad.findUnique({
        where: { id: params.squadId },
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
      });
      return Response.json(updated);
    }
  }

  if (Object.keys(data).length === 0) {
    return new Response('nothing to update', { status: 400 });
  }

  const updated = await prisma.squad.update({
    where: { id: params.squadId },
    data,
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
  });

  return Response.json(updated);
}
