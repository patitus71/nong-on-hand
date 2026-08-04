import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, assertNotLastAdmin, canAssignRole, isSquadRequiredForRole, type SessionUser } from '@/lib/rbac';
import bcrypt from 'bcryptjs';

const userSelect = {
  id: true, name: true, username: true, role: true,
  active: true, squadId: true,
  squad: { select: { name: true } },
} as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  requireAdmin(session?.user as SessionUser | undefined);

  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  const adminCount = users.filter(u => u.role === 'ADMIN' && u.active).length;
  return Response.json(users.map(u => ({ ...u, isLastAdmin: u.role === 'ADMIN' && adminCount === 1 })));
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  requireAdmin(session?.user as SessionUser | undefined);

  const { name, username, password, role, squadId } = await req.json() as {
    name?: string; username?: string; password?: string;
    role?: string; squadId?: string | null;
  };

  if (!name?.trim())     return new Response('กรุณากรอกชื่อ', { status: 400 });
  if (!username?.trim()) return new Response('กรุณากรอก username', { status: 400 });
  if (!password || password.length < 6) return new Response('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', { status: 400 });
  if (!role)             return new Response('กรุณาเลือก role', { status: 400 });

  if (isSquadRequiredForRole(role as SessionUser['role']) && !squadId) {
    return new Response('role นี้ต้องระบุ Squad', { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (existing) return new Response('Username นี้มีอยู่แล้ว', { status: 409 });

  const passwordHash = await bcrypt.hash(password, 10);

  const created = await prisma.user.create({
    data: {
      name:     name.trim(),
      username: username.trim(),
      passwordHash,
      role:     role as any,
      squadId:  isSquadRequiredForRole(role as SessionUser['role']) ? (squadId ?? null) : null,
    },
    select: userSelect,
  });

  return Response.json({ ...created, isLastAdmin: false }, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const actor = session?.user as SessionUser | undefined;
  requireAdmin(actor);

  const body = await req.json() as {
    userId: string; role?: string; active?: boolean; squadId?: string | null;
  };
  const { userId, role, active } = body;
  if (!userId) return new Response('userId required', { status: 400 });

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true },
  });
  if (!target) return new Response('Not found', { status: 404 });

  if (role !== undefined) {
    if (!canAssignRole(actor!, role as SessionUser['role'])) {
      return new Response('Forbidden: cannot assign this role', { status: 403 });
    }
    if (role !== target.role) {
      await assertNotLastAdmin(userId).catch((r: Response) => { throw r; });
    }
  }

  if (active === false && target.active) {
    await assertNotLastAdmin(userId).catch((r: Response) => { throw r; });
  }

  // QA_MANAGER / ADMIN ไม่ผูก squad — auto-clear เมื่อเปลี่ยน role มาเป็น 2 role นี้
  const effectiveRole = (role ?? target.role) as SessionUser['role'];
  const squadId = 'squadId' in body
    ? (isSquadRequiredForRole(effectiveRole) ? (body.squadId ?? null) : null)
    : (!isSquadRequiredForRole(effectiveRole) && role !== undefined ? null : undefined);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(role      !== undefined ? { role: role as any }        : {}),
      ...(active    !== undefined ? { active }                   : {}),
      ...(squadId   !== undefined ? { squadId }                  : {}),
    },
    select: userSelect,
  });

  return Response.json(updated);
}
