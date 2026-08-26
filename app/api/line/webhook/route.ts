// app/api/line/webhook/route.ts
//
// Webhook สำหรับ LINE Messaging API
// ตั้งค่า Webhook URL ใน LINE Developers Console ให้ชี้มาที่ /api/line/webhook
//
// รองรับ event:
// - join: บอทถูกเชิญเข้ากลุ่ม → log groupId เพื่อนำไปตั้งใน Squad.lineGroupId
// - message: สมาชิกพิมพ์คำสั่งต่อไปนี้ในกลุ่ม
//     /link <username>       — self-link เชื่อม lineUserId กับ User
//     /standup on HH:MM      — เปิด auto-send standup (ADMIN/QA_LEAD/floating-pool)
//     /standup off           — ปิด auto-send standup
//     /eod on HH:MM          — เปิด auto-send EOD
//     /eod off               — ปิด auto-send EOD
//     /notify status         — ดูสถานะ auto-send ปัจจุบัน (ทุก role)
//
// Security: verify ด้วย x-line-signature (HMAC-SHA256 ของ raw body ด้วย LINE_CHANNEL_SECRET)

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

/** Parse rest-of-command หลัง prefix (/standup หรือ /eod) */
function parseOnOffTime(rest: string): { action: 'on'; time: string } | { action: 'off' } | null {
  const lower = rest.toLowerCase().trim();
  if (lower === 'off') return { action: 'off' };
  if (lower.startsWith('on ')) {
    const time = lower.slice(3).trim();
    return { action: 'on', time };
  }
  return null;
}

