'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmt, initials, avatarColor } from '@/lib/ui';

type TaskCard = {
  id:                 string;
  title:              string;
  hasIssue:           boolean;
  flaggedForDeletion: boolean;
  deletionFlagNote:   string | null;
  assignee:           { id: string; name: string } | null;
  laneName:           string | null;
  reviewApprovedAt:   string | null;
  totalNormalMin:     number;
  totalOtMin:         number;
};

type LaneData  = { name: string; tasks: TaskCard[] };
type Member    = { id: string; name: string; taskCount: number };
type SquadOpt  = { id: string; name: string };

type Props = {
  currentSquadId:    string;
  currentSquadName:  string;
  lanes:             LaneData[];
  members:           Member[];
  squads:            SquadOpt[];
  userId:            string;
  userName:          string;
  canAssign:         boolean;
  canApproveReview:  boolean;
  canCreateTask:     boolean;
};

type ClaimTarget = { taskId: string; taskTitle: string };
type FlagTarget  = { taskId: string; taskTitle: string };

export default function SquadBoardClient({
  currentSquadId, currentSquadName, lanes, members, squads, userId, userName, canAssign, canApproveReview, canCreateTask,
}: Props) {
  const router = useRouter();

  // ── Auto-refresh every 30 s so changes by other users (QA Engineer moving cards)
  // become visible without a manual reload ────────────────────────────────────────
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const refreshingRef = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      router.refresh();
      setLastRefreshed(new Date());
      refreshingRef.current = false;
    }, 30_000);
    return () => clearInterval(tick);
  }, [router]);

  function manualRefresh() {
    router.refresh();
    setLastRefreshed(new Date());
  }

  const [activeMember, setActiveMember] = useState<string | null>(null);

  // ── Personal export ──────────────────────────────────────────────────────────
  const [showExport,    setShowExport]    = useState(false);
  const [exportStart,   setExportStart]   = useState('');
  const [exportEnd,     setExportEnd]     = useState('');
  const [exportMd,      setExportMd]      = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  function openExport() {
    const today = new Date();
    const day   = today.getDay();
    const mon   = new Date(today);
    mon.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const toISO = (d: Date) => d.toISOString().slice(0, 10);
    setExportStart(toISO(mon));
    setExportEnd(toISO(sun));
    setExportMd('');
    setShowExport(true);
  }

  async function fetchExport() {
    if (!exportStart || !exportEnd) return;
    setExportLoading(true);
    const res = await fetch(`/api/reports/personal?weekStart=${exportStart}&weekEnd=${exportEnd}`);
    if (res.ok) setExportMd(await res.text());
    setExportLoading(false);
  }

  function downloadMd() {
    const blob = new Blob([exportMd], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `personal-report-${exportStart}.md`; a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<html><head><title>Personal Report</title>
      <style>body{font-family:sans-serif;padding:2rem;max-width:800px;margin:auto}
      pre{white-space:pre-wrap;font-family:inherit;line-height:1.6;font-size:14px}</style>
      </head><body><pre>${exportMd.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`);
    win.document.close(); win.print();
  }

  const visibleLanes = lanes.map(lane => ({
    ...lane,
    tasks: activeMember
      ? lane.tasks.filter(t => t.assignee?.id === activeMember)
      : lane.tasks,
  }));

  // ── Card ⋯ menu ──────────────────────────────────────────────────────────────
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const closeAllMenus = useCallback(() => setOpenMenuId(null), []);
  useEffect(() => {
    document.addEventListener('click', closeAllMenus);
    return () => document.removeEventListener('click', closeAllMenus);
  }, [closeAllMenus]);

  // ── Claim (assign) ───────────────────────────────────────────────────────────
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [assigneeId,  setAssigneeId]  = useState(userId);
  const [claiming,    setClaiming]    = useState(false);
  const [claimError,  setClaimError]  = useState('');

  function openClaim(task: TaskCard) {
    setClaimTarget({ taskId: task.id, taskTitle: task.title });
    setAssigneeId(task.assignee?.id ?? userId);
    setClaimError('');
  }

  async function submitClaim() {
    if (!claimTarget) return;
    setClaiming(true);
    setClaimError('');
    try {
      const res = await fetch(`/api/tasks/${claimTarget.taskId}/claim`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assigneeId }),
      });
      if (!res.ok) { setClaimError(await res.text() || 'เกิดข้อผิดพลาด'); return; }
      setClaimTarget(null);
      router.refresh();
    } finally {
      setClaiming(false);
    }
  }

  // ── Flag for deletion ─────────────────────────────────────────────────────────
  const [flagTarget, setFlagTarget] = useState<FlagTarget | null>(null);
  const [flagNote,   setFlagNote]   = useState('');
  const [flagging,   setFlagging]   = useState(false);
  const [flagError,  setFlagError]  = useState('');

  function openFlagModal(task: TaskCard) {
    setFlagTarget({ taskId: task.id, taskTitle: task.title });
    setFlagNote('');
    setFlagError('');
    setOpenMenuId(null);
  }

  async function submitFlag() {
    if (!flagTarget) return;
    if (!flagNote.trim()) { setFlagError('กรุณาอธิบายเหตุผลก่อนยืนยัน — ต้องมีเหตุผลเสมอ'); return; }
    setFlagging(true);
    setFlagError('');
    try {
      const res = await fetch(`/api/tasks/${flagTarget.taskId}/flag-delete`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ flaggedForDeletion: true, deletionFlagNote: flagNote.trim() }),
      });
      if (!res.ok) { setFlagError(await res.text()); return; }
      setFlagTarget(null);
      router.refresh();
    } finally {
      setFlagging(false);
    }
  }

  async function submitUnflag(taskId: string) {
    setOpenMenuId(null);
    const res = await fetch(`/api/tasks/${taskId}/flag-delete`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ flaggedForDeletion: false }),
    });
    if (res.ok) router.refresh();
  }

  // ── Create task (inline, To do column) ─────────────────────────────────────
  const [showCreate,   setShowCreate]   = useState(false);
  const [createTitle,  setCreateTitle]  = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createTitle.trim()) return;
    setCreateLoading(true);
    const res = await fetch('/api/tasks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title: createTitle.trim(), squadId: currentSquadId, assigneeId: null }),
    });
    if (res.ok) {
      setCreateTitle('');
      setShowCreate(false);
      router.refresh();
    }
    setCreateLoading(false);
  }

  // ── Approve review ───────────────────────────────────────────────────────────
  const [approvingId, setApprovingId] = useState<string | null>(null);

  async function approveReview(taskId: string) {
    setApprovingId(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve-review`, { method: 'PATCH' });
      if (!res.ok) { alert(await res.text()); return; }
      router.refresh();
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-7 py-6 pb-16">

      {/* Page header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[19px] font-semibold text-txt-primary">Squad Board</h1>
          <select
            className="bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-md focus:outline-none focus:border-accent"
            value={currentSquadId}
            onChange={e => router.push(`/squads/${e.target.value}`)}
          >
            {squads.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={manualRefresh}
            title="อัปเดตข้อมูลล่าสุด"
            className="bg-surface-2 border border-app-border text-txt-muted text-[13px] px-2.5 py-[7px] rounded-md flex items-center gap-1.5 hover:bg-[#2a2e3a] hover:text-txt-primary transition-colors"
          >
            ↻
            <span className="text-[11px]">
              {lastRefreshed.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </button>
          <button
            onClick={openExport}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-md flex items-center gap-1.5 hover:bg-[#2a2e3a] transition-colors"
          >
            ↓ Export Report
          </button>
        </div>
      </div>

      {/* Member strip */}
      {members.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {members.map(m => {
            const av = avatarColor(m.name);
            const isActive = activeMember === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setActiveMember(isActive ? null : m.id)}
                className={`flex items-center gap-1.5 border rounded-full px-3 py-1 pr-3 text-[12.5px] transition-colors ${
                  isActive ? 'border-accent bg-accent-bg' : 'border-app-border bg-surface-1 hover:border-txt-muted'
                }`}
              >
                <div className="w-5 h-5 rounded-full text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0"
                  style={{ background: av.bg, color: av.fg }}>
                  {initials(m.name)}
                </div>
                <span className="text-txt-primary">{m.name}</span>
                <span className="text-txt-muted text-[10.5px] ml-0.5">{m.taskCount} งาน</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Board */}
      <div className="flex gap-3.5 overflow-x-auto pb-5">
        {visibleLanes.map(lane => (
          <div
            key={lane.name}
            className="bg-surface-1 border border-app-border rounded-[12px] w-[260px] flex-shrink-0 p-2.5"
          >
            {/* Lane header */}
            <div className="flex items-center gap-1.5 px-1 pb-2.5">
              <span className={`text-[13px] font-semibold ${
                lane.name === 'มีปัญหา'        ? 'text-danger'   :
                lane.name === 'Done'            ? 'text-success'  :
                lane.name === 'Wait for review' ? 'text-warning'  :
                'text-txt-primary'
              }`}>
                {lane.name}
              </span>
              <span className="text-[11px] text-txt-muted bg-surface-2 px-2 py-0.5 rounded-full">
                {lane.tasks.length}
              </span>
            </div>

            {lane.tasks.length === 0 && (
              <div className="text-center text-[12px] text-txt-muted py-6 px-2">
                {lane.name === 'To do' ? 'ดึงงานเข้าบอร์ดเพื่อเริ่มต้น' : 'ว่างอยู่'}
              </div>
            )}

            {lane.tasks.map(t => {
              const av        = t.assignee ? avatarColor(t.assignee.name) : null;
              const normalFmt = fmt(t.totalNormalMin);
              const otFmt     = fmt(t.totalOtMin);
              const menuOpen  = openMenuId === t.id;
              const isApproving = approvingId === t.id;

              return (
                <div key={t.id} className="relative mb-2 last:mb-0">
                  <div className={`bg-surface-2 border rounded-lg p-2.5 ${
                    t.hasIssue ? 'border-danger/40' : t.flaggedForDeletion ? 'border-danger/30' : 'border-app-border'
                  }`}>

                    {/* Title row */}
                    <div className="flex items-start gap-1 mb-2">
                      <Link
                        href={`/tasks/${t.id}`}
                        className="flex-1 text-[13px] text-txt-primary flex items-start gap-1.5 hover:text-accent transition-colors"
                      >
                        {t.hasIssue && <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 mt-[5px]" />}
                        {t.reviewApprovedAt && lane.name === 'Wait for review' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0 mt-[5px]" title="Review ผ่านแล้ว" />
                        )}
                        {t.title}
                      </Link>

                      {/* ⋯ menu button — ADMIN/QA_LEAD เท่านั้น */}
                      {canAssign && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            e.nativeEvent.stopImmediatePropagation();
                            setOpenMenuId(menuOpen ? null : t.id);
                          }}
                          className="text-txt-muted hover:text-txt-primary text-[14px] leading-none px-1 py-0.5 rounded hover:bg-surface-0 flex-shrink-0"
                        >
                          ⋯
                        </button>
                      )}
                    </div>

                    {/* Flagged badge */}
                    {t.flaggedForDeletion && (
                      <div className="mb-2">
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-danger-bg text-danger font-semibold">
                          🚩 Flag ให้ลบ{t.deletionFlagNote ? ` — "${t.deletionFlagNote}"` : ''}
                        </span>
                      </div>
                    )}

                    {/* On-Board: show personal lane */}
                    {lane.name === 'On-Board' && t.laneName && t.assignee && (
                      <p className="text-[10.5px] text-txt-muted mt-1 mb-1.5">
                        อยู่เลน &ldquo;{t.laneName}&rdquo; ในบอร์ดของ {t.assignee.name}
                      </p>
                    )}

                    {/* Bottom row: assignee + time */}
                    <div className="flex items-center justify-between">
                      {av && t.assignee ? (
                        <div
                          className="w-5 h-5 rounded-full text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0"
                          style={{ background: av.bg, color: av.fg }}
                          title={t.assignee.name}
                        >
                          {initials(t.assignee.name)}
                        </div>
                      ) : <span />}
                      {(normalFmt || otFmt) && (
                        <span className={`text-[11px] ${otFmt ? 'text-warning' : 'text-txt-secondary'}`}>
                          {normalFmt && <>รวม {normalFmt}</>}
                          {otFmt     && <> · OT {otFmt}</>}
                        </span>
                      )}
                    </div>

                    {/* Approve review button — Wait for review column only */}
                    {lane.name === 'Wait for review' && canApproveReview && !t.reviewApprovedAt && (
                      <button
                        onClick={() => approveReview(t.id)}
                        disabled={isApproving}
                        className={`mt-2 w-full text-[11.5px] px-2 py-1.5 rounded-md bg-success-bg border border-success/30 text-success hover:bg-success/15 transition-colors disabled:opacity-50 font-medium ${isApproving ? 'btn-loading' : ''}`}
                      >
                        ✓ Review ผ่าน
                      </button>
                    )}

                    {/* Already approved indicator */}
                    {lane.name === 'Wait for review' && t.reviewApprovedAt && (
                      <div className="mt-2 text-[10.5px] text-success text-center py-1 bg-success-bg rounded-md">
                        ✓ Review ผ่านแล้ว — รอ QA_ENGINEER ย้ายไป Done
                      </div>
                    )}

                    {/* Claim button */}
                    {canAssign && members.length > 0 && (
                      <button
                        onClick={() => openClaim(t)}
                        className="mt-2 w-full text-[11.5px] px-2 py-1 rounded-md border border-app-border text-txt-muted hover:border-accent hover:text-accent transition-colors"
                      >
                        + เพิ่มเข้าบอร์ดของฉัน
                      </button>
                    )}
                  </div>

                  {/* Card ⋯ dropdown */}
                  {canAssign && menuOpen && (
                    <div
                      className="absolute right-0 top-8 bg-surface-2 border border-app-border rounded-lg py-1 min-w-[190px] z-20 shadow-lg"
                      onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                    >
                      {!t.flaggedForDeletion ? (
                        <button
                          onClick={() => openFlagModal(t)}
                          className="w-full text-left text-[12px] px-3 py-2 rounded-md hover:bg-danger-bg text-danger transition-colors"
                        >
                          🚩 Flag ให้ลบ
                        </button>
                      ) : (
                        <button
                          onClick={() => submitUnflag(t.id)}
                          className="w-full text-left text-[12px] px-3 py-2 rounded-md hover:bg-surface-0 text-txt-secondary transition-colors"
                        >
                          ↩ ยกเลิก flag (เก็บงานนี้ไว้)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {lane.name === 'To do' && canCreateTask && (
              <div className="mt-2">
                {showCreate ? (
                  <form onSubmit={submitCreate} className="flex flex-col gap-1.5">
                    <input
                      autoFocus
                      value={createTitle}
                      onChange={e => setCreateTitle(e.target.value)}
                      placeholder="ชื่องาน..."
                      className="w-full bg-surface-2 border border-accent text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-md focus:outline-none font-[inherit]"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="submit"
                        disabled={createLoading || !createTitle.trim()}
                        className={`flex-1 bg-accent hover:bg-accent-hover text-white text-[12.5px] py-1.5 rounded-md font-medium disabled:opacity-50 transition-colors ${createLoading ? 'btn-loading' : ''}`}
                      >
                        เพิ่ม
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowCreate(false); setCreateTitle(''); }}
                        disabled={createLoading}
                        className="px-3 py-1.5 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-md transition-colors"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="w-full text-[12px] text-txt-muted hover:text-txt-primary border border-dashed border-app-border rounded-lg py-2 transition-colors hover:border-accent hover:bg-surface-2"
                  >
                    + เพิ่มงานใหม่
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Flag modal ── */}
      {flagTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="bg-surface-1 border border-app-border rounded-xl w-full max-w-[400px] shadow-2xl p-5">
            <h2 className="text-[15px] font-semibold text-danger mb-1">🚩 Flag งานนี้ให้ลบ</h2>
            <p className="text-[12.5px] text-txt-secondary mb-3 leading-relaxed">
              ยืนยันการ flag &ldquo;{flagTarget.taskTitle}&rdquo;
            </p>

            <label className="block text-[12px] text-txt-secondary mb-1.5">เหตุผล (จำเป็นต้องกรอก)</label>
            <textarea
              value={flagNote}
              onChange={e => { setFlagNote(e.target.value); setFlagError(''); }}
              placeholder="เช่น ticket นี้ดูเหมือนสร้างซ้ำจากอีกอัน หรือไม่เกี่ยวกับ sprint นี้เลย"
              rows={3}
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-lg font-[inherit] resize-y focus:outline-none focus:border-accent"
            />
            {flagError && <p className="text-[11.5px] text-danger mt-1.5">{flagError}</p>}
            <p className="text-[11px] text-txt-muted mt-2 leading-relaxed">
              Flag แล้วงานนี้จะขึ้น badge 🚩 ทุกที่ที่โผล่ และ ADMIN/QA_LEAD/QA_MANAGER จะลบจริงได้ที่หน้า &ldquo;งานทั้งหมด&rdquo;
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setFlagTarget(null)}
                disabled={flagging}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-md hover:bg-[#2a2e3a] transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitFlag}
                disabled={flagging}
                className={`bg-danger border border-danger text-white text-[13px] px-4 py-2 rounded-md font-medium hover:bg-[#d94848] transition-colors disabled:opacity-50 ${flagging ? 'btn-loading' : ''}`}
              >
                ยืนยัน Flag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export modal ── */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[600px] max-h-[85vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-txt-primary">Export รายงานส่วนตัว — {userName}</h3>
              <button onClick={() => setShowExport(false)}
                className="text-txt-muted hover:text-txt-secondary text-[18px] leading-none px-1">✕</button>
            </div>
            <div className="flex items-end gap-3 mb-4">
              <div>
                <label className="block text-[12px] text-txt-secondary mb-1">ตั้งแต่วันที่</label>
                <input type="date" value={exportStart}
                  onChange={e => { setExportStart(e.target.value); setExportMd(''); }}
                  className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-[12px] text-txt-secondary mb-1">ถึงวันที่</label>
                <input type="date" value={exportEnd}
                  onChange={e => { setExportEnd(e.target.value); setExportMd(''); }}
                  className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-accent" />
              </div>
              <button onClick={fetchExport}
                disabled={exportLoading || !exportStart || !exportEnd}
                className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-[7px] rounded-lg disabled:opacity-50 transition-colors">
                {exportLoading ? 'กำลังสร้าง...' : 'สร้าง Report'}
              </button>
            </div>
            {exportMd && (
              <>
                <div className="flex-1 overflow-y-auto bg-surface-2 border border-app-border rounded-lg p-3 mb-4 min-h-0">
                  <pre className="text-[12.5px] text-txt-secondary whitespace-pre-wrap font-mono leading-relaxed">{exportMd}</pre>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={printPdf}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-lg hover:bg-[#2a2e3a] transition-colors">
                    Print / PDF
                  </button>
                  <button onClick={downloadMd}
                    className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors">
                    ↓ Download .md
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Claim dialog ── */}
      {claimTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[340px] shadow-xl">
            <h2 className="text-[15px] font-semibold text-txt-primary mb-1">เพิ่มเข้าบอร์ดของฉัน</h2>
            <p className="text-[12px] text-txt-muted mb-4 leading-relaxed">
              งานจะเข้าเลน <span className="text-accent font-medium">To do</span> ในบอร์ดของผู้รับผิดชอบ
              — ให้ผู้รับผิดชอบเลื่อนไป In Progress เองเมื่อพร้อมทำ
            </p>
            <p className="text-[12px] text-txt-secondary mb-1 font-medium truncate" title={claimTarget.taskTitle}>
              {claimTarget.taskTitle}
            </p>

            <label className="block text-[12px] text-txt-muted mt-3 mb-1">ผู้รับผิดชอบ</label>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-md focus:outline-none focus:border-accent"
            >
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.id === userId ? ' (ฉัน)' : ''}
                </option>
              ))}
            </select>

            {claimError && <p className="text-[12px] text-danger mt-2">{claimError}</p>}

            <div className="flex gap-2 mt-4">
              <button
                onClick={submitClaim}
                disabled={claiming}
                className={`flex-1 bg-accent hover:bg-accent-hover text-white text-[13px] py-2 rounded-md font-medium disabled:opacity-50 transition-colors ${claiming ? 'btn-loading' : ''}`}
              >
                ยืนยัน
              </button>
              <button
                onClick={() => setClaimTarget(null)}
                disabled={claiming}
                className="px-4 py-2 text-[13px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-md transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
