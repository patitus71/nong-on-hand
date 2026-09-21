// เหมือน validation ของ prLink — ต้องเป็น http/https เท่านั้น กัน javascript: URI แม้ว่าค่าจะมาจาก
// client parse JSON แล้วก็ตาม (ไม่เชื่อ input จากฝั่ง client 100%) — url ที่ไม่ผ่านจะถูก drop เป็น null
// เฉยๆ ไม่ throw กันพังทั้ง batch (ผู้เรียกที่ต้องการ error แบบ throw ให้ validate เองก่อนเรียกฟังก์ชันนี้)
export function sanitizeJiraUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url.trim();
  } catch {
    return null;
  }
}

// Jira URL มักลงท้ายด้วย ticket key เช่น .../browse/SR-25842 หรือ .../issues/SR-25842?... —
// ดึง segment สุดท้ายของ path มาเดาเป็น ticket key เพื่อโชว์เป็น label แทนการให้ user กรอกแยก
export function extractJiraTicketNo(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}
