// app/api/line/webhook/route.ts
//
// Webhook สำหรับ LINE Messaging API
// ตั้งค่า Webhook URL ใน LINE Developers Console ให้ชี้มาที่ /api/line/webhook
//
// รองรับ event:
// - join: บอทถูกเชิญเข้ากลุ่ม → log groupId เพื่อนำไปตั้งใน Squad.lineGroupId
// - message: สมาชิกพิมพ์คำสั่งต่อไปนี้ในกลุ่ม
//     /help                  — แสดงรายการคำสั่งทั้งหมด (ทุก role)
//     /link <username>       — self-link เชื่อม lineUserId กับ User
//     /standup all on HH:MM  — เปิด auto-send standup ให้ทุก squad พร้อมกัน (ADMIN เท่านั้น)
//     /standup all off       — ปิด auto-send standup ทุก squad
//     /eod all on HH:MM      — เปิด auto-send EOD ให้ทุก squad พร้อมกัน (ADMIN เท่านั้น)
//     /eod all off           — ปิด auto-send EOD ทุก squad
//     /notify status         — ดูสถานะ auto-send ของ squad ที่ผูกกับกลุ่มนี้ (ทุก role)
//
// หมายเหตุ: คำสั่งตั้งเวลาแบบแยกต่อ squad (/standup on|off เดิม) ถูกถอดออกแล้ว —
// ตอนนี้ตั้งเวลาแบบรวมทุก squad พร้อมกันเท่านั้น (ผ่าน /standup all, /eod all
// หรือปุ่ม "ใช้เวลานี้กับทุก Squad" ใน Admin Panel) ถ้าต้องการตั้งแยกเฉพาะ squad
// ใด squad หนึ่ง ให้ใช้ Admin Panel → Squads → LINE Auto-Send ต่อ squad นั้นแทน
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

/** Parse rest-of-command หลัง prefix ("/standup all " หรือ "/eod all ") */
function parseAllOnOffTime(rest: string): { action: 'on'; time: string } | { action: 'off' } | null {
  const lower = rest.toLowerCase().trim();
  if (lower === 'off') return { action: 'off' };
  if (lower.startsWith('on ')) {
    const time = lower.slice(3).trim();
    return { action: 'on', time };
  }
  return null;
}

const HELP_TEXT =
  '📋 คำสั่งที่ใช้ได้\n\n' +
  '/link <username> — เชื่อมบัญชี LINE กับ user ในระบบ\n\n' +
  '/standup all on HH:MM — เปิด standup อัตโนมัติทุก squad (ADMIN)\n' +
  '/standup all off — ปิด standup อัตโนมัติทุก squad (ADMIN)\n\n' +
  '/eod all on HH:MM — เปิด EOD อัตโนมัติทุก squad (ADMIN)\n' +
  '/eod all off — ปิด EOD อัตโนมัติทุก squad (ADMIN)\n\n' +
  '/notify status — เช็คสถานะ standup/EOD ของ squad ที่ผูกกับกลุ่มนี้\n\n' +
  '/help — แสดงข้อความนี้อีกครั้ง\n\n' +
  'ตั้งเวลาแยกเฉพาะ squad ใด squad หนึ่ง → ใช้ Admin Panel → Squads → LINE Auto-Send แทน';

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
      // /help — แสดงรายการคำสั่งทั้งหมด (ทุก role)
      // ────────────────────────────────────────────────────────
      } else if (lower === '/help') {
        if (event.replyToken) await replyLineMessage(event.replyToken, HELP_TEXT);

      // ────────────────────────────────────────────────────────
      // /standup all on|off  /eod all on|off
      // ตั้งเวลาให้ "ทุก squad พร้อมกัน" เท่านั้น (ไม่มีคำสั่งตั้งแยกต่อ squad
      // ทาง LINE แล้ว — ใช้ Admin Panel แทนถ้าต้องการแยกเฉพาะ squad)
      // ────────────────────────────────────────────────────────
      } else if (
        event.source.groupId &&
        (lower.startsWith('/standup all') || lower.startsWith('/eod all'))
      ) {
        // ── Permission check — ADMIN เท่านั้น เพราะกระทบทุก squad ────
        const sender = await prisma.user.findFirst({
          where:  { lineUserId: event.source.userId, deletedAt: null },
          select: { role: true },
        });

        if (sender?.role !== 'ADMIN') {
          if (event.replyToken) {
            await replyLineMessage(
              event.replyToken,
              '❌ คุณไม่มีสิทธิ์ตั้งค่านี้ — เฉพาะ ADMIN เท่านั้น (มีผลกับทุก squad)',
            );
          }
          continue;
        }

        const isStandup = lower.startsWith('/standup all');
        const prefix    = isStandup ? '/standup all' : '/eod all';
        const parsed    = parseAllOnOffTime(text.slice(prefix.length));

        if (!parsed) {
          const usage = isStandup
            ? '❌ รูปแบบไม่ถูกต้อง\nใช้: /standup all on HH:MM หรือ /standup all off\nตัวอย่าง: /standup all on 09:00'
            : '❌ รูปแบบไม่ถูกต้อง\nใช้: /eod all on HH:MM หรือ /eod all off\nตัวอย่าง: /eod all on 18:00';
          if (event.replyToken) await replyLineMessage(event.replyToken, usage);
          continue;
        }

        if (parsed.action === 'on' && !isValidTime(parsed.time)) {
          const usage = isStandup
            ? '❌ รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:MM เช่น 09:00)\nใช้: /standup all on 09:00'
            : '❌ รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:MM เช่น 18:00)\nใช้: /eod all on 18:00';
          if (event.replyToken) await replyLineMessage(event.replyToken, usage);
          continue;
        }

        // ── Upsert NotificationSettings ให้ทุก squad ───────────
        const squads = await prisma.squad.findMany({ select: { id: true } });
        const data   = isStandup
          ? (parsed.action === 'on'
              ? { standupAutoSendEnabled: true, standupSendTime: parsed.time }
              : { standupAutoSendEnabled: false })
          : (parsed.action === 'on'
              ? { eodAutoSendEnabled: true, eodSendTime: parsed.time }
              : { eodAutoSendEnabled: false });

        await prisma.$transaction(
          squads.map(sq =>
            prisma.notificationSettings.upsert({
              where:  { squadId: sq.id },
              update: data,
              create: { squadId: sq.id, ...data },
            }),
          ),
        );

        if (event.replyToken) {
          const label = isStandup ? 'Standup' : 'EOD';
          const msg   = parsed.action === 'on'
            ? `✅ ตั้ง ${label} อัตโนมัติเวลา ${parsed.time} ให้ทุก squad (${squads.length} squad) แล้ว`
            : `✅ ปิด ${label} อัตโนมัติทุก squad (${squads.length} squad) แล้ว`;
          await replyLineMessage(event.replyToken, msg);
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
