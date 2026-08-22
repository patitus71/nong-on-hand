// lib/lineNotify.ts
//
// ส่งแจ้งเตือนผ่าน LINE เข้ากลุ่มทีม — ใช้ LINE Messaging API (ไม่ใช่ LINE Notify ที่ปิดไปแล้ว
// ตั้งแต่ 31 มีนาคม 2025) รองรับทั้งข้อความธรรมดา (standup/EOD) และข้อความพร้อม @mention (assign)

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

/**
 * ส่งข้อความธรรมดาเข้ากลุ่ม (หรือหา user/room ก็ได้ ใช้ endpoint เดียวกัน) — ใช้กับ
 * standup เช้า และ EOD summary ที่ไม่ต้อง mention ใคร
 */
export async function sendLineTextMessage(
  to: string,
  text: string
): Promise<{ success: boolean; reason?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { success: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' };
  console.log(`[LINE text] sending to=${to} chars=${text.length}`);
  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    });
    const responseBody = await res.text();
    console.log('[LINE text] response:', res.status, responseBody);
    if (!res.ok) {
      return { success: false, reason: `LINE API error ${res.status}: ${responseBody}` };
    }
    return { success: true };
  } catch (err) {
    console.error('[LINE text] fetch error:', err);
    return { success: false, reason: `Network error: ${String(err)}` };
  }
}

export interface LineMentionee {
  type: 'user';   // required โดย LINE API — ขาดไปทำให้ mention เป็นแค่ตัวหนังสือธรรมดา
  index: number;  // ตำแหน่ง UTF-16 code unit (JavaScript string index = ค่าที่ถูกต้อง)
  length: number;
  userId: string;
}

/**
 * ส่งข้อความเข้ากลุ่มพร้อม @mention — ใช้ตอน assign งาน และ standup/EOD
 * placeholderName ต้องเป็น substring ที่มีอยู่จริงใน text (เช่น "@Nong")
 * ฟังก์ชันนี้หาตำแหน่ง index/length ให้อัตโนมัติจาก text.indexOf()
 *
 * สำคัญ: LINE mention ทำงานได้เฉพาะ userId ที่เป็นสมาชิกจริงของกลุ่มนั้น
 */
export async function sendLineGroupMessageWithMention(
  groupId: string,
  text: string,
  mentions: { placeholderName: string; userId: string }[]
): Promise<{ success: boolean; reason?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { success: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' };

  const mentionees: LineMentionee[] = mentions
    .map(m => {
      const index = text.indexOf(m.placeholderName);
      if (index === -1) return null;
      return { type: 'user' as const, index, length: m.placeholderName.length, userId: m.userId };
    })
    .filter((m): m is LineMentionee => m !== null);

  const payload = {
    to: groupId,
    messages: [{
      type: 'text',
      text,
      ...(mentionees.length > 0 ? { mention: { mentionees } } : {}),
    }],
  };

  console.log('LINE_PAYLOAD:', JSON.stringify(payload, null, 2));

  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const responseBody = await res.text();
    console.log('[LINE mention] response:', res.status, responseBody);
    if (!res.ok) {
      return { success: false, reason: `LINE API error ${res.status}: ${responseBody}` };
    }
    return { success: true };
  } catch (err) {
    console.error('[LINE mention] fetch error:', err);
    return { success: false, reason: `Network error: ${String(err)}` };
  }
}

/**
 * ตอบกลับในกลุ่มโดยใช้ replyToken (webhook) — ใช้ตอน self-link สำเร็จ
 */
export async function replyLineMessage(
  replyToken: string,
  text: string
): Promise<{ success: boolean; reason?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { success: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' };
  try {
    const res = await fetch(LINE_REPLY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { success: false, reason: `LINE Reply API error ${res.status}: ${body}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, reason: `Network error: ${String(err)}` };
  }
}

/** แปลงวันที่เป็น dd/MM/พศ (พุทธศักราช) */
export function thaiDate(d: Date): string {
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

/** แปลงนาทีเป็น H:MM */
export function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}
