// lib/importTasks.ts
//
// แนวทาง parse ไฟล์ import (ใช้จริงใน API route หรือ Server Action):
//
//   CSV  -> ใช้ `papaparse`   : import Papa from "papaparse"
//   XLSX -> ใช้ `xlsx` (SheetJS): import * as XLSX from "xlsx"
//
// ทั้งสองแบบสุดท้ายควร normalize ให้เป็น array ของ ParsedTaskRow ก่อนเขียนลง DB

export interface ParsedTaskRow {
  title: string;
  description?: string;
  squad?: string; // ชื่อ squad เช่น "SQ1" -> ต้อง lookup เป็น squadId ก่อน insert
  estimateHours?: number;
}

/** ตรวจสอบความถูกต้องเบื้องต้นของแต่ละแถวก่อน insert ลง DB */
export function validateRow(row: Record<string, any>, rowIndex: number) {
  const errors: string[] = [];
  if (!row.title || String(row.title).trim() === "") {
    errors.push(`แถวที่ ${rowIndex + 1}: ไม่มีชื่องาน (title)`);
  }
  if (row.estimateHours && isNaN(Number(row.estimateHours))) {
    errors.push(`แถวที่ ${rowIndex + 1}: estimateHours ต้องเป็นตัวเลข (หน่วยชั่วโมง เช่น 2.5)`);
  }
  return errors;
}

/**
 * ตัวอย่าง flow ฝั่ง server (Server Action) ตอน import:
 *
 * 1. Admin หรือ SQ_LEAD/QA_LEAD อัปโหลดไฟล์ที่หน้า /tasks/import
 * 2. Parse เป็น ParsedTaskRow[] แล้ว validateRow ทุกแถว รวม error ไว้โชว์ก่อน confirm
 * 3. Lookup squad name -> squadId (ถ้าไม่เจอ squad ให้ error หรือสร้างใหม่ตามที่ admin เลือก)
 * 4. สร้าง ImportBatch record (fileName, uploadedById, rowCount)
 * 5. Bulk create Task ทุกแถวด้วย:
 *      source: "IMPORTED",
 *      importBatchId: batch.id,
 *      squadId,
 *      estimatedHours,
 *      laneId: null,        // ยังไม่เข้าบอร์ดของใคร
 *      assigneeId: null,    // ยังไม่ assign ใคร
 *      pulledIntoBoardAt: null,
 * 6. Task เหล่านี้จะโผล่ในหน้า "งานทั้งหมด" ทันที (laneId เป็น null แต่ยังอยู่ใน squad ได้)
 */

/**
 * คำนวณสถานะ coarse สำหรับ Squad Board (6 ค่า)
 * hasIssue มีสิทธิ์สูงสุด — ชนะทุกเงื่อนไข
 * laneId === null → 'To do list' (ยังไม่ได้ดึงเข้าบอร์ดใคร)
 * lane 'to do'       → 'On-Board' (อยู่ในบอร์ดแล้ว รอเริ่ม)
 * lane 'in progress' → 'On-Board In Progress'
 * lane 'review'      → 'Wait for review'
 * lane 'done'        → 'Done'
 */
export function computeSquadBoardStatus(task: {
  hasIssue: boolean;
  laneId: string | null;
  lane?: { name: string } | null;
}): 'To do list' | 'On-Board' | 'On-Board In Progress' | 'Wait for review' | 'Done' | 'มีปัญหา' {
  if (task.hasIssue) return 'มีปัญหา';
  if (!task.laneId) return 'To do list';
  const ln = task.lane?.name?.toLowerCase();
  if (ln === 'to do') return 'On-Board';
  if (ln === 'in progress') return 'On-Board In Progress';
  if (ln === 'review') return 'Wait for review';
  if (ln === 'done') return 'Done';
  return 'On-Board In Progress';
}

/**
 * ต้อง reset review approval เมื่อ:
 * - งานกลับเข้า Review (เริ่ม review cycle ใหม่)
 * - งานออกจาก Review ไปที่อื่นที่ไม่ใช่ Done (แก้ไขก่อน re-submit)
 */
export function shouldResetReviewApproval(oldLaneName: string, newLaneName: string): boolean {
  if (newLaneName === 'Review') return true;
  return oldLaneName === 'Review' && newLaneName !== 'Done';
}

/**
 * เงื่อนไขตอน QA_LEAD "ดึงงานเข้าบอร์ด" (pull into board):
 * - เช็คว่า task.squadId ตรงกับ squad ที่ QA_LEAD ดูแลอยู่ (หรือ squadId เป็น null แล้วเลือก squad ตอนดึง)
 * - set laneId เป็นเลนเริ่มต้น (เช่น "To do") ของบอร์ด squad นั้น
 * - set pulledIntoBoardAt = now()
 */
export function canPullIntoBoard(task: { squadId: string | null }, qaLeadSquadId: string) {
  return task.squadId === null || task.squadId === qaLeadSquadId;
}

/**
 * เงื่อนไขตอน assign งานให้ engineer:
 * - assignee ต้องมี role = QA_ENGINEER
 * - ADMIN assign ได้ทุก squad
 * - floating pool member assign ข้าม squad ได้
 * - QA_LEAD assign ได้เฉพาะ engineer ใน squad ตัวเอง
 */
export function canAssignTaskTo(
  actor: { role: string; squadId: string | null; isFloatingPoolMember?: boolean },
  assignee: { role: string; squadId: string | null }
) {
  if (assignee.role !== "QA_ENGINEER") return false;
  if (actor.role === "ADMIN") return true;
  if (actor.isFloatingPoolMember) return true;
  return assignee.squadId === actor.squadId;
}
