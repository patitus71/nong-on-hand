// app/api/line/webhook/route.ts
//
// Webhook สำหรับ LINE Messaging API
// ตั้งค่า Webhook URL ใน LINE Developers Console ให้ชี้มาที่ /api/line/webhook
//
// รองรับ 2 event:
// - join: บอทถูกเชิญเข้ากลุ่ม → log groupId เพื่อนำไปตั้งใน Squad.lineGroupId
// - message: สมาชิกพิมพ์ "/link <username>" → self-link เชื่อม lineUserId กับ User
//
// Security: verify ด้วย x-line-signature (HMAC-SHA256 ของ raw body ด้วย LINE_CHANNEL_SECRET)
// แทนการเช็ค session เพราะ LINE server ยิง POST โดยตรง ไม่มี cookie

import crypto from 'crypto';
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

function verifyLineSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return true; // dev: ข้ามการตรวจถ้ายังไม่ตั้งค่า
  const expected = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64');
  return expected === signature;
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';

  if (!verifyLineSignature(rawBody, signature)) {
    return new Response('Forbidden', { status: 403 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
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

      // ดึงชื่อ LINE จริง (displayName) จาก LINE Profile API
      const lineUid = event.source.userId;
      let lineDisplayName: string | null = null;
      const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
      if (token) {
        try {
          const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${lineUid}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (profileRes.ok) {
            const profile = await profileRes.json() as { displayName: string };
            lineDisplayName = profile.displayName ?? null;
          }
        } catch { /* ข้ามถ้า API เรียกไม่ได้ — lineUserId ยังเก็บตามปกติ */ }
      }

      await prisma.user.update({
        where: { id: user.id },
        data:  { lineUserId: lineUid, lineDisplayName },
      });

      if (event.replyToken) {
        const displayStr = lineDisplayName ? ` (LINE: ${lineDisplayName})` : '';
        await replyLineMessage(event.replyToken, `✅ เชื่อมบัญชี ${user.name}${displayStr} เรียบร้อย`);
      }
    }
  }

  // LINE ต้องการ 200 เสมอ ไม่งั้น retry
  return new Response('OK', { status: 200 });
}
