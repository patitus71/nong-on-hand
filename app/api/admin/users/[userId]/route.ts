import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, assertNotLastAdmin, type SessionUser } from '@/lib/rbac';

export async function DELETE(
  _req: Request,
  { params }: { params: { userId: string } },
) {
  const session = await getServerSession(authOptions);
  const actor = session?.user as SessionUser | undefined;
  requireAdmin(actor);

  const { userId } = params;

  if (actor!.id === userId) {
    return new Response('ไม่สามารถลบบัญชีตัวเองได้', { status: 400 });
  }

  await assertNotLastAdmin(userId).catch((r: Response) => { throw r; });

  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date(), active: false },
  });

  return Response.json({ ok: true });
}
