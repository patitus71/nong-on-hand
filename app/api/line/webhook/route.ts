// app/api/line/webhook/route.ts
//
// Webhook สำหรับ LINE Messaging API
// ตั้งค่า Webhook URL ใน LINE Developers Console ให้ชี้มาที่ /api/line/webhook
//
// รองรับ 2 event:
// - join: บอทถูกเชิญเข้ากลุ่ม → log groupId เพื่อนำไปตั้งใน Squad.lineGroupId
// - message: สมาชิกพิมพ์ "/link <username>" → self-link เชื่อม lineUserId กับ User

import { prisma } from '@/lib/prisma';
import { replyLineMessage } from '@/lib/lineNotify';

interface LineEvent {
  type: string;
  replyToken?: string;
  source: {
    type: string;
    groupId?: string;
    userId?: string;
  };
  message?: {
    type: string;
    text?: string;
  };
}

interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}

export async function POST(req: Request) {
  let body: LineWebhookBody;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  for (const event of body.events ?? []) {
    if (event.type === 'join' && event.source.groupId) {
      // Log groupId — admin ต้องนำไปตั้งใน Squad.lineGroupId ผ่าน Prisma Studio
      console.log('[LINE webhook] Bot joined group. groupId:', event.source.groupId);
    }

    if (
      event.type === 'message' &&
      event.message?.type === 'text' &&
      event.source.userId &&
      event.message.text?.toLowerCase().startsWith('/link ')
    ) {
      const username = event.message.text.slice(6).trim(); // ตัด "/link " ออก
      if (!username) continue;

      const user = await prisma.user.findUnique({
        where:  { username },
        select: { id: true, name: true, deletedAt: true },
      });

      if (!user || user.deletedAt) {
        if (event.replyToken) {
          await replyLineMessage(event.replyToken, `❌ ไม่พบชื่อผู้ใช้ "${username}" ในระบบ`);
        }
        continue;
      }

      await prisma.user.update({
        where: { id: user.id },
        data:  { lineUserId: event.source.userId },
      });

      if (event.replyToken) {
        await replyLineMessage(event.replyToken, `✅ เชื่อมบัญชี ${user.name} เรียบร้อย`);
      }
    }
  }

  // LINE ต้องการ 200 เสมอ ไม่งั้น retry
  return new Response('OK', { status: 200 });
}
