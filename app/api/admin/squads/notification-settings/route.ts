import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

// ใช้เวลา standup/EOD เดียวกันกับทุก squad พร้อมกัน (bulk apply)
// สำหรับทีมที่ไม่ต้องแยกเวลาต่อ squad — ลดจำนวนคลิกตั้งค่าทีละ squad
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session?.user as SessionUser | undefined);
  if (denied) return denied;

  const body = await req.json() as {
    standupAutoSendEnabled: boolean;
    standupSendTime: string | null;
    eodAutoSendEnabled: boolean;
    eodSendTime: string | null;
  };

  if (body.standupAutoSendEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.standupSendTime ?? '')) {
    return new Response('Standup: รูปแบบเวลาไม่ถูกต้อง (HH:MM)', { status: 400 });
  }
  if (body.eodAutoSendEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.eodSendTime ?? '')) {
    return new Response('EOD: รูปแบบเวลาไม่ถูกต้อง (HH:MM)', { status: 400 });
  }

  const squads = await prisma.squad.findMany({ select: { id: true } });

  const data = {
    standupAutoSendEnabled: body.standupAutoSendEnabled,
    standupSendTime:        body.standupAutoSendEnabled ? body.standupSendTime : null,
    eodAutoSendEnabled:     body.eodAutoSendEnabled,
    eodSendTime:            body.eodAutoSendEnabled ? body.eodSendTime : null,
  };

  await prisma.$transaction(
    squads.map(sq =>
      prisma.notificationSettings.upsert({
        where:  { squadId: sq.id },
        update: data,
        create: { squadId: sq.id, ...data },
      }),
    ),
  );

  return Response.json({ ok: true, updatedSquads: squads.length });
}
