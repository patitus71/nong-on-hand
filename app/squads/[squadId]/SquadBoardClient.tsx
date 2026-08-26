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
  isAtRisk:           boolean;
  riskReason:         string;
};

type LaneData  = { name: string; tasks: TaskCard[] };
type Member    = { id: string; name: string; taskCount: number };
type SquadOpt  = { id: string; name: string };

type SprintInfo = {
  id:             string;
  name:           string;
  status:         'OPEN' | 'CLOSED';
  startedAt:      string;
  closedAt:       string | null;
  plannedEndDate: string | null;
};

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
  canManageSprint:   boolean;
  sprints:           SprintInfo[];
  activeSprintId:    string | null;
  hasOpenSprint:     boolean;
};

type ClaimTarget = { taskId: string; taskTitle: string };
type FlagTarget  = { taskId: string; taskTitle: string };

export default function SquadBoardClient({
  currentSquadId, currentSquadName, lanes, members, squads, userId, userName,
  canAssign, canApproveReview, canCreateTask, canManageSprint, sprints, activeSprintId, hasOpenSprint,
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

  // ── Sprint management ────────────────────────────────────────────────────────
  const activeSprint = sprints.find(s => s.id === activeSprintId) ?? null;
  const isReadonly   = activeSprint?.status === 'CLOSED';

  const [showOpenSprint,   setShowOpenSprint]   = useState(false);
  const [newSprintName,    setNewSprintName]    = useState('');
  const [newSprintEndDate, setNewSprintEndDate] = useState('');
  const [openingLoading,   setOpeningLoading]   = useState(false);
  const [openSprintError,  setOpenSprintError]  = useState('');

  const [showCloseSprint,   setShowCloseSprint]   = useState(false);
  const [closingLoading,    setClosingLoading]    = useState(false);
  const [closeSprintError,  setCloseSprintError]  = useState('');
  const [unfinishedCount,   setUnfinishedCount]   = useState<number | null>(null);

  async function submitOpenSprint() {
    setOpeningLoading(true);
    setOpenSprintError('');
    const name = newSprintName.trim() || `Sprint ${new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
    const res = await fetch(`/api/squads/${currentSquadId}/sprints`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, ...(newSprintEndDate ? { plannedEndDate: newSprintEndDate } : {}) }),
    });
    if (res.ok) {
      setShowOpenSprint(false);
      setNewSprintName('');
      router.refresh();
    } else {
      setOpenSprintError(await res.text());
    }
    setOpeningLoading(false);
  }

  async function submitCloseSprint(confirm = false) {
    if (!activeSprint) return;
    setClosingLoading(true);
    setCloseSprintError('');
    const res = await fetch(`/api/sprints/${activeSprint.id}/close`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ confirmClose: confirm }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCloseSprintError(data?.error ?? 'เกิดข้อผิดพลาด');
      setClosingLoading(false);
      return;
    }
    if (data.requiresConfirm) {
      setUnfinishedCount(data.unfinishedCount);
      setClosingLoading(false);
      return;
    }
    setShowCloseSprint(false);
    setUnfinishedCount(null);
    router.refresh();
    setClosingLoading(false);
  }

  // ── LINE send ────────────────────────────────────────────────────────────────
  const [lineLoading, setLineLoading] = useState<'standup' | 'eod' | null>(null);
  const [lineResult,  setLineResult]  = useState<string | null>(null);

  async function sendLine(type: 'standup' | 'eod') {
    setLineLoading(type);
    setLineResult(null);
    try {
      const res = await fetch(`/api/squads/${currentSquadId}/line-send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type }),
      });
      const data = await res.json();
      if (data.ok) {
        setLineResult(`✅ ส่ง${type === 'standup' ? 'Standup' : 'สรุปสิ้นวัน'}เข้า LINE สำเร็จ`);
      } else {
        setLineResult(`❌ ${data.reason ?? 'เกิดข้อผิดพลาด'}`);
      }
    } catch {
      setLineResult('❌ Network error');
    } finally {
      setLineLoading(null);
    }
  }

  // ── Sprint export (squad-level, only for closed sprints) ────────────────────
  const [showSprintExport,   setShowSprintExport]   = useState(false);
  const [sprintExportMd,     setSprintExportMd]     = useState('');
  const [sprintExportLoading, setSprintExportLoading] = useState(false);

  async function openSprintExport() {
    if (!activeSprint) return;
    setSprintExportMd('');
    setShowSprintExport(true);
    setSprintExportLoading(true);
    try {
      const res = await fetch('/api/reports/weekly', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          squadId:   currentSquadId,
          weekStart: activeSprint.startedAt,
          weekEnd:   activeSprint.closedAt ?? new Date().toISOString(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSprintExportMd(data.contentMarkdown ?? '');
      } else {
        setSprintExportMd('เกิดข้อผิดพลาดในการสร้างรายงาน');
      }
    } finally {
      setSprintExportLoading(false);
    }
  }

  function downloadSprintMd() {
    const blob = new Blob([sprintExportMd], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `sprint-report-${activeSprint?.name ?? 'sprint'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
    <div className="px-7 py-6 pb-16">

      {/* Page header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2.5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-[19px] font-semibold text-txt-primary">Squad Board</h1>
          <select
            className="bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-md focus:outline-none focus:border-accent"
            value={currentSquadId}
            onChange={e => router.push(`/squads/${e.target.value}`)}
          >
            {squads.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Sprint selector */}
          {sprints.length > 0 ? (
            <select
              className="bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-md focus:outline-none focus:border-accent"
              value={activeSprintId ?? ''}
              onChange={e => router.push(`/squads/${currentSquadId}?sprint=${e.target.value}`)}
            >
              {sprints.map(s => (
                <option key={s.id} value={s.id}>
                  {s.status === 'OPEN' ? '🟢 ' : '🔴 '}{s.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[12px] text-txt-muted bg-surface-1 border border-app-border px-2.5 py-[7px] rounded-md">
              ยังไม่มี Sprint
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Sprint management buttons */}
          {canManageSprint && activeSprint?.status === 'OPEN' && (
            <button
              onClick={() => { setShowCloseSprint(true); setCloseSprintError(''); setUnfinishedCount(null); }}
              className="bg-surface-2 border border-danger/40 text-danger text-[13px] px-3 py-[7px] rounded-md flex items-center gap-1.5 hover:bg-danger-bg transition-colors"
            >
              🔴 ปิด Sprint
            </button>
          )}
          {canManageSprint && !sprints.some(s => s.status === 'OPEN') && (
            <button
              onClick={() => { setShowOpenSprint(true); setNewSprintName(''); setNewSprintEndDate(''); setOpenSprintError(''); }}
              className="bg-surface-2 border border-success/40 text-success text-[13px] px-3 py-[7px] rounded-md flex items-center gap-1.5 hover:bg-success-bg transition-colors"
            >
              🟢 เปิด Sprint ใหม่
            </button>
          )}

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
          {isReadonly && activeSprint && (
            <button
              onClick={openSprintExport}
              className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-md flex items-center gap-1.5 hover:bg-[#2a2e3a] transition-colors"
            >
              📄 Export Sprint
            </button>
          )}
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

      {/* Readonly banner for closed sprint */}
      {isReadonly && (
        <div className="flex items-center gap-2 bg-surface-1 border border-app-border rounded-lg px-4 py-2.5 mb-4 text-[12.5px] text-txt-secondary">
          <span className="text-lg">🔒</span>
          <span>
            Sprint นี้ปิดแล้ว ({activeSprint?.closedAt ? new Date(activeSprint.closedAt).toLocaleDateString('th-TH') : ''}) — ดูข้อมูลได้อย่างเดียว
          </span>
          {canManageSprint && !sprints.some(s => s.status === 'OPEN') && (
            <button
              onClick={() => { setShowOpenSprint(true); setNewSprintName(''); setNewSprintEndDate(''); setOpenSprintError(''); }}
              className="ml-auto bg-success-bg border border-success/40 text-success text-[12px] px-3 py-1 rounded-md hover:bg-success/15 transition-colors"
            >
              🟢 เปิด Sprint ใหม่
            </button>
          )}
        </div>
      )}

      {/* Board */}
      <div
        className={`grid gap-3.5 pb-5 ${isReadonly ? 'opacity-70 pointer-events-none select-none' : ''}`}
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
      >
        {visibleLanes.map(lane => (
          <div
            key={lane.name}
            className="bg-surface-1 border border-app-border rounded-[12px] p-2.5 flex flex-col"
            style={{ height: 'calc(100vh - 240px)' }}
          >
            {/* Lane header */}
            <div className="flex items-center gap-1.5 px-1 pb-2.5 flex-shrink-0">
              <span className={`text-[13px] font-semibold ${
                lane.name === 'มีปัญหา'             ? 'text-danger'   :
                lane.name === 'Done'                 ? 'text-success'  :
                lane.name === 'Wait for review'      ? 'text-warning'  :
                lane.name === 'On-Board In Progress' ? 'text-accent'   :
                'text-txt-primary'
              }`}>
                {lane.name}
              </span>
              <span className="text-[11px] text-txt-muted bg-surface-2 px-2 py-0.5 rounded-full">
                {lane.tasks.length}
              </span>
            </div>

            {/* Scrollable cards area */}
            <div className="flex-1 overflow-y-auto min-h-0">
            {lane.tasks.length === 0 && (
              <div className="text-center text-[12px] text-txt-muted py-6 px-2">
                {lane.name === 'To do list' ? 'ดึงงานเข้าบอร์ดเพื่อเริ่มต้น' : 'ว่างอยู่'}
              </div>
            )}

            {lane.tasks.map(t => {
              const av        = t.assignee ? avatarColor(t.assignee.name) : null;
              const normalFmt = fmt(t.totalNormalMin);
              const otFmt     = fmt(t.totalOtMin);
              const menuOpen  = openMenuId === t.id;
              const isApproving = approvingId === t.id;

              return (
                <div key={t.id} className={`relative mb-2 last:mb-0 ${t.isAtRisk ? 'card-at-risk' : ''}`}>
                  {t.isAtRisk && (
                    <span
                      className="absolute top-1.5 right-2 text-[13px] leading-none z-10 pointer-events-none"
                      title={t.riskReason}
                    >🔥</span>
                  )}
                  <div className={`bg-surface-2 border rounded-lg p-2.5 ${
                    t.hasIssue ? 'border-danger/40' : t.flaggedForDeletion ? 'border-danger/30' : t.isAtRisk ? 'border-warning/40' : 'border-app-border'
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

                    {/* On-Board / On-Board In Progress: show personal lane */}
                    {(lane.name === 'On-Board' || lane.name === 'On-Board In Progress') && t.laneName && t.assignee && (
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

            {lane.name === 'To do list' && canCreateTask && hasOpenSprint && (
              <div className="mt-2 mb-1">
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
            </div>{/* end scrollable cards area */}
          </div>
        ))}
      </div>

      {/* ── LINE send buttons ── */}
      {canManageSprint && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={() => sendLine('standup')}
            disabled={lineLoading !== null}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-lg hover:border-accent hover:bg-surface-1 transition-colors disabled:opacity-50"
          >
            {lineLoading === 'standup' ? 'กำลังส่ง...' : '📤 ส่ง Standup เช้านี้'}
          </button>
          <button
            onClick={() => sendLine('eod')}
            disabled={lineLoading !== null}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-lg hover:border-accent hover:bg-surface-1 transition-colors disabled:opacity-50"
          >
            {lineLoading === 'eod' ? 'กำลังส่ง...' : '📤 ส่งสรุปสิ้นวัน'}
          </button>
          {lineResult && (
            <span className="text-[12.5px] text-txt-secondary">{lineResult}</span>
          )}
        </div>
      )}

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

      {/* ── Sprint export modal ── */}
      {showSprintExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[620px] max-h-[85vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-semibold text-txt-primary">📄 Sprint Report — {activeSprint?.name}</h3>
              <button onClick={() => setShowSprintExport(false)}
                className="text-txt-muted hover:text-txt-secondary text-[18px] leading-none px-1">✕</button>
            </div>
            {sprintExportLoading ? (
              <div className="flex-1 flex items-center justify-center py-12 text-txt-muted text-[13px]">
                กำลังสร้างรายงาน...
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto bg-surface-2 border border-app-border rounded-lg p-3 mb-4 min-h-0">
                  <pre className="text-[12.5px] text-txt-secondary whitespace-pre-wrap font-mono leading-relaxed">{sprintExportMd}</pre>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={downloadSprintMd}
                    className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors">
                    ↓ Download .md
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Open Sprint modal ── */}
      {showOpenSprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="bg-surface-1 border border-app-border rounded-xl w-full max-w-[400px] shadow-2xl p-5">
            <h2 className="text-[15px] font-semibold text-success mb-1">🟢 เปิด Sprint ใหม่</h2>
            <p className="text-[12.5px] text-txt-secondary mb-4 leading-relaxed">
              Squad <b>{currentSquadName}</b> จะเริ่ม Sprint ใหม่ทันที — สามารถดึงงานเข้า Sprint นี้ได้ที่หน้างานทั้งหมด
            </p>
            <label className="block text-[12px] text-txt-secondary mb-1.5">ชื่อ Sprint</label>
            <input
              autoFocus
              value={newSprintName}
              onChange={e => setNewSprintName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitOpenSprint()}
              placeholder={`Sprint ${new Date().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' })}`}
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-md focus:outline-none focus:border-accent mb-3 font-[inherit]"
            />
            <label className="block text-[12px] text-txt-secondary mb-1.5">วันปิด Sprint <span className="text-txt-muted">(ไม่บังคับ — ใช้แจ้งเตือนงานเสี่ยง)</span></label>
            <input
              type="date"
              value={newSprintEndDate}
              onChange={e => setNewSprintEndDate(e.target.value)}
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-md focus:outline-none focus:border-accent mb-3 font-[inherit]"
            />
            {openSprintError && <p className="text-[12px] text-danger mb-3">{openSprintError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowOpenSprint(false)}
                disabled={openingLoading}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-md hover:bg-[#2a2e3a] transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitOpenSprint}
                disabled={openingLoading}
                className={`bg-success border border-success text-white text-[13px] px-4 py-2 rounded-md font-medium hover:opacity-90 transition-colors disabled:opacity-50 ${openingLoading ? 'btn-loading' : ''}`}
              >
                เปิด Sprint
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Close Sprint modal ── */}
      {showCloseSprint && activeSprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="bg-surface-1 border border-app-border rounded-xl w-full max-w-[440px] shadow-2xl p-5">
            <h2 className="text-[15px] font-semibold text-danger mb-1">🔴 ปิด Sprint</h2>
            <p className="text-[12.5px] text-txt-secondary mb-4 leading-relaxed">
              ยืนยันการปิด <b>{activeSprint.name}</b> — หลังปิดแล้วบอร์ดจะเป็น read-only และเปิด Sprint ใหม่ได้
            </p>

            {unfinishedCount !== null && unfinishedCount > 0 && (
              <div className="bg-warning-bg border border-warning/30 rounded-lg px-3 py-2.5 mb-4">
                <p className="text-[12.5px] text-warning font-medium">
                  ⚠ ยังมีงานที่ยังไม่เสร็จ {unfinishedCount} งาน
                </p>
                <p className="text-[11.5px] text-txt-secondary mt-1">
                  งานเหล่านี้จะยังอยู่ใน Sprint นี้ (read-only) ไม่ถูก carry over อัตโนมัติ
                </p>
              </div>
            )}

            {closeSprintError && <p className="text-[12px] text-danger mb-3">{closeSprintError}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCloseSprint(false); setUnfinishedCount(null); }}
                disabled={closingLoading}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-md hover:bg-[#2a2e3a] transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => submitCloseSprint(unfinishedCount !== null)}
                disabled={closingLoading}
                className={`bg-danger border border-danger text-white text-[13px] px-4 py-2 rounded-md font-medium hover:bg-[#d94848] transition-colors disabled:opacity-50 ${closingLoading ? 'btn-loading' : ''}`}
              >
                {unfinishedCount !== null ? 'ยืนยันปิด (มีงานค้าง)' : 'ปิด Sprint'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