/** HH:MM 24h — ตรง 00:00–23:59 */
function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
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
      event.source.userId
    ) {
      const text  = event.message.text ?? '';
      const lower = text.toLowerCase();

      // ────────────────────────────────────────────────────────
      // /link <username>
      // ────────────────────────────────────────────────────────
      if (lower.startsWith('/link ')) {
        const username = text.slice(6).trim();
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

      // ────────────────────────────────────────────────────────
      // /standup on|off  /eod on|off
      // ────────────────────────────────────────────────────────
      } else if (
        event.source.groupId &&
        (lower.startsWith('/standup ') || lower.startsWith('/eod '))
      ) {
        // ── Permission check ──────────────────────────────────
        const sender = await prisma.user.findFirst({
          where:  { lineUserId: event.source.userId, deletedAt: null },
          select: { role: true, squad: { select: { isFloatingPool: true } } },
        });

        const hasPermission =
          sender &&
          (sender.role === 'ADMIN' ||
            sender.role === 'QA_LEAD' ||
            sender.squad?.isFloatingPool === true);

        if (!hasPermission) {
          if (event.replyToken) {
            await replyLineMessage(
              event.replyToken,
              '❌ คุณไม่มีสิทธิ์ตั้งค่านี้ — เฉพาะ QA_LEAD/ADMIN เท่านั้น',
            );
          }
          continue;
        }

        // ── หา Squad จาก groupId ──────────────────────────────
        const squad = await prisma.squad.findFirst({
          where:  { lineGroupId: event.source.groupId },
          select: { id: true },
        });

        if (!squad) {
          if (event.replyToken) {
            await replyLineMessage(event.replyToken, '❌ กลุ่มนี้ยังไม่ได้ผูกกับ Squad ในระบบ');
          }
          continue;
        }

        const isStandup = lower.startsWith('/standup ');
        const prefix    = isStandup ? '/standup ' : '/eod ';
        const parsed    = parseOnOffTime(text.slice(prefix.length));

        if (!parsed) {
          const usage = isStandup
            ? '❌ รูปแบบไม่ถูกต้อง\nใช้: /standup on HH:MM หรือ /standup off\nตัวอย่าง: /standup on 09:00'
            : '❌ รูปแบบไม่ถูกต้อง\nใช้: /eod on HH:MM หรือ /eod off\nตัวอย่าง: /eod on 18:00';
          if (event.replyToken) await replyLineMessage(event.replyToken, usage);
          continue;
        }

        if (parsed.action === 'on' && !isValidTime(parsed.time)) {
          const usage = isStandup
            ? '❌ รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:MM เช่น 09:00)\nใช้: /standup on 09:00'
            : '❌ รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:MM เช่น 18:00)\nใช้: /eod on 18:00';
          if (event.replyToken) await replyLineMessage(event.replyToken, usage);
          continue;
        }

        // ── Upsert NotificationSettings ───────────────────────
        if (isStandup) {
          if (parsed.action === 'on') {
            await prisma.notificationSettings.upsert({
              where:  { squadId: squad.id },
              update: { standupAutoSendEnabled: true, standupSendTime: parsed.time },
              create: { squadId: squad.id, standupAutoSendEnabled: true, standupSendTime: parsed.time },
            });
            if (event.replyToken) {
              await replyLineMessage(
                event.replyToken,
                `✅ ตั้ง Standup อัตโนมัติเวลา ${parsed.time} แล้ว — พิมพ์ /standup off เพื่อปิด`,
              );
            }
          } else {
            await prisma.notificationSettings.upsert({
              where:  { squadId: squad.id },
              update: { standupAutoSendEnabled: false },
              create: { squadId: squad.id, standupAutoSendEnabled: false },
            });
            if (event.replyToken) {
              await replyLineMessage(
                event.replyToken,
                '✅ ปิด Standup อัตโนมัติแล้ว — ต้องกดส่งเองจากเว็บแทน',
              );
            }
          }
        } else {
          // EOD
          if (parsed.action === 'on') {
            await prisma.notificationSettings.upsert({
              where:  { squadId: squad.id },
              update: { eodAutoSendEnabled: true, eodSendTime: parsed.time },
              create: { squadId: squad.id, eodAutoSendEnabled: true, eodSendTime: parsed.time },
            });
            if (event.replyToken) {
              await replyLineMessage(
                event.replyToken,
                `✅ ตั้ง EOD อัตโนมัติเวลา ${parsed.time} แล้ว — พิมพ์ /eod off เพื่อปิด`,
              );
            }
          } else {
            await prisma.notificationSettings.upsert({
              where:  { squadId: squad.id },
              update: { eodAutoSendEnabled: false },
              create: { squadId: squad.id, eodAutoSendEnabled: false },
            });
            if (event.replyToken) {
              await replyLineMessage(
                event.replyToken,
                '✅ ปิด EOD อัตโนมัติแล้ว — ต้องกดส่งเองจากเว็บแทน',
              );
            }
          }
        }

      // ────────────────────────────────────────────────────────
      // /notify status  (ไม่ต้องเช็คสิทธิ์ — ทุก role ดูได้)
      // ────────────────────────────────────────────────────────
      } else if (event.source.groupId && lower === '/notify status') {
        const squad = await prisma.squad.findFirst({
          where:  { lineGroupId: event.source.groupId },
          select: { notificationSettings: true },
        });

        const s             = squad?.notificationSettings;
        const standupStatus = s?.standupAutoSendEnabled
          ? `🟢 เปิด เวลา ${s.standupSendTime ?? '-'}`
          : '🔴 ปิด (manual เท่านั้น)';
        const eodStatus = s?.eodAutoSendEnabled
          ? `🟢 เปิด เวลา ${s.eodSendTime ?? '-'}`
          : '🔴 ปิด (manual เท่านั้น)';

        if (event.replyToken) {
          await replyLineMessage(
            event.replyToken,
            `📋 สถานะการแจ้งเตือนตอนนี้\n☀️ Standup: ${standupStatus}\n📊 EOD: ${eodStatus}`,
          );
        }
      }
    }
  }

  // LINE ต้องการ 200 เสมอ ไม่งั้น retry
  return new Response('OK', { status: 200 });
}
