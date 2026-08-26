// lib/cronWindow.ts
//
// GitHub Actions cron ยิงมาทุก ~10 นาที และเวลาที่ยิงจริงอาจคลาดเคลื่อนได้
// (ไม่การันตีความแม่นยำระดับนาที) ดังนั้นการเทียบเวลาส่ง standup/EOD ต้องเทียบ
// เป็น "ช่วง" (window) แทนการเทียบ HH:MM แบบตรงเป๊ะ
//
// WINDOW_MINUTES ต้อง >= ความถี่ที่ scheduler ยิงจริง ไม่งั้นจะมีช่วงเวลาที่หลุดไป
// ไม่ถูกจับ (เช่น ยิงทุก 10 นาที แต่ window แคบกว่า 10 นาที)

export const WINDOW_MINUTES = 15;

/** เวลาปัจจุบันเป็นนาทีนับจากเที่ยงคืน ตาม Asia/Bangkok (ICT, UTC+7) */
export function currentIctMinutes(): number {
  const ict = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return ict.getUTCHours() * 60 + ict.getUTCMinutes();
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** true ถ้า nowMinutes อยู่ในช่วง [sendTime, sendTime + WINDOW_MINUTES) รองรับข้ามเที่ยงคืน */
export function inSendWindow(sendTime: string, nowMinutes: number): boolean {
  const sendMinutes = parseHHMM(sendTime);
  const diff = (nowMinutes - sendMinutes + 1440) % 1440;
  return diff < WINDOW_MINUTES;
}

/** true ถ้าเพิ่งส่งไปในช่วง window เดียวกันนี้แล้ว (กันส่งซ้ำตอน cron รันซ้อนกัน) */
export function alreadySentThisWindow(lastSentAt: Date | null): boolean {
  if (!lastSentAt) return false;
  const minutesSince = (Date.now() - lastSentAt.getTime()) / 60000;
  return minutesSince < WINDOW_MINUTES;
}
