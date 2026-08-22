'use client';

import { useState } from 'react';

export default function BroadcastButtons() {
  const [loading, setLoading] = useState<'standup' | 'eod' | null>(null);
  const [toast,   setToast]   = useState<string | null>(null);

  async function send(type: 'standup' | 'eod') {
    setLoading(type);
    setToast(null);
    try {
      const res  = await fetch('/api/line/send-all', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type }),
      });
      const data = await res.json();
      if (data.ok) {
        const { sentMessages, totalSquads, groupCount } = data;
        if (totalSquads === 0) {
          setToast('ℹ️ ไม่มี squad ที่ตั้งค่า LINE group ไว้');
        } else {
          const groupNote = groupCount < totalSquads
            ? ` (${totalSquads} squad รวมเป็น ${groupCount} กลุ่ม ตาม LINE group)`
            : ` (${totalSquads} squad)`;
          setToast(`✅ ส่งแล้ว ${sentMessages} ข้อความ${groupNote}`);
        }
      } else {
        setToast(`❌ ${data.reason ?? 'เกิดข้อผิดพลาด'}`);
      }
    } catch {
      setToast('❌ Network error');
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={() => send('standup')}
        disabled={loading !== null}
        className="bg-surface-1 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-lg hover:border-accent transition-colors disabled:opacity-50"
      >
        {loading === 'standup' ? 'กำลังส่ง...' : '📤 ส่ง Standup ทุก Squad'}
      </button>
      <button
        onClick={() => send('eod')}
        disabled={loading !== null}
        className="bg-surface-1 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-lg hover:border-accent transition-colors disabled:opacity-50"
      >
        {loading === 'eod' ? 'กำลังส่ง...' : '📊 ส่ง EOD ทุก Squad'}
      </button>
      {toast && (
        <span className="text-[12.5px] text-txt-secondary">{toast}</span>
      )}
    </div>
  );
}
