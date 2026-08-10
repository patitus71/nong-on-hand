// lib/timeCalc.ts
// คำนวณเวลาทำงานจริง (09:00-18:00 หัก 12:00-13:00 พักเที่ยง, จันทร์-ศุกร์เท่านั้น)
// เสาร์-อาทิตย์ข้ามไปเลย ไม่นับทั้ง normal และ OT

export const WORK_START_HOUR  = 9;
export const WORK_END_HOUR    = 18;
export const LUNCH_START_HOUR = 12;
export const LUNCH_END_HOUR   = 13;

export interface WorkedTimeResult {
  normalMinutes: number;
  otMinutes: number;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 60000);
}

/** overlap ระหว่างสองช่วงเวลา (นาที) */
function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd   < bEnd   ? aEnd   : bEnd;
  return e > s ? minutesBetween(s, e) : 0;
}

function setTime(base: Date, h: number, m = 0): Date {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * คำนวณเวลาทำงานปกติ + OT จากช่วง start → end
 * - Normal : จ-ศ 09:00-12:00 + 13:00-18:00 (8 ชม./วัน)
 * - OT     : จ-ศ ก่อน 09:00 หรือหลัง 18:00
 * - ช่วงพักเที่ยง 12:00-13:00: ไม่นับทั้ง normal และ OT
 * - เสาร์-อาทิตย์: ข้ามไปเลย ไม่นับอะไรทั้งสิ้น
 */
export function calcWorkedTime(start: Date, end: Date): WorkedTimeResult {
  if (end <= start) return { normalMinutes: 0, otMinutes: 0 };

  let normalMinutes = 0;
  let otMinutes = 0;

  // วน loop ทีละวัน นับจากวันที่ start อยู่
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);

  while (day < end) {
    if (isWeekend(day)) {
      day.setDate(day.getDate() + 1);
      continue;
    }

    // ขอบเขตช่วงเวลาในวันนี้ที่ overlap กับ [start, end]
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const segStart = start > day    ? start   : day;
    const segEnd   = end   < dayEnd ? end     : dayEnd;

    if (segEnd <= segStart) {
      day.setDate(day.getDate() + 1);
      continue;
    }

    const workStart  = setTime(day, WORK_START_HOUR);
    const lunchStart = setTime(day, LUNCH_START_HOUR);
    const lunchEnd   = setTime(day, LUNCH_END_HOUR);
    const workEnd    = setTime(day, WORK_END_HOUR);

    // Normal slot 1: 09:00-12:00
    normalMinutes += overlap(segStart, segEnd, workStart, lunchStart);
    // Normal slot 2: 13:00-18:00
    normalMinutes += overlap(segStart, segEnd, lunchEnd, workEnd);
    // OT: ก่อน 09:00
    otMinutes     += overlap(segStart, segEnd, day, workStart);
    // OT: หลัง 18:00
    otMinutes     += overlap(segStart, segEnd, workEnd, dayEnd);
    // พักเที่ยง 12:00-13:00: ไม่นับ

    day.setDate(day.getDate() + 1);
  }

  return {
    normalMinutes: Math.round(normalMinutes),
    otMinutes:     Math.round(otMinutes),
  };
}

/** แปลงนาทีเป็น "H:MM" เช่น 495 → "8:15" */
export function formatMinutes(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? '-' : '';
  const abs  = Math.abs(totalMinutes);
  const h    = Math.floor(abs / 60);
  const m    = abs % 60;
  return `${sign}${h}:${m.toString().padStart(2, '0')}`;
}
