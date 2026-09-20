'use client';

// เส้น loading บางๆ ด้านบนจอ — โชว์ระหว่างรอ router.refresh() ที่ยิงจาก action ในหน้า (ลบ, ย้ายเลน,
// เปลี่ยนสถานะ, assign ฯลฯ) commit จริงๆ ไม่ใช่แค่ fetch เสร็จ เพราะ router.refresh() เป็น
// fire-and-forget (ไม่มี promise ให้ await) — ถ้าไม่มี indicator นี้ user จะเห็นหน้าจอ "ว่าง/ไม่ loading
// แล้ว" ทั้งที่ข้อมูลบนจอยังเป็นของเก่าอยู่ ทำให้เข้าใจผิดว่าการ์ด/สถานะไม่ยอมอัปเดต
export default function TopLoadingBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <>
      <style>{`
        @keyframes top-loading-bar-sweep {
          0%   { left: -33%; }
          100% { left: 100%; }
        }
      `}</style>
      <div className="fixed top-0 left-0 right-0 h-[3px] z-[9999] overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 h-full w-1/3 bg-accent"
          style={{ animation: 'top-loading-bar-sweep 1s ease-in-out infinite' }}
        />
      </div>
    </>
  );
}
