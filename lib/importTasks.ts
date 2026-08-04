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
 * คำนวณสถานะ coarse สำหรับ Squad Board (4 ค่า)
 * hasIssue มีสิทธิ์สูงสุด — ชนะทุกเงื่อนไข
 * lane.name === "To do" นับเป็น "To do" ไม่ใช่ "On-Board" (bug fix)
 */
export function computeSquadBoardStatus(task: {
  hasIssue: boolean;
  laneId: string | null;
  lane?: { name: string } | null;
}): 'To do' | 'On-Board' | 'Done' | 'มีปัญหา' {
  if (task.hasIssue) return 'มีปัญหา';
  if (!task.laneId || task.lane?.name === 'To do') return 'To do';
  if (task.lane?.name === 'Done') return 'Done';
  return 'On-Board';
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
 * เงื่อนไขตอน assign งานให้ QA_ENGINEER:
 * - assignee ต้องมี role = QA_ENGINEER
 * - assignee ต้องอยู่ squad เดียวกับ QA_LEAD ที่กำลัง assign (กันโยนงานข้าม squad)
 */
export function canAssignToQaEngineer(
  assignee: { role: string; squadId: string | null },
  qaLeadSquadId: string
) {
  return assignee.role === "QA_ENGINEER" && assignee.squadId === qaLeadSquadId;
}
