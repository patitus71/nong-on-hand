// app/api/admin/line-quota/route.ts
//
// Debug utility: อ่าน quota จริงของ LINE Messaging API ตรงจาก LINE (ไม่ใช่ตัวเลขจาก
// LINE Official Account Manager ซึ่งเป็นคนละหน้า/คนละ metric กับ Messaging API push quota) —
// ใช้เช็คตอน push message โดน 429 "You have reached your monthly limit." ทั้งที่หน้า OA
// Manager บอกว่า quota ยังเหลือเยอะ

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireAdmin, type SessionUser } from '@/lib/rbac';

export async function GET() {
  const session = await getServerSession(authOptions);
  requireAdmin(session?.user as SessionUser | undefined);

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return new Response('LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า', { status: 500 });

  const headers = { Authorization: `Bearer ${token}` };

  const [quotaRes, consumptionRes] = await Promise.all([
    fetch('https://api.line.me/v2/bot/message/quota', { headers }),
    fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers }),
  ]);

  const [quota, consumption] = await Promise.all([
    quotaRes.json().catch(() => null),
    consumptionRes.json().catch(() => null),
  ]);

  return Response.json({
    quota:            { status: quotaRes.status, body: quota },
    consumption:      { status: consumptionRes.status, body: consumption },
  });
}
