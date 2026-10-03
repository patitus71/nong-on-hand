// Auto timer ถูกปิดแล้ว — บันทึกเวลาทำได้ทาง manual (POST /api/tasks/[taskId]/timelog) เท่านั้น
// /timelog/stop ยังเปิดไว้ให้หยุด timer ที่ค้างจากระบบเดิมได้
export async function POST() {
  return new Response('ระบบจับเวลาอัตโนมัติถูกปิดแล้ว — กรุณาบันทึกเวลาแบบ manual', { status: 410 });
}
