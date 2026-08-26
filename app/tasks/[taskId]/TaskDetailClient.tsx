'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmt, initials, avatarColor } from '@/lib/ui';

type TimeLog     = { normalMinutes: number; otMinutes: number; startAt: string; endAt: string };
type TaskLogEntry = { id: string; action: string; detail: string | null; createdAt: string; userName: string };
type RetroRef    = { id: string; category: string; content: string; retroId: string; retroTitle: string; createdAt: string };
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
  taskLogs:   TaskLogEntry[];
  retroItems: RetroRef[];
  issueLogs:  IssueLog[];
};

function fmtElapsed(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

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

export default function TaskDetailClient({
  task: init,
  userId,
  userRole,
  userSquadId,
  isFloatingPoolMember,
}: {
  task: Task;
  userId: string;
  userRole: string;
  userSquadId: string | null;
  isFloatingPoolMember: boolean;
}) {
  const router = useRouter();
  const [task, setTask] = useState(init);

  // Permission: assignee, ADMIN, QA_LEAD/QA_ENGINEER of same squad, or floating pool member
  const canEdit =
    userRole === 'ADMIN' ||
    isFloatingPoolMember ||
    task.assignee?.id === userId ||
    ((userRole === 'QA_LEAD' || userRole === 'QA_ENGINEER') && !!task.squad?.id && userSquadId === task.squad.id);

  // Title edit state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft,   setTitleDraft]   = useState('');
  const [titleError,   setTitleError]   = useState('');
  const [titleSaving,  setTitleSaving]  = useState(false);

  // Description edit state
  const [editingDesc,  setEditingDesc]  = useState(false);
  const [descDraft,    setDescDraft]    = useState('');
  const [descSaving,   setDescSaving]   = useState(false);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed) { setTitleError('ชื่องานต้องมีอย่างน้อย 1 ตัวอักษร'); return; }
    setTitleSaving(true);
    setTitleError('');
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    });
    if (res.ok) {
      const data = await res.json();
      setTask(t => ({ ...t, title: data.title }));
      setEditingTitle(false);
      showToast('บันทึกชื่องานแล้ว');
    } else {
      setTitleError(await res.text());
    }
    setTitleSaving(false);
  }

  async function saveDesc() {
    setDescSaving(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: descDraft }),
    });
    if (res.ok) {
      const data = await res.json();
      setTask(t => ({ ...t, description: data.description }));
      setEditingDesc(false);
      showToast('บันทึก description แล้ว');
    }
    setDescSaving(false);
  }

  // Flag state
  const [flagging,     setFlagging]     = useState(false);
  const [flagContent,  setFlagContent]  = useState(init.issueNote ?? '');
  const [flagSaving,   setFlagSaving]   = useState(false);

  // Resolve (unflag) modal state
  const [resolveOpen,     setResolveOpen]     = useState(false);
  const [resolutionNote,  setResolutionNote]  = useState('');
  const [resolveError,    setResolveError]    = useState('');
  const [resolveSaving,   setResolveSaving]   = useState(false);

  // Manual time log state
  const [timeLogOpen,    setTimeLogOpen]    = useState(false);
  const [normalHours,    setNormalHours]    = useState('');
  const [otHours,        setOtHours]        = useState('');
  const [timeLogSaving,  setTimeLogSaving]  = useState(false);
  const [timeLogError,   setTimeLogError]   = useState('');

  // Clear all time logs state
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearSaving,  setClearSaving]  = useState(false);

  async function clearAllTimeLogs() {
    setClearSaving(true);
    const res = await fetch(`/api/tasks/${task.id}/timelog`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      setTask(t => ({ ...t, timeLogs: [], taskLogs: [data.taskLog, ...t.taskLogs] }));
      setClearConfirm(false);
    }
    setClearSaving(false);
  }

  // Auto timer state
  const [timerSaving,  setTimerSaving]  = useState(false);
  const openSession = task.timeLogs.find(l => l.endAt === '');
  const [elapsed, setElapsed] = useState<number>(() =>
    openSession ? Math.floor((Date.now() - new Date(openSession.startAt).getTime()) / 1000) : 0
  );

  useEffect(() => {
    if (!openSession) return;
    setElapsed(Math.floor((Date.now() - new Date(openSession.startAt).getTime()) / 1000));
    const tick = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(openSession.startAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [openSession?.startAt]);

  async function startTimerFn() {
    setTimerSaving(true);
    const res = await fetch(`/api/tasks/${task.id}/timelog/start`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setTask(t => ({
        ...t,
        timeLogs: [{ normalMinutes: 0, otMinutes: 0, startAt: data.startAt, endAt: '' }, ...t.timeLogs],
      }));
      setElapsed(0);
    }
    setTimerSaving(false);
  }

  async function stopTimerFn() {
    setTimerSaving(true);
    const res = await fetch(`/api/tasks/${task.id}/timelog/stop`, { method: 'POST' });
    if (res.ok) {
      const log = await res.json();
      setTask(t => ({
        ...t,
        timeLogs: t.timeLogs.map(l =>
          l.endAt === ''
            ? { normalMinutes: log.normalMinutes, otMinutes: log.otMinutes, startAt: log.startAt, endAt: log.endAt }
            : l
        ),
      }));
      setElapsed(0);
    }
    setTimerSaving(false);
  }

  async function submitTimeLog(e: React.FormEvent) {
    e.preventDefault();
    const n = parseFloat(normalHours);
    if (!n || n <= 0) { setTimeLogError('กรุณากรอกชั่วโมงที่ทำงาน'); return; }
    setTimeLogSaving(true);
    setTimeLogError('');
    const res = await fetch(`/api/tasks/${task.id}/timelog`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalHours: n, otHours: parseFloat(otHours) || 0 }),
    });
    if (res.ok) {
      const log = await res.json();
      setTask(t => ({ ...t, timeLogs: [...t.timeLogs, log] }));
      setNormalHours(''); setOtHours(''); setTimeLogOpen(false);
    } else {
      setTimeLogError(await res.text());
    }
    setTimeLogSaving(false);
  }

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

      {/* Header row: back button + title edit button */}
      <div className="flex items-center justify-between mb-3.5">
        <button
          onClick={() => router.back()}
          className="text-[12.5px] text-txt-secondary hover:text-txt-primary"
        >
          ← กลับ
        </button>
        {canEdit && !editingTitle && (
          <button
            onClick={() => { setTitleDraft(task.title); setTitleError(''); setEditingTitle(true); }}
            className="text-[12px] text-txt-secondary hover:text-txt-primary flex items-center gap-1"
          >
            ✎ แก้ไขชื่องาน
          </button>
        )}
      </div>

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
          {/* Title — read or edit mode */}
          {editingTitle ? (
            <div className="mb-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  value={titleDraft}
                  onChange={e => { setTitleDraft(e.target.value); if (titleError) setTitleError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setEditingTitle(false); setTitleError(''); } }}
                  className="flex-1 text-xl font-semibold bg-surface-2 border border-accent text-txt-primary px-2.5 py-1 rounded-lg focus:outline-none"
                />
                <button
                  onClick={saveTitle}
                  disabled={titleSaving}
                  className="text-[12px] bg-accent text-white px-3 py-1.5 rounded-md disabled:opacity-50 whitespace-nowrap"
                >
                  {titleSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => { setEditingTitle(false); setTitleError(''); }}
                  className="text-[12px] text-txt-muted px-2 py-1.5 hover:text-txt-secondary"
                >
                  ยกเลิก
                </button>
              </div>
              {titleError && <p className="text-[11.5px] text-danger mt-1">{titleError}</p>}
            </div>
          ) : (
            <h1 className="text-xl font-semibold text-txt-primary mb-1.5">{task.title}</h1>
          )}

          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {task.squad && <span className="text-[11.5px] bg-surface-2 text-txt-secondary px-2.5 py-1 rounded-full">{task.squad.name}</span>}
            {task.laneName && <span className="text-[11.5px] bg-warning-bg text-warning px-2.5 py-1 rounded-full">{task.laneName}</span>}
            <span className="text-[11.5px] bg-surface-2 text-txt-secondary px-2.5 py-1 rounded-full">{task.source === 'IMPORTED' ? 'Imported' : 'Manual'}</span>
          </div>

          {/* Description */}
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[11px] uppercase tracking-wider text-txt-muted font-medium">รายละเอียด</p>
            {canEdit && !editingDesc && (
              <button
                onClick={() => { setDescDraft(task.description ?? ''); setEditingDesc(true); }}
                className="text-[11.5px] text-txt-secondary hover:text-txt-primary"
              >
                ✎ แก้ไข
              </button>
            )}
          </div>
          {editingDesc ? (
            <div>
              <textarea
                autoFocus
                rows={4}
                value={descDraft}
                onChange={e => setDescDraft(e.target.value)}
                placeholder="รายละเอียดงาน..."
                className="w-full bg-surface-2 border border-accent text-txt-primary text-[13.5px] px-2.5 py-2 rounded-lg focus:outline-none leading-relaxed resize-y"
              />
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={saveDesc}
                  disabled={descSaving}
                  className="bg-accent text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-50"
                >
                  {descSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button
                  onClick={() => setEditingDesc(false)}
                  className="text-txt-muted text-[12px] px-2 py-1.5 hover:text-txt-secondary"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[13.5px] text-txt-secondary leading-relaxed">
              {task.description
                ? task.description
                : <span className="text-txt-muted italic">
                    {canEdit
                      ? 'ยังไม่มีรายละเอียด — กด ✎ แก้ไข เพื่อเพิ่ม'
                      : 'ยังไม่มีรายละเอียด'}
                  </span>
              }
            </p>
          )}

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

          {/* Combined time history (TimeLogs + TaskLogs) */}
          {(task.timeLogs.length > 0 || task.taskLogs.length > 0) && (() => {
            type H = { key: string } & (
              | { kind: 'time'; log: TimeLog }
              | { kind: 'action'; log: TaskLogEntry }
            );
            const history: H[] = [
              ...task.timeLogs.map(l  => ({ kind: 'time'   as const, log: l,  key: l.startAt  })),
              ...task.taskLogs.map(l  => ({ kind: 'action' as const, log: l,  key: l.createdAt })),
            ].sort((a, b) => new Date(b.key).getTime() - new Date(a.key).getTime());

            return (
              <>
                <p className="text-[11px] uppercase tracking-wider text-txt-muted font-medium mt-5 mb-2">ประวัติเวลาที่ log</p>
                <div className="bg-surface-1 border border-app-border rounded-[10px] overflow-hidden">
                  {history.map((h, i) => {
                    if (h.kind === 'action') {
                      let detail: { deletedCount?: number; totalNormalMin?: number; totalOtMin?: number } = {};
                      try { detail = JSON.parse(h.log.detail ?? '{}'); } catch { /* empty */ }
                      const nFmt = fmt(detail.totalNormalMin ?? 0);
                      const oFmt = fmt(detail.totalOtMin ?? 0);
                      return (
                        <div key={h.log.id} className="flex items-start justify-between text-[12px] px-3.5 py-2.5 border-b border-app-border last:border-none bg-danger-bg/40">
                          <div>
                            <span className="text-danger font-medium">🗑 ล้างเวลาทั้งหมด</span>
                            <span className="text-txt-muted text-[11px] ml-2">โดย {h.log.userName}</span>
                            {(nFmt || oFmt) && (
                              <p className="text-[11px] text-txt-muted mt-0.5">
                                ลบ {nFmt ?? '0'}{oFmt ? ` + OT ${oFmt}` : ''} ({detail.deletedCount ?? 0} session)
                              </p>
                            )}
                          </div>
                          <span className="text-[11px] text-txt-muted whitespace-nowrap ml-3">{fmtDate(h.log.createdAt)}</span>
                        </div>
                      );
                    }
                    const l    = h.log as TimeLog;
                    const nFmt = fmt(l.normalMinutes);
                    const oFmt = fmt(l.otMinutes);
                    return (
                      <div key={i} className="flex items-center justify-between text-[12.5px] px-3.5 py-2.5 border-b border-app-border last:border-none">
                        <span className="text-txt-secondary">
                          {fmtDate(l.startAt)} – {l.endAt
                            ? fmtDate(l.endAt)
                            : <span className="text-accent font-mono text-[11px]">กำลังนับ {fmtElapsed(elapsed)}</span>}
                        </span>
                        <span className="text-txt-primary">
                          {l.endAt === '' ? <span className="text-accent text-[11px]">ยังไม่จบ</span> : (nFmt ?? '—')}
                          {oFmt && <span className="text-warning text-[11px] ml-1.5">+OT {oFmt}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
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

            {/* Auto timer */}
            {openSession ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between px-3 py-2 rounded-md border border-accent/50 bg-surface-2">
                  <span className="text-[12px] text-accent">⏱ กำลังจับเวลา</span>
                  <span className="text-[13px] font-mono text-txt-primary">{fmtElapsed(elapsed)}</span>
                </div>
                <button onClick={stopTimerFn} disabled={timerSaving}
                  className="w-full text-left text-[12.5px] px-3 py-2 rounded-md border border-danger/40 bg-surface-2 text-danger hover:bg-danger-bg transition-colors disabled:opacity-50">
                  {timerSaving ? 'กำลังหยุด...' : '⏹ หยุดจับเวลา'}
                </button>
              </div>
            ) : (
              <button onClick={startTimerFn} disabled={timerSaving}
                className="w-full text-left text-[12.5px] px-3 py-2 rounded-md border border-app-border bg-surface-2 hover:bg-[#2a2e3a] text-txt-primary transition-colors disabled:opacity-50">
                {timerSaving ? 'กำลังเริ่ม...' : '▶ เริ่มจับเวลา'}
              </button>
            )}

            {/* Manual time log */}
            {!timeLogOpen ? (
              <button onClick={() => { setTimeLogOpen(true); setTimeLogError(''); }}
                className="w-full text-left text-[12.5px] px-3 py-2 rounded-md border border-app-border bg-surface-2 hover:bg-[#2a2e3a] text-txt-primary transition-colors">
                ✎ บันทึกเวลา (manual)
              </button>
            ) : (
              <form onSubmit={submitTimeLog} className="flex flex-col gap-2">
                <p className="text-[12px] text-txt-secondary font-medium">บันทึกเวลาทำงาน</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] text-txt-muted mb-1">Normal (ชม.)</label>
                    <input
                      type="number" min="0.25" step="0.25" autoFocus
                      value={normalHours}
                      onChange={e => setNormalHours(e.target.value)}
                      placeholder="เช่น 2.5"
                      className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[11px] text-txt-muted mb-1">OT (ชม.) — ไม่บังคับ</label>
                    <input
                      type="number" min="0" step="0.25"
                      value={otHours}
                      onChange={e => setOtHours(e.target.value)}
                      placeholder="0"
                      className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                {timeLogError && <p className="text-[11.5px] text-danger">{timeLogError}</p>}
                <div className="flex gap-1.5">
                  <button type="submit" disabled={timeLogSaving || !normalHours}
                    className="bg-accent text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-50">
                    {timeLogSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                  </button>
                  <button type="button" onClick={() => { setTimeLogOpen(false); setTimeLogError(''); }}
                    className="text-txt-muted text-[12px] px-2 py-1.5 hover:text-txt-secondary">ยกเลิก</button>
                </div>
              </form>
            )}

            {/* Clear all time logs */}
            {task.timeLogs.length > 0 && (
              !clearConfirm ? (
                <button onClick={() => setClearConfirm(true)}
                  className="w-full text-left text-[12.5px] px-3 py-2 rounded-md border border-danger/30 bg-surface-2 text-danger/80 hover:text-danger hover:bg-danger-bg transition-colors">
                  🗑 ล้างเวลาทั้งหมด
                </button>
              ) : (
                <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-md border border-danger/40 bg-danger-bg">
                  <p className="text-[12px] text-danger font-medium">ยืนยันลบเวลาทั้งหมด?</p>
                  <p className="text-[11px] text-txt-muted">ไม่สามารถกู้คืนได้ แต่จะบันทึกลง Log</p>
                  <div className="flex gap-1.5">
                    <button onClick={clearAllTimeLogs} disabled={clearSaving}
                      className="bg-danger text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-50 hover:bg-danger/80 transition-colors">
                      {clearSaving ? 'กำลังลบ...' : 'ยืนยัน ลบทั้งหมด'}
                    </button>
                    <button onClick={() => setClearConfirm(false)}
                      className="text-txt-muted text-[12px] px-2 py-1.5 hover:text-txt-secondary">ยกเลิก</button>
                  </div>
                </div>
              )
            )}

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

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1e7d4a] text-white text-[13px] px-5 py-2.5 rounded-full shadow-lg pointer-events-none">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
