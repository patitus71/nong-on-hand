// lib/lineNotify.ts
//
// ส่งแจ้งเตือนผ่าน LINE เข้ากลุ่มทีม — ใช้ LINE Messaging API (ไม่ใช่ LINE Notify ที่ปิดไปแล้ว
// ตั้งแต่ 31 มีนาคม 2025)
//
// @mention ใช้ message type "textV2" + "substitution" map (format ใหม่ตั้งแต่ Oct 2024)
// type "text" + "mention.mentionees" (index/length) ถูกเพิกเฉยโดย LINE API อย่างเงียบๆ

const LINE_PUSH_ENDPOINT  = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

export async function sendLineTextMessage(
  to:   string,
  text: string,
): Promise<{ success: boolean; reason?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { success: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' };
  console.log(`[LINE text] sending to=${to} chars=${text.length}`);
  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ to, messages: [{ type: 'text', text }] }),
    });
    const responseBody = await res.text();
    console.log('[LINE text] response:', res.status, responseBody);
    if (!res.ok) return { success: false, reason: `LINE API error ${res.status}: ${responseBody}` };
    return { success: true };
  } catch (err) {
    console.error('[LINE text] fetch error:', err);
    return { success: false, reason: `Network error: ${String(err)}` };
  }
}

type SubstitutionMention = {
  type: 'mention';
  mentionee: { type: 'user'; userId: string };
};

/**
 * ติดตาม {mN} placeholder → userId สำหรับ LINE textV2 substitution
 * สร้าง 1 key ต่อ 1 ครั้งที่ mention — คนเดียวกันใน 2 squad = 2 key ต่างกัน
 */
export class MentionContext {
  private counter = 0;
  readonly substitution: Record<string, SubstitutionMention> = {};

  /**
   * ถ้า userId มี → คืน "{mN}" และบันทึก substitution entry
   * ถ้าไม่มี → คืน "@displayName" เป็นข้อความธรรมดา
   */
  slot(displayName: string, userId: string | null | undefined): string {
    if (!userId) return `@${displayName}`;
    const key = `m${this.counter++}`;
    this.substitution[key] = { type: 'mention', mentionee: { type: 'user', userId } };
    return `{${key}}`;
  }

  get hasAny(): boolean { return this.counter > 0; }

  /** กรองเฉพาะ key ที่ปรากฏจริงในข้อความ chunk เพื่อไม่ให้ substitution ข้ามก้อนข้อความ */
  filterForChunk(chunkText: string): Record<string, SubstitutionMention> {
    return Object.fromEntries(
      Object.entries(this.substitution).filter(([key]) => chunkText.includes(`{${key}}`))
    );
  }
}

/**
 * ส่ง LINE textV2 พร้อม @mention โดยใช้ MentionContext
 * ถ้า chunk ไม่มี mention → fallback ไป sendLineTextMessage อัตโนมัติ
 *
 * text ต้องมี {mN} placeholder ที่สร้างโดย ctx.slot()
 * ไม่ต้องคำนวณ index/length อีกต่อไป (ต่างจาก type "text" เดิม)
 */
export async function sendLineGroupMessageWithMention(
  groupId: string,
  text:    string,
  ctx:     MentionContext,
): Promise<{ success: boolean; reason?: string }> {
  const substitution = ctx.filterForChunk(text);

  if (Object.keys(substitution).length === 0) {
    return sendLineTextMessage(groupId, text);
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { success: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' };

  const payload = {
    to:       groupId,
    messages: [{ type: 'textV2', text, substitution }],
  };

  console.log('LINE_PAYLOAD:', JSON.stringify(payload, null, 2));

  try {
    const res = await fetch(LINE_PUSH_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(payload),
    });
    const responseBody = await res.text();
    console.log('[LINE mention] response:', res.status, responseBody);
    if (!res.ok) return { success: false, reason: `LINE API error ${res.status}: ${responseBody}` };
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
  text:       string,
): Promise<{ success: boolean; reason?: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { success: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' };
  try {
    const res = await fetch(LINE_REPLY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
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

/**
 * ตอบกลับในกลุ่มโดยใช้ replyToken พร้อม @mention (textV2 + substitution) —
 * fallback เป็น "text" ธรรมดาถ้า chunk นี้ไม่มี mention จริง (เหมือน sendLineGroupMessageWithMention)
 */
export async function replyLineMessageWithMention(
  replyToken: string,
  text:       string,
  ctx:        MentionContext,
): Promise<{ success: boolean; reason?: string }> {
  const substitution = ctx.filterForChunk(text);
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { success: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN ยังไม่ได้ตั้งค่า' };

  const message = Object.keys(substitution).length > 0
    ? { type: 'textV2', text, substitution }
    : { type: 'text', text };

  try {
    const res = await fetch(LINE_REPLY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ replyToken, messages: [message] }),
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

/** แปลง reason ดิบจาก LINE API ให้เป็นข้อความที่ user อ่านเข้าใจได้ */
export function friendlyLineErrorReason(reason: string | undefined): string {
  if (!reason) return 'ไม่ทราบสาเหตุ';
  if (reason.includes('monthly limit')) return 'โควตาข้อความ LINE เต็มเดือนนี้';
  if (reason.includes('LINE_CHANNEL_ACCESS_TOKEN')) return 'ยังไม่ได้ตั้งค่า LINE token';
  if (reason.includes('Network error')) return 'เชื่อมต่อ LINE API ไม่ได้';
  if (/LINE API error \d+/.test(reason)) return 'LINE API ปฏิเสธคำขอ — ดู log ฝั่ง server';
  return reason;
}

/** แปลงวันที่เป็น dd/MM/พศ (พุทธศักราช) */
export function thaiDate(d: Date): string {
  const day   = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year  = d.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

/** แปลงนาทีเป็น H:MM */
export function formatMinutes(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}
