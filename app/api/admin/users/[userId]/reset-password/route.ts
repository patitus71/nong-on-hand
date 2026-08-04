import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, canResetPassword, type SessionUser } from '@/lib/rbac';
import bcrypt from 'bcryptjs';

export async function POST(req: Request, { params }: { params: { userId: string } }) {
  const session = await getServerSession(authOptions);
  const actor = session?.user as SessionUser | undefined;
  requireAdmin(actor);

  const { password } = await req.json() as { password?: string };
  if (!password || password.length < 6) {
    return new Response('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, role: true },
  });
  if (!target) return new Response('Not found', { status: 404 });

  if (!canResetPassword(actor!, { id: target.id, role: target.role as SessionUser['role'] })) {
    return new Response('Forbidden', { status: 403 });
  }

  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: params.userId }, data: { passwordHash: hash } });

  return Response.json({ ok: true });
}
