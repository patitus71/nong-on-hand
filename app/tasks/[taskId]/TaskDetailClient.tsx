'use client';

import { useState } from 'react';
import Link from 'next/link';
import { fmt, initials, avatarColor } from '@/lib/ui';

type TimeLog  = { normalMinutes: number; otMinutes: number; startAt: string; endAt: string };
type RetroRef = { id: string; category: string; content: string; retroId: string; retroTitle: string; createdAt: string };
type IssueLog = {
  id: string; issueNote: string;
  flaggedByName: string; flaggedAt: string;
  resolutionNote: string | null;
  resolvedByName: string | null; resolvedAt: string | null;
};
type Task = {
  id: string; title: string; description: string | null;
  hasIssue: boolean; issueNote: string | null; source: string;
  squad: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  laneName: string | null;
  timeLogs:   TimeLog[];
  retroItems: RetroRef[];
  issueLogs:  IssueLog[];
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function catLabel(cat: string) {
  if (cat === 'WENT_WELL')   return 'Went well';
  if (cat === 'TO_IMPROVE')  return 'To improve';
  if (cat === 'ACTION_ITEM') return 'Action item';
  return cat;
}

export default function TaskDetailClient({ task: init, userId }: { task: Task; userId: string }) {
  const [task, setTask] = useState(init);

  // Flag state
  const [flagging,     setFlagging]     = useState(false);
  const [flagContent,  setFlagContent]  = useState(init.issueNote ?? '');
  const [flagSaving,   setFlagSaving]   = useState(false);

  // Resolve (unflag) modal state
  const [resolveOpen,     setResolveOpen]     = useState(false);
  const [resolutionNote,  setResolutionNote]  = useState('');
  const [resolveError,    setResolveError]    = useState('');
  const [resolveSaving,   setResolveSaving]   = useState(false);

  // Send-to-retro state
  const [retroOpen,    setRetroOpen]    = useState(false);
  const [retroContent, setRetroContent] = useState(init.issueNote ?? '');
  const [retroSaving,  setRetroSaving]  = useState(false);
  const [retroResult,  setRetroResult]  = useState<{ retroId: string; squadId: string } | null>(null);

  const av = task.assignee ? avatarColor(task.assignee.name) : null;
  const totalNormal = task.timeLogs.reduce((s, l) => s + l.normalMinutes, 0);
  const totalOt     = task.timeLogs.reduce((s, l) => s + l.otMinutes, 0);

  async function toggleFlag() {
    if (task.hasIssue) {
      // Unflag requires modal with resolution note
      setResolveOpen(true);
      setResolutionNote('');
      setResolveError('');
    } else {
      setFlagging(true);
      setFlagContent('');
    }
  }

  async function submitResolve() {
    if (!resolutionNote.trim()) {
      setResolveError('กรุณาอธิบายวิธีแก้ไขก่อนยืนยัน — ต้องมีเหตุผลเสมอ ห้ามเว้นว่าง');
      return;
    }
    setResolveSaving(true);
    const res = await fetch(`/api/tasks/${task.id}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasIssue: false, resolutionNote: resolutionNote.trim() }),
    });
    if (res.ok) {
      setTask(t => ({ ...t, hasIssue: false, issueNote: null }));
      setResolveOpen(false);
    } else {
      setResolveError(await res.text());
    }
    setResolveSaving(false);
  }

  async function submitFlag(e: React.FormEvent) {
    e.preventDefault();
    setFlagSaving(true);
    const res = await fetch(`/api/tasks/${task.id}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasIssue: true, issueNote: flagContent }),
    });
    if (res.ok) {
      setTask(t => ({ ...t, hasIssue: true, issueNote: flagContent }));
      setFlagging(false);
    }
    setFlagSaving(false);
  }

  async function submitRetro(e: React.FormEvent) {
    e.preventDefault();
    setRetroSaving(true);
    const res = await fetch(`/api/tasks/${task.id}/send-to-retro`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: retroContent }),
    });
    if (res.ok) {
      const data = await res.json();
      setRetroResult({ retroId: data.retroId, squadId: data.squadId });
      setRetroOpen(false);
      if (!task.hasIssue) setTask(t => ({ ...t, hasIssue: true, issueNote: retroContent }));
    }
    setRetroSaving(false);
  }

  const sbRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between text-[12.5px] py-1.5 border-b border-app-border last:border-none">
      <span className="text-txt-secondary">{label}</span>
      <span className="text-txt-primary">{value}</span>
    </div>
  );

  return (
    <div className="max-w-[900px] mx-auto px-7 py-6 pb-16">
      <Link href="/tasks" className="text-[12.5px] text-txt-secondary hover:text-txt-primary inline-block mb-3.5">
        ← กลับ
      </Link>

      {/* Issue banner */}
      {task.hasIssue && (
        <div className="flex items-center gap-2 bg-danger-bg text-danger text-[12.5px] px-3 py-2.5 rounded-lg mb-3.5">
          ⚠ งานนี้ถูกทำเครื่องหมายว่ามีปัญหา{task.issueNote && ` — "${task.issueNote}"`}
        </div>
      )}

      {/* Send-to-retro success */}
      {retroResult && (
        <div className="flex items-center justify-between bg-success-bg text-success text-[12.5px] px-3 py-2.5 rounded-lg mb-3.5">
          <span>✓ ส่งเข้า Retro แล้ว</span>
          <Link href={`/squads/${retroResult.squadId}/retro`} className="underline">ดู Retro →</Link>
        </div>
      )}

      <div className="grid gap-6" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        {/* ─── Left ─── */}
        <div>
          <h1 className="text-xl font-semibold text-txt-primary mb-1.5">{task.title}</h1>
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {task.squad && <span className="text-[11.5px] bg-surface-2 text-txt-secondary px-2.5 py-1 rounded-full">{task.squad.name}</span>}
            {task.laneName && <span className="text-[11.5px] bg-warning-bg text-warning px-2.5 py-1 rounded-full">{task.laneName}</span>}
            <span className="text-[11.5px] bg-surface-2 text-txt-secondary px-2.5 py-1 rounded-full">{task.source === 'IMPORTED' ? 'Imported' : 'Manual'}</span>
          </div>

          {/* Description */}
          <p className="text-[11px] uppercase tracking-wider text-txt-muted font-medium mb-2">รายละเอียด</p>
          <p className="text-[13.5px] text-txt-secondary leading-relaxed">
            {task.description || <span className="text-txt-muted italic">ยังไม่มีรายละเอียด</span>}
          </p>

          {/* Retro history */}
          {task.retroItems.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-wider text-txt-muted font-medium mt-5 mb-2">
                พูดถึงใน retro ({task.retroItems.length} ครั้ง)
              </p>
              {task.retroItems.map(r => (
                <div key={r.id} className="flex items-center justify-between text-[12px] px-2.5 py-2 bg-surface-2 rounded-lg mb-1.5">
                  <span className="text-txt-secondary">{r.retroTitle} · {catLabel(r.category)}</span>
                  <span className="text-txt-muted">{new Date(r.createdAt).toLocaleDateString('th-TH')}</span>
                </div>
              ))}
              {task.retroItems.length >= 2 && (
                <div className="text-[11.5px] text-warning bg-warning-bg px-2.5 py-2 rounded-md mt-2">
                  ⚠ ปัญหานี้ถูกพูดถึงซ้ำ {task.retroItems.length} ครั้ง — อาจต้องจัดลำดับความสำคัญเพิ่ม
                </div>
              )}
            </>
          )}

          {/* Issue history */}
          {task.issueLogs.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-wider text-txt-muted font-medium mt-5 mb-2">
                ประวัติปัญหา ({task.issueLogs.length} รอบ)
              </p>
              <div className="flex flex-col gap-2">
                {task.issueLogs.map(l => (
                  <div key={l.id} className="bg-surface-1 border border-app-border rounded-lg px-3 py-2.5 text-[12px]">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-danger font-medium flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-danger inline-block" />
                        {l.issueNote || '(ไม่มีโน้ต)'}
                      </span>
                      <span className="text-txt-muted whitespace-nowrap text-[11px]">{fmtDate(l.flaggedAt)}</span>
                    </div>
                    <p className="text-txt-muted text-[11px] mb-1">flag โดย {l.flaggedByName}</p>
                    {l.resolvedAt ? (
                      <div className="mt-1.5 pt-1.5 border-t border-app-border">
                        <p className="text-success text-[11px]">✓ แก้ไขแล้ว · {fmtDate(l.resolvedAt)} โดย {l.resolvedByName}</p>
                        {l.resolutionNote && <p className="text-txt-secondary text-[11.5px] mt-0.5">{l.resolutionNote}</p>}
                      </div>
                    ) : (
                      <p className="text-warning text-[11px] mt-1">ยังไม่ได้แก้ไข</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Time logs */}
          {task.timeLogs.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-wider text-txt-muted font-medium mt-5 mb-2">ประวัติเวลาที่ log</p>
              <div className="bg-surface-1 border border-app-border rounded-[10px] overflow-hidden">
                {task.timeLogs.map((l, i) => {
                  const nFmt = fmt(l.normalMinutes);
                  const oFmt = fmt(l.otMinutes);
                  return (
                    <div key={i} className="flex items-center justify-between text-[12.5px] px-3.5 py-2.5 border-b border-app-border last:border-none">
                      <span className="text-txt-secondary">{fmtDate(l.startAt)} – {fmtDate(l.endAt)}</span>
                      <span className="text-txt-primary">
                        {nFmt ?? '—'}{oFmt && <span className="text-warning text-[11px] ml-1.5">+OT {oFmt}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ─── Right ─── */}
        <div>
          {/* Metadata */}
          <div className="bg-surface-1 border border-app-border rounded-[10px] px-3.5 py-1 mb-3.5">
            {sbRow('ผู้รับผิดชอบ',
              task.assignee && av
                ? <span className="flex items-center gap-1.5">
                    <span className="w-[18px] h-[18px] rounded-full text-[9px] font-semibold flex items-center justify-center"
                      style={{ background: av.bg, color: av.fg }}>{initials(task.assignee.name)}</span>
                    {task.assignee.name}
                  </span>
                : '—'
            )}
            {sbRow('Squad',    task.squad?.name ?? '—')}
            {sbRow('สถานะ',   task.laneName ?? 'ยังไม่ดึง')}
            {sbRow('เวลารวม',
              totalNormal > 0
                ? <>{fmt(totalNormal)}{totalOt > 0 && <span className="text-warning text-[11px] ml-1.5">+OT {fmt(totalOt)}</span>}</>
                : '—'
            )}
            {sbRow('มีปัญหา', task.hasIssue ? <span className="text-danger">ใช่</span> : 'ไม่มี')}
          </div>

          {/* Actions */}
          <div className="bg-surface-1 border border-app-border rounded-[10px] p-3.5 flex flex-col gap-2">

            {/* Flag issue */}
            {!task.hasIssue && !flagging && (
              <button onClick={toggleFlag}
                className="w-full text-left text-[12.5px] px-3 py-2 rounded-md border border-app-border bg-surface-2 hover:bg-[#2a2e3a] text-txt-primary transition-colors">
                ⚠ ทำเครื่องหมายว่ามีปัญหา
              </button>
            )}
            {!task.hasIssue && flagging && (
              <form onSubmit={submitFlag} className="flex flex-col gap-1.5">
                <textarea
                  autoFocus rows={2}
                  value={flagContent}
                  onChange={e => setFlagContent(e.target.value)}
                  placeholder="อธิบายปัญหาสั้นๆ..."
                  className="w-full bg-surface-2 border border-accent text-txt-primary text-[12.5px] px-2.5 py-2 rounded-lg focus:outline-none resize-none"
                />
                <div className="flex gap-1.5">
                  <button type="submit" disabled={flagSaving}
                    className="bg-danger text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-50">บันทึก</button>
                  <button type="button" onClick={() => setFlagging(false)}
                    className="text-txt-muted text-[12px] px-2 py-1.5 hover:text-txt-secondary">ยกเลิก</button>
                </div>
              </form>
            )}

            {/* Send to retro */}
            {!retroOpen && !retroResult && (
              <button onClick={() => { setRetroOpen(true); setRetroContent(task.issueNote ?? task.title); }}
                className="w-full text-left text-[12.5px] px-3 py-2 rounded-md border border-app-border bg-surface-2 hover:bg-[#2a2e3a] text-txt-primary transition-colors">
                ➜ ส่งเข้า Retro
              </button>
            )}
            {retroOpen && (
              <form onSubmit={submitRetro} className="flex flex-col gap-1.5">
                <textarea
                  autoFocus rows={2}
                  value={retroContent}
                  onChange={e => setRetroContent(e.target.value)}
                  placeholder="เนื้อหาการ์ด retro..."
                  className="w-full bg-surface-2 border border-accent text-txt-primary text-[12.5px] px-2.5 py-2 rounded-lg focus:outline-none resize-none"
                />
                <div className="flex gap-1.5">
                  <button type="submit" disabled={retroSaving || !retroContent.trim()}
                    className="bg-accent text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-50">ส่ง</button>
                  <button type="button" onClick={() => setRetroOpen(false)}
                    className="text-txt-muted text-[12px] px-2 py-1.5 hover:text-txt-secondary">ยกเลิก</button>
                </div>
              </form>
            )}

            {/* Unflag — opens resolve modal */}
            {task.hasIssue && (
              <button onClick={toggleFlag}
                className="w-full text-left text-[12.5px] px-3 py-2 rounded-md border border-danger/40 bg-surface-2 text-danger hover:bg-danger-bg transition-colors">
                ✓ แก้ไขปัญหาแล้ว — ปลด flag
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Resolve modal */}
      {resolveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[380px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-success mb-1">✓ ยืนยันว่าแก้ไขปัญหาแล้ว</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">งานนี้จะปลด flag ปัญหาออก</p>
            <label className="block text-[12px] text-txt-secondary mb-1.5">
              อธิบายว่าแก้ไขปัญหานี้ยังไง <span className="text-danger">(จำเป็นต้องกรอก)</span>
            </label>
            <textarea
              autoFocus
              value={resolutionNote}
              onChange={e => setResolutionNote(e.target.value)}
              placeholder="เช่น เพิ่ม null check ก่อน call ฟังก์ชัน แก้ปัญหา crash เมื่อ state เป็น undefined"
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent resize-y min-h-[80px]"
            />
            {resolveError && <p className="text-[11.5px] text-danger mt-2">{resolveError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setResolveOpen(false)} disabled={resolveSaving}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors">
                ยกเลิก
              </button>
              <button onClick={submitResolve} disabled={resolveSaving}
                className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
                {resolveSaving ? 'กำลังบันทึก...' : 'ยืนยันและปลด flag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
