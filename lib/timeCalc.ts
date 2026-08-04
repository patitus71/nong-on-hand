// lib/timeCalc.ts
// คำนวณเวลาทำงานจริง (09:00-18:00, จันทร์-ศุกร์) และ OT จากช่วงเวลา start -> end
// รองรับงานที่ข้ามวัน/ข้ามสัปดาห์ โดย loop ทีละวัน

export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;

export interface WorkedTimeResult {
  normalMinutes: number;
  otMinutes: number;
}

function setHour(date: Date, hour: number, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function isWeekend(date: Date) {
  const day = date.getDay(); // 0 = อาทิตย์, 6 = เสาร์
  return day === 0 || day === 6;
}

/**
 * คำนวณเวลาทำงานปกติ + OT จากช่วง start -> end
 * ตัดตามวันทำงาน (จ-ศ) และเวลาทำการ 09:00-18:00
 * เวลานอกช่วงนี้ (ก่อน 9 โมง / หลัง 6 โมง / วันเสาร์-อาทิตย์) นับเป็น OT ทั้งหมด
 */
export function calcWorkedTime(start: Date, end: Date): WorkedTimeResult {
  if (end <= start) return { normalMinutes: 0, otMinutes: 0 };

  let normalMinutes = 0;
  let otMinutes = 0;
  let cursor = new Date(start);

  while (cursor < end) {
    const dayEnd = setHour(cursor, 23, 59); // สิ้นสุดวันของ cursor (23:59)
    const segmentEnd = end < dayEnd ? end : dayEnd;

    if (isWeekend(cursor)) {
      // วันหยุด: เวลาทั้งหมดในวันนี้ถือเป็น OT
      otMinutes += (segmentEnd.getTime() - cursor.getTime()) / 60000;
    } else {
      const workStart = setHour(cursor, WORK_START_HOUR);
      const workEnd = setHour(cursor, WORK_END_HOUR);

      // ส่วนที่ overlap กับเวลาทำงานปกติ
      const overlapStart = cursor > workStart ? cursor : workStart;
      const overlapEnd = segmentEnd < workEnd ? segmentEnd : workEnd;
      if (overlapEnd > overlapStart) {
        normalMinutes += (overlapEnd.getTime() - overlapStart.getTime()) / 60000;
      }

      // ก่อนเวลาทำงาน (เช่น เริ่ม 7 โมง) -> OT
      if (cursor < workStart) {
        const otEnd = segmentEnd < workStart ? segmentEnd : workStart;
        otMinutes += (otEnd.getTime() - cursor.getTime()) / 60000;
      }

      // หลังเวลาทำงาน (เช่น ทำถึง 3 ทุ่ม) -> OT
      if (segmentEnd > workEnd) {
        const otStart = cursor > workEnd ? cursor : workEnd;
        otMinutes += (segmentEnd.getTime() - otStart.getTime()) / 60000;
      }
    }

    // ไปวันถัดไป เริ่มเวลา 00:00
    cursor = new Date(dayEnd.getTime() + 60000);
  }

  return {
    normalMinutes: Math.round(normalMinutes),
    otMinutes: Math.round(otMinutes),
  };
}

/** แปลงนาทีเป็น "H:MM" เช่น 495 -> "8:15" */
export function formatMinutes(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${m.toString().padStart(2, "0")}`;
}
