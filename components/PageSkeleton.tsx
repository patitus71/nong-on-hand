// Generic loading skeleton — ใช้ใน loading.tsx ของ route ที่ไม่มี skeleton เฉพาะ
// เพื่อให้การเปลี่ยนหน้าตอบสนองทันที (Next.js prefetch loading boundary ได้) แทนที่จะค้างรอ server
export default function PageSkeleton() {
  return (
    <div className="px-7 py-6 pb-16">
      <div className="flex items-center justify-between mb-5">
        <div className="h-7 w-40 bg-surface-2 rounded-md animate-pulse" />
        <div className="h-9 w-28 bg-surface-2 rounded-md animate-pulse" />
      </div>
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-surface-1 border border-app-border rounded-[12px] p-3 h-40 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
