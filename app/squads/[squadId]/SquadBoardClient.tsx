'use client';

import { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmtHM, burnColorCls, initials, avatarColor } from '@/lib/ui';

type TaskCard = {
  id:                 string;
  title:              string;
  hasIssue:           boolean;
  flaggedForDeletion: boolean;
  deletionFlagNote:   string | null;
  assignee:           { id: string; name: string } | null;
  laneName:           string | null;
  taskPoint:          number | null;
  estimatedHours:     number | null;
  reviewApprovedAt:   string | null;
  isCancelled:        boolean;
  cancelNote:         string | null;
  cancelledByName:    string | null;
  totalNormalMin:     number;
  totalOtMin:         number;
  isAtRisk:           boolean;
  riskReason:         string;
};

type LaneData  = { name: string; tasks: TaskCard[] };
type Member    = { id: string; name: string; taskCount: number; external?: boolean };
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
  capacityHours:     number;
};

type ClaimTarget = { taskId: string; taskTitle: string; taskPoint: number | null; estimatedHours: number | null; currentAssigneeId: string | null };
type FlagTarget  = { taskId: string; taskTitle: string };

export default function SquadBoardClient({
  currentSquadId, currentSquadName, lanes, members, squads, userId, userName,
  canAssign, canApproveReview, canCreateTask, canManageSprint, sprints, activeSprintId, hasOpenSprint,
  capacityHours,
}: Props) {
  const router = useRouter();
  const [sprintNavPending, startSprintNav] = useTransition();

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
      const data = await res.json();
      setShowOpenSprint(false);
      setNewSprintName('');
      if (data.carriedCount > 0) {
        alert(`เปิด Sprint ใหม่แล้ว — ดึงงานค้าง ${data.carriedCount} งานจาก sprint เก่าเข้ามาด้วย`);
      }
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
    if (data.carriedCount > 0) {
      alert(`ปิด Sprint แล้ว — เปิด "${data.newSprint.name}" ต่อทันที และดึงงานค้าง ${data.carriedCount} งาน (รวมงานกองกลาง) เข้ามาด้วย`);
    }
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

  const laneByName = new Map(lanes.map(l => [l.name, l.tasks]));
  const poolTasks  = laneByName.get('To do list') ?? [];

  // นับเฉพาะการ์ดที่ตั้ง point แล้ว และไม่นับการ์ดที่ยกเลิก (Board Point Capacity spec)
  function laneSubtotal(cardTasks: TaskCard[]) {
    return cardTasks.reduce(
      (acc, t) => t.isCancelled ? acc : { hours: acc.hours + (t.estimatedHours ?? 0), points: acc.points + (t.taskPoint ?? 0) },
      { hours: 0, points: 0 }
    );
  }

  const STATUS_COLS: { key: string; label: string; glyph: string; color: string }[] = [
    { key: 'On-Board',              label: 'ยังไม่เริ่ม', glyph: '○', color: 'text-txt-secondary' },
    { key: 'On-Board In Progress',  label: 'กำลังทำ',    glyph: '◐', color: 'text-accent' },
    { key: 'Wait for review',       label: 'รอ review',   glyph: '◆', color: 'text-warning' },
    { key: 'Done',                  label: 'Done',        glyph: '✓', color: 'text-success' },
    { key: 'มีปัญหา',              label: 'มีปัญหา',     glyph: '▲', color: 'text-danger' },
  ];
  /* Left-accent card stripe per status — same scheme as STATUS_COLS' text colors above. */
  const STATUS_ACCENT: Record<string, string> = {
    'On-Board': 'rgb(var(--text-muted))', 'On-Board In Progress': 'rgb(var(--accent))',
    'Wait for review': 'rgb(var(--warning))', 'Done': 'rgb(var(--success))',
    'มีปัญหา': 'rgb(var(--danger))', 'To do list': 'rgb(var(--text-muted))',
  };

  // ── Card ⋯ menu ──────────────────────────────────────────────────────────────
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const closeAllMenus = useCallback(() => setOpenMenuId(null), []);
  useEffect(() => {
    document.addEventListener('click', closeAllMenus);
    return () => document.removeEventListener('click', closeAllMenus);
  }, [closeAllMenus]);

  // ── Member load (Board Point Capacity) — สรุปโหลดรายคนจากงานทั้งหมดบนบอร์ดนี้ ──
  // (ทุกเลนรวม Done, ไม่นับการ์ดที่ยกเลิก) ใช้ทั้งแผงโหลดรวม squad และเช็คก่อน assign
  const allBoardTasks = lanes.flatMap(l => l.tasks);
  const memberLoads = new Map<string, { hours: number; points: number; count: number }>();
  for (const t of allBoardTasks) {
    if (t.isCancelled || !t.assignee) continue;
    const cur = memberLoads.get(t.assignee.id) ?? { hours: 0, points: 0, count: 0 };
    cur.hours += t.estimatedHours ?? 0;
    cur.points += t.taskPoint ?? 0;
    cur.count += 1;
    memberLoads.set(t.assignee.id, cur);
  }
  const unassignedTasks = allBoardTasks.filter(t => !t.assignee && !t.isCancelled);
  const unassignedLoad = unassignedTasks.reduce(
    (acc, t) => ({ hours: acc.hours + (t.estimatedHours ?? 0), points: acc.points + (t.taskPoint ?? 0) }),
    { hours: 0, points: 0 }
  );
  const unassignedNoPointCount = unassignedTasks.filter(t => t.taskPoint === null).length;

  // ── Claim (assign) ───────────────────────────────────────────────────────────
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [assigneeId,  setAssigneeId]  = useState(userId);
  const [claiming,    setClaiming]    = useState(false);
  const [claimError,  setClaimError]  = useState('');
  const [claimOverConfirm, setClaimOverConfirm] = useState(false);

  function openClaim(task: TaskCard) {
    setClaimTarget({
      taskId: task.id, taskTitle: task.title,
      taskPoint: task.taskPoint, estimatedHours: task.estimatedHours,
      currentAssigneeId: task.assignee?.id ?? null,
    });
    setAssigneeId(task.assignee?.id ?? userId);
    setClaimError('');
    setClaimOverConfirm(false);
  }

  // โหลดของผู้รับผิดชอบใหม่ถ้ายืนยัน (ของเดิม + ชม.ของงานนี้ ถ้าเปลี่ยนคนจากเดิม)
  const claimTargetNewLoad = claimTarget && claimTarget.currentAssigneeId !== assigneeId
    ? (memberLoads.get(assigneeId)?.hours ?? 0) + (claimTarget.estimatedHours ?? 0)
    : (memberLoads.get(assigneeId)?.hours ?? 0);
  const claimWillExceedCapacity = claimTarget !== null && claimTargetNewLoad > capacityHours;

  async function submitClaim() {
    if (!claimTarget) return;
    if (claimTarget.taskPoint === null) {
      setClaimError('งานนี้ยังไม่ตั้ง Task Point — ต้องตั้ง point ก่อนถึงจะ assign ได้');
      return;
    }
    if (claimWillExceedCapacity && !claimOverConfirm) {
      setClaimOverConfirm(true);
      return;
    }
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
  const [createPoint,  setCreatePoint]  = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const [pointMappings, setPointMappings] = useState<{ id: string; point: number; hours: number }[]>([]);
  useEffect(() => {
    fetch('/api/admin/task-point-mapping').then(r => r.json()).then(setPointMappings);
  }, []);

  // ── Card Point block (Task Card Burn Bar design) — เปลี่ยน point จากการ์ดได้ตรงๆ ──
  const [pointSavingId, setPointSavingId] = useState<string | null>(null);
  const [pointErrorId,  setPointErrorId]  = useState<string | null>(null);

  async function handleCardPointChange(taskId: string, point: number) {
    setPointSavingId(taskId); setPointErrorId(null);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskPoint: point }),
    });
    setPointSavingId(null);
    if (res.ok) {
      router.refresh();
    } else {
      setPointErrorId(taskId);
      setTimeout(() => setPointErrorId(null), 3000);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createTitle.trim() || createPoint === '') return;
    setCreateLoading(true);
    const res = await fetch('/api/tasks', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title: createTitle.trim(), squadId: currentSquadId, assigneeId: null,
        taskPoint: Number(createPoint),
      }),
    });
    if (res.ok) {
      setCreateTitle(''); setCreatePoint('');
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

  // ── Card renderer — shared between member matrix cells and the unclaimed pool ──
  function renderCard(t: TaskCard, laneName: string) {
    const av        = t.assignee ? avatarColor(t.assignee.name) : null;
    const menuOpen  = openMenuId === t.id;
    const isApproving = approvingId === t.id;

    const isDoneLane  = laneName === 'Done';
    const actMinutes  = t.totalNormalMin + t.totalOtMin;
    const estMinutes  = t.estimatedHours ? t.estimatedHours * 60 : 0;
    const burnRatio   = estMinutes > 0 ? actMinutes / estMinutes : 0;
    const overageMin  = actMinutes > estMinutes ? actMinutes - estMinutes : 0;
    const velocity    = isDoneLane && actMinutes > 0 && t.estimatedHours
      ? t.estimatedHours / (actMinutes / 60)
      : null;
    const cardPointSaving = pointSavingId === t.id;
    const cardPointError  = pointErrorId === t.id;

    return (
      <div key={t.id} className={`relative ${t.isAtRisk ? 'card-at-risk' : ''}`}>
        {t.isAtRisk && (
          <span
            className="absolute top-1.5 right-2 text-[12px] leading-none z-10 pointer-events-none"
            title={t.riskReason}
            role="img"
            aria-label={`งานด่วน: ${t.riskReason}`}
          >🔥</span>
        )}
        <div
          className={`bg-surface-1 border border-app-border rounded-[9px] p-2.5 ${
            t.isCancelled ? 'grayscale-[0.4] opacity-80' : ''
          }`}
          style={t.isCancelled ? undefined : {
            borderLeftWidth: 4,
            borderLeftColor: t.hasIssue || t.flaggedForDeletion ? 'rgb(var(--danger))'
              : t.isAtRisk ? 'rgb(var(--warning))'
              : STATUS_ACCENT[laneName] ?? 'rgb(var(--border))',
          }}
        >

          {/* Title row */}
          <div className="flex items-start gap-1 mb-2">
            <Link
              href={`/tasks/${t.id}`}
              className="flex-1 text-[13px] text-txt-primary flex items-start gap-1.5 hover:text-accent transition-colors"
            >
              {t.isCancelled ? (
                <span className="text-[9.5px] font-semibold bg-surface-3 text-txt-secondary px-1.5 py-0.5 rounded-full flex-shrink-0 mt-[1px]">
                  🚫 ยกเลิก
                </span>
              ) : t.hasIssue && (
                <span className="text-danger flex-shrink-0 text-[11px] leading-[1.4]">▲</span>
              )}
              {t.reviewApprovedAt && laneName === 'Wait for review' && (
                <span className="text-success flex-shrink-0 text-[11px] leading-[1.4]" title="Review ผ่านแล้ว">✓</span>
              )}
              {t.title}
            </Link>

            {/* ⋯ menu button — ADMIN/QA_LEAD เท่านั้น, ปิดถ้า sprint นี้ปิดแล้ว (view-only) */}
            {canAssign && !isReadonly && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  setOpenMenuId(menuOpen ? null : t.id);
                }}
                className="text-txt-muted hover:text-txt-primary text-[14px] leading-none px-1 py-0.5 rounded hover:bg-surface-3 flex-shrink-0"
              >
                ⋯
              </button>
            )}
          </div>

          {/* Meta row: point chip + estimate + avatar */}
          {!t.isCancelled && (
            <div className="flex items-center gap-1.5 mb-2">
              <div onClick={e => e.stopPropagation()}>
                <select
                  value={t.taskPoint ?? ''}
                  onChange={e => handleCardPointChange(t.id, Number(e.target.value))}
                  disabled={cardPointSaving || !canAssign || isReadonly}
                  className={`appearance-none text-center font-mono text-[10.5px] font-semibold rounded-full px-1.5 py-0.5 border cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-default ${
                    t.taskPoint !== null ? 'bg-accent-bg text-accent border-accent/30' : 'bg-surface-3 text-txt-muted border-app-border'
                  }`}
                >
                  {t.taskPoint === null && <option value="" disabled>– PT</option>}
                  {pointMappings.map(p => <option key={p.id} value={p.point}>{p.point} PT</option>)}
                </select>
              </div>
              <span className="font-mono text-[10.5px] text-txt-secondary flex-shrink-0">
                {t.taskPoint !== null && t.estimatedHours !== null ? `${t.estimatedHours} ชม.` : 'ยังไม่ตั้ง estimate'}
              </span>
              {cardPointError && <span className="text-[9px] text-danger flex-shrink-0">พลาด</span>}
              {av && t.assignee && (
                <div
                  className="ml-auto w-5 h-5 rounded-full text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0"
                  style={{ background: av.bg, color: av.fg }}
                  title={t.assignee.name}
                >
                  {initials(t.assignee.name)}
                </div>
              )}
            </div>
          )}

          {/* Flagged badge */}
          {t.flaggedForDeletion && (
            <div className="mb-2">
              <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-danger-bg text-danger font-semibold">
                🚩 Flag ให้ลบ{t.deletionFlagNote ? ` — "${t.deletionFlagNote}"` : ''}
              </span>
            </div>
          )}

          {/* Cancelled note (การ์ดยกเลิก — ไม่มี meta row/burn bar ด้านบนแล้ว) */}
          {t.isCancelled && (
            <>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="font-mono text-[10.5px] font-semibold rounded-full px-1.5 py-0.5 bg-surface-3 text-txt-muted">
                  {t.taskPoint !== null ? `${t.taskPoint} PT` : '– PT'}
                </span>
                {t.estimatedHours !== null && (
                  <span className="font-mono text-[10.5px] text-txt-muted line-through">{t.estimatedHours} ชม.</span>
                )}
              </div>
              <p className="text-[10.5px] text-txt-muted mb-1.5">
                ยกเลิกโดย {t.cancelledByName ?? '—'}{t.cancelNote ? ` — ${t.cancelNote}` : ''} — ตัดออกจากโหลดแล้ว
              </p>
            </>
          )}

          {/* On-Board / On-Board In Progress: show personal lane + capacity context */}
          {(laneName === 'On-Board' || laneName === 'On-Board In Progress') && t.laneName && t.assignee && (
            <p className="text-[10.5px] text-txt-muted mt-1 mb-1.5">
              อยู่เลน &ldquo;{t.laneName}&rdquo; ในบอร์ดของ {t.assignee.name} · นับใน {capacityHours} ชม. ของ {t.assignee.name} แล้ว
            </p>
          )}

          {/* To do list / มีปัญหา: capacity context + missing-point warning */}
          {!t.isCancelled && (laneName === 'To do list' || laneName === 'มีปัญหา') && (
            t.taskPoint === null ? (
              <p className="text-[10.5px] text-warning mt-1 mb-1.5">⚠ ต้องตั้ง point ก่อน assign</p>
            ) : !t.assignee ? (
              <p className="text-[10.5px] text-txt-muted mt-1 mb-1.5">ยังไม่ถูก assign — ยังไม่นับโหลดใคร</p>
            ) : laneName === 'มีปัญหา' && (
              <p className="text-[10.5px] text-txt-muted mt-1 mb-1.5">ยังนับใน {capacityHours} ชม. ของ {t.assignee.name} (ยังต้องทำต่อ)</p>
            )
          )}

          {/* Burn bar — ACT ÷ EST */}
          {!t.isCancelled && (
            <div className="flex flex-col gap-1 mt-1.5">
              <div className="flex items-center justify-between font-mono text-[10.5px]">
                <span className={
                  actMinutes === 0 ? 'text-txt-muted'
                    : estMinutes === 0 ? 'text-txt-secondary'
                    : burnRatio > 1 ? 'text-danger' : burnRatio >= 0.7 ? 'text-warning' : 'text-success'
                }>
                  {fmtHM(actMinutes)}{' '}
                  <span className="text-txt-muted font-sans">
                    {isDoneLane && t.totalOtMin > 0 ? `· OT ${fmtHM(t.totalOtMin)}` : !isDoneLane ? 'ใช้ไป' : ''}
                  </span>
                </span>
                <span className={isDoneLane ? (velocity !== null && velocity >= 1 ? 'text-success' : 'text-danger') : 'text-txt-secondary'}>
                  {isDoneLane && velocity !== null
                    ? `Velocity ${velocity.toFixed(2)}`
                    : estMinutes > 0
                      ? (overageMin > 0 ? <span className="text-danger">เกิน EST · +{fmtHM(overageMin)}</span> : `${Math.round(Math.min(burnRatio, 1) * 100)}% ของ EST`)
                      : 'EST —'}
                </span>
              </div>
              {estMinutes > 0 && (
                <div className="h-1 rounded-full bg-surface-3 overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-[250ms] ease-out ${burnColorCls(burnRatio)}`}
                    style={{ width: `${Math.min(burnRatio, 1) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Approve review button — Wait for review column only */}
          {laneName === 'Wait for review' && canApproveReview && !t.reviewApprovedAt && !isReadonly && (
            <button
              onClick={() => approveReview(t.id)}
              disabled={isApproving}
              className={`mt-2 w-full text-[11.5px] px-2 py-1.5 rounded-[3px] bg-success-bg border border-success/30 text-success hover:bg-success/15 transition-colors disabled:opacity-50 font-medium ${isApproving ? 'btn-loading' : ''}`}
            >
              ✓ Review ผ่าน
            </button>
          )}

          {/* Already approved indicator */}
          {laneName === 'Wait for review' && t.reviewApprovedAt && (
            <div className="mt-2 text-[10.5px] text-success text-center py-1 bg-success-bg rounded-[3px]">
              ✓ Review ผ่านแล้ว — รอ QA_ENGINEER ย้ายไป Done
            </div>
          )}

          {/* Claim button */}
          {canAssign && members.length > 0 && !isReadonly && (
            <button
              onClick={() => openClaim(t)}
              className="mt-2 w-full text-[11.5px] px-2 py-1 rounded-[3px] border border-app-border text-txt-muted hover:border-accent hover:text-accent transition-colors"
            >
              + เพิ่มเข้าบอร์ดของฉัน
            </button>
          )}
        </div>

        {/* Card ⋯ dropdown */}
        {canAssign && !isReadonly && menuOpen && (
          <div
            className="absolute right-0 top-8 bg-surface-2 border border-app-border rounded-[3px] py-1 min-w-[190px] z-20 shadow-lg"
            onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
          >
            {!t.flaggedForDeletion ? (
              <button
                onClick={() => openFlagModal(t)}
                className="w-full text-left text-[12px] px-3 py-2 rounded-[3px] hover:bg-danger-bg text-danger transition-colors"
              >
                🚩 Flag ให้ลบ
              </button>
            ) : (
              <button
                onClick={() => submitUnflag(t.id)}
                className="w-full text-left text-[12px] px-3 py-2 rounded-[3px] hover:bg-surface-3 text-txt-secondary transition-colors"
              >
                ↩ ยกเลิก flag (เก็บงานนี้ไว้)
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-7 py-6 pb-16">

      {/* Page header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2.5">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-[19px] font-semibold text-txt-primary">Squad Board</h1>
          <select
            className="bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-[3px] focus:outline-none focus:border-accent"
            value={currentSquadId}
            onChange={e => router.push(`/squads/${e.target.value}`)}
          >
            {squads.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Sprint selector */}
          {sprints.length > 0 ? (
            <div className="inline-flex items-center gap-1.5">
              <select
                className={`bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-[3px] focus:outline-none focus:border-accent transition-opacity ${sprintNavPending ? 'opacity-50 pointer-events-none' : ''}`}
                value={activeSprintId ?? ''}
                disabled={sprintNavPending}
                onChange={e => {
                  const sprintId = e.target.value;
                  startSprintNav(() => router.push(`/squads/${currentSquadId}?sprint=${sprintId}`));
                }}
              >
                {sprints.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.status === 'OPEN' ? '🟢 ' : '🔴 '}{s.name}
                  </option>
                ))}
              </select>
              {sprintNavPending && <span className="inline-spinner" />}
            </div>
          ) : (
            <span className="text-[12px] text-txt-muted bg-surface-1 border border-app-border px-2.5 py-[7px] rounded-[3px]">
              ยังไม่มี Sprint
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Sprint management buttons */}
          {canManageSprint && activeSprint?.status === 'OPEN' && (
            <button
              onClick={() => { setShowCloseSprint(true); setCloseSprintError(''); setUnfinishedCount(null); }}
              className="bg-surface-2 border border-danger/40 text-danger text-[13px] px-3 py-[7px] rounded-[3px] flex items-center gap-1.5 hover:bg-danger-bg transition-colors"
            >
              🔴 ปิด Sprint
            </button>
          )}
          {canManageSprint && !sprints.some(s => s.status === 'OPEN') && (
            <button
              onClick={() => { setShowOpenSprint(true); setNewSprintName(''); setNewSprintEndDate(''); setOpenSprintError(''); }}
              className="bg-surface-2 border border-success/40 text-success text-[13px] px-3 py-[7px] rounded-[3px] flex items-center gap-1.5 hover:bg-success-bg transition-colors"
            >
              🟢 เปิด Sprint ใหม่
            </button>
          )}

          <button
            onClick={manualRefresh}
            title="อัปเดตข้อมูลล่าสุด"
            className="bg-surface-2 border border-app-border text-txt-muted text-[13px] px-2.5 py-[7px] rounded-[3px] flex items-center gap-1.5 hover:bg-surface-3 hover:text-txt-primary transition-colors"
          >
            ↻
            <span className="text-[11px]">
              {lastRefreshed.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </button>
          {isReadonly && activeSprint && (
            <button
              onClick={openSprintExport}
              className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-[3px] flex items-center gap-1.5 hover:bg-surface-3 transition-colors"
            >
              📄 Export Sprint
            </button>
          )}
          <button
            onClick={openExport}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-[3px] flex items-center gap-1.5 hover:bg-surface-3 transition-colors"
          >
            ↓ Export Report
          </button>
        </div>
      </div>

      {/* Readonly banner for closed sprint */}
      {isReadonly && (
        <div className="flex items-center gap-2 bg-surface-1 border border-app-border rounded-[3px] px-4 py-2.5 mb-4 text-[12.5px] text-txt-secondary">
          <span className="text-lg">🔒</span>
          <span>
            Sprint นี้ปิดแล้ว ({activeSprint?.closedAt ? new Date(activeSprint.closedAt).toLocaleDateString('th-TH') : ''}) — ดูข้อมูลได้อย่างเดียว
          </span>
          {canManageSprint && !sprints.some(s => s.status === 'OPEN') && (
            <button
              onClick={() => { setShowOpenSprint(true); setNewSprintName(''); setNewSprintEndDate(''); setOpenSprintError(''); }}
              className="ml-auto bg-success-bg border border-success/40 text-success text-[12px] px-3 py-1 rounded-[3px] hover:bg-success/15 transition-colors"
            >
              🟢 เปิด Sprint ใหม่
            </button>
          )}
        </div>
      )}

      {/* Squad capacity panel (Board Point Capacity) */}
      {members.length > 0 && (() => {
        const squadTotalHours  = members.reduce((s, m) => s + (memberLoads.get(m.id)?.hours ?? 0), 0);
        const squadTotalPoints = members.reduce((s, m) => s + (memberLoads.get(m.id)?.points ?? 0), 0);
        const squadCap = capacityHours * members.length;
        const overMembers  = members.filter(m => (memberLoads.get(m.id)?.hours ?? 0) > capacityHours);
        const underMembers = members.filter(m => (memberLoads.get(m.id)?.hours ?? 0) < capacityHours * 0.9);
        const summarySentence = overMembers.length > 0
          ? `เกลี่ยงานให้แต่ละคนไม่เกิน ${capacityHours} ชม./sprint — ตอนนี้ ${overMembers.map(m => m.name).join(', ')} เกินเป้า${
              underMembers.length > 0 ? ` ส่วน ${underMembers.map(m => m.name).join(', ')} ยังรับได้อีก` : ''
            }`
          : `เกลี่ยงานให้แต่ละคนไม่เกิน ${capacityHours} ชม./sprint`;
        return (
          <div className="bg-surface-1 border border-app-border rounded-[4px] px-4 py-3.5 mb-4 flex flex-col gap-3.5">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <div className="text-[11px] font-semibold tracking-[.08em] text-txt-muted uppercase">โหลดรวมของ SQUAD</div>
                <div className="flex items-baseline gap-2 whitespace-nowrap">
                  <div className="font-mono text-[24px] font-semibold text-txt-primary leading-none">{squadTotalHours}</div>
                  <div className="text-[13px] text-txt-secondary">/ {squadCap} ชม. · {members.length} คน · {squadTotalPoints} point</div>
                </div>
              </div>
              <p className="text-[12px] text-txt-secondary leading-relaxed max-w-[420px]">{summarySentence}</p>
            </div>

            <div className="flex gap-2.5 flex-wrap">
              {members.map(m => {
                const load = memberLoads.get(m.id) ?? { hours: 0, points: 0, count: 0 };
                const ratio = capacityHours > 0 ? load.hours / capacityHours : 0;
                const over  = load.hours > capacityHours;
                const near  = !over && ratio >= 0.9;
                const barColor = over ? 'bg-danger' : near ? 'bg-accent' : 'bg-success';
                const statusText = over ? `เกินเป้า ${load.hours - capacityHours} ชม.` : near ? 'ใกล้เต็มโควตา' : load.hours === capacityHours ? 'เต็มพอดี' : `รับได้อีก ${capacityHours - load.hours} ชม.`;
                const statusColor = over ? 'text-danger' : near ? 'text-accent' : 'text-success';
                const av = avatarColor(m.name);
                return (
                  <div key={m.id} className={`bg-surface-2 border rounded-[10px] px-3 py-2.5 w-[210px] flex flex-col gap-2 ${over ? 'border-danger/45' : 'border-app-border'}`}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0" style={{ background: av.bg, color: av.fg }}>
                        {initials(m.name)}
                      </div>
                      <span className="text-[12.5px] text-txt-primary truncate">{m.name}</span>
                      <span className={`ml-auto font-mono text-[11.5px] font-semibold flex-shrink-0 ${over ? 'text-danger' : 'text-txt-primary'}`}>{load.hours} / {capacityHours}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                      <div className={`h-full ${barColor}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[10.5px] text-txt-muted">
                      <span>{load.points} PT · {load.count} งาน</span>
                      <span className={statusColor}>{statusText}</span>
                    </div>
                  </div>
                );
              })}

              {unassignedTasks.length > 0 && (
                <div className="bg-surface-2 border border-dashed border-app-border rounded-[10px] px-3 py-2.5 w-[210px] flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold tracking-[.06em] text-txt-muted">ยังไม่มีเจ้าของ</div>
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="font-mono text-[16px] font-semibold text-txt-primary">{unassignedLoad.hours}</span>
                    <span className="text-[11.5px] text-txt-secondary">ชม. · {unassignedLoad.points} PT · {unassignedTasks.length} งาน</span>
                  </div>
                  {unassignedNoPointCount > 0 && (
                    <div className="text-[10.5px] text-txt-muted leading-relaxed">{unassignedNoPointCount} งานยังไม่ตั้ง point</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Board matrix — rows: squad members × columns: 5 derived statuses */}
      <div className={isReadonly ? 'opacity-70 select-none' : ''}>
        {members.length > 0 && (
          <div className="overflow-x-auto pb-1">
            <div
              className="grid gap-2.5 min-w-[880px] mb-3.5"
              style={{ gridTemplateColumns: '190px repeat(5, minmax(0,1fr))' }}
            >
              {/* Header row */}
              <span />
              {STATUS_COLS.map(col => {
                const sub = laneSubtotal(laneByName.get(col.key) ?? []);
                return (
                  <span key={col.key} className={`text-[11.5px] font-semibold flex items-center justify-between gap-1.5 ${col.color}`}>
                    <span className="flex items-center gap-1.5"><span>{col.glyph}</span>{col.label}</span>
                    {(sub.hours > 0 || sub.points > 0) && (
                      <span className="font-mono text-[10.5px] font-normal text-txt-secondary whitespace-nowrap">{sub.points} PT · {sub.hours} ชม.</span>
                    )}
                  </span>
                );
              })}

              {/* Member rows */}
              {members.flatMap(m => {
                const av = avatarColor(m.name);
                return [
                  <div key={`m-${m.id}`} className="flex items-center gap-2 bg-surface-2 border border-app-border rounded-[11px] px-3 py-2.5">
                    <div
                      className="w-6 h-6 rounded-full text-[10px] font-semibold flex items-center justify-center flex-shrink-0"
                      style={{ background: av.bg, color: av.fg }}
                    >
                      {initials(m.name)}
                    </div>
                    <span className="text-[13px] font-medium text-txt-primary truncate">{m.name}</span>
                    {m.external && (
                      <span className="text-[10px] text-txt-muted flex-shrink-0" title="ไม่ใช่สมาชิก squad นี้ในปัจจุบัน — มีงานค้างจากตอนที่ยังเกี่ยวข้องอยู่">(นอกทีม)</span>
                    )}
                    <span className="ml-auto text-[11px] font-mono text-txt-muted flex-shrink-0">{m.taskCount} งาน</span>
                  </div>,
                  ...STATUS_COLS.map(col => {
                    const cellTasks = (laneByName.get(col.key) ?? []).filter(t => t.assignee?.id === m.id);
                    return (
                      <div key={`${m.id}-${col.key}`} className="bg-surface-3 rounded-[11px] p-2 flex flex-col gap-1.5 min-h-[52px]">
                        {cellTasks.map(t => renderCard(t, col.key))}
                      </div>
                    );
                  }),
                ];
              })}
            </div>
          </div>
        )}

        {/* Pool: unclaimed tasks — ยังไม่มีเจ้าของ */}
        <div className="bg-surface-2 border border-app-border rounded-[11px] p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-semibold text-txt-secondary">○ กองกลาง — ยังไม่มีเจ้าของ · {poolTasks.length}</span>
            {(unassignedLoad.hours > 0 || unassignedLoad.points > 0) && (
              <span className="font-mono text-[11px] text-txt-secondary">{unassignedLoad.points} PT · {unassignedLoad.hours} ชม.</span>
            )}
            {canAssign && poolTasks.length > 0 && (
              <span className="ml-auto text-[11.5px] text-txt-muted">assign ให้สมาชิกได้จากปุ่ม &ldquo;+ เพิ่มเข้าบอร์ดของฉัน&rdquo; บนการ์ด</span>
            )}
          </div>
          <div className="flex gap-2.5 flex-wrap">
            {poolTasks.length === 0 && (
              <span className="text-[12px] text-txt-muted py-1">ไม่มีงานรอ assign</span>
            )}
            {poolTasks.map(t => (
              <div key={t.id} className="flex-[0_0_250px]">
                {renderCard(t, 'To do list')}
              </div>
            ))}
          </div>

          {canCreateTask && hasOpenSprint && !isReadonly && (
            <div className="mt-1 max-w-[320px]">
              {showCreate ? (
                <form onSubmit={submitCreate} className="flex flex-col gap-1.5">
                  <input
                    autoFocus
                    value={createTitle}
                    onChange={e => setCreateTitle(e.target.value)}
                    placeholder="ชื่องาน..."
                    className="w-full bg-surface-2 border border-accent text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-[3px] focus:outline-none font-[inherit]"
                  />
                  <select
                    value={createPoint}
                    onChange={e => setCreatePoint(e.target.value)}
                    className={`w-full bg-surface-2 border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-[3px] focus:outline-none font-[inherit] ${createPoint === '' ? 'border-danger/50' : 'border-app-border'}`}
                  >
                    <option value="">Task Point — เลือก (จำเป็น)</option>
                    {pointMappings.map(p => <option key={p.id} value={p.point}>{p.point} pt ({p.hours} ชม.)</option>)}
                  </select>
                  <div className="flex gap-1.5">
                    <button
                      type="submit"
                      disabled={createLoading || !createTitle.trim() || createPoint === ''}
                      className={`flex-1 bg-accent hover:bg-accent-hover text-white text-[12.5px] py-1.5 rounded-[3px] font-medium disabled:opacity-50 transition-colors ${createLoading ? 'btn-loading' : ''}`}
                    >
                      เพิ่ม
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowCreate(false); setCreateTitle(''); setCreatePoint(''); }}
                      disabled={createLoading}
                      className="px-3 py-1.5 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full text-[12px] text-txt-muted hover:text-txt-primary border border-dashed border-app-border rounded-[3px] py-2 transition-colors hover:border-accent hover:bg-surface-2"
                >
                  + เพิ่มงานใหม่
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── LINE send buttons ── */}
      {canManageSprint && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={() => sendLine('standup')}
            disabled={lineLoading !== null}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-[3px] hover:border-accent hover:bg-surface-1 transition-colors disabled:opacity-50"
          >
            {lineLoading === 'standup' ? 'กำลังส่ง...' : '📤 ส่ง Standup เช้านี้'}
          </button>
          <button
            onClick={() => sendLine('eod')}
            disabled={lineLoading !== null}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-[3px] hover:border-accent hover:bg-surface-1 transition-colors disabled:opacity-50"
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
          <div className="bg-surface-1 border border-app-border rounded-[4px] w-full max-w-[400px] shadow-2xl p-5">
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
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-[3px] font-[inherit] resize-y focus:outline-none focus:border-accent"
            />
            {flagError && <p className="text-[11.5px] text-danger mt-1.5">{flagError}</p>}
            <p className="text-[11px] text-txt-muted mt-2 leading-relaxed">
              Flag แล้วงานนี้จะขึ้น badge 🚩 ทุกที่ที่โผล่ และ ADMIN/QA_LEAD/QA_MANAGER จะลบจริงได้ที่หน้า &ldquo;งานทั้งหมด&rdquo;
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setFlagTarget(null)}
                disabled={flagging}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-[3px] hover:bg-surface-3 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitFlag}
                disabled={flagging}
                className={`bg-danger border border-danger text-white text-[13px] px-4 py-2 rounded-[3px] font-medium hover:bg-[#7A3D00] transition-colors disabled:opacity-50 ${flagging ? 'btn-loading' : ''}`}
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
          <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[600px] max-h-[85vh] flex flex-col shadow-xl">
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
                  className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-1.5 rounded-[3px] focus:outline-none focus:border-accent" />
              </div>
              <div>
                <label className="block text-[12px] text-txt-secondary mb-1">ถึงวันที่</label>
                <input type="date" value={exportEnd}
                  onChange={e => { setExportEnd(e.target.value); setExportMd(''); }}
                  className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-1.5 rounded-[3px] focus:outline-none focus:border-accent" />
              </div>
              <button onClick={fetchExport}
                disabled={exportLoading || !exportStart || !exportEnd}
                className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-[7px] rounded-[3px] disabled:opacity-50 transition-colors">
                {exportLoading ? 'กำลังสร้าง...' : 'สร้าง Report'}
              </button>
            </div>
            {exportMd && (
              <>
                <div className="flex-1 overflow-y-auto bg-surface-2 border border-app-border rounded-[3px] p-3 mb-4 min-h-0">
                  <pre className="text-[12.5px] text-txt-secondary whitespace-pre-wrap font-mono leading-relaxed">{exportMd}</pre>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={printPdf}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-[3px] hover:bg-surface-3 transition-colors">
                    Print / PDF
                  </button>
                  <button onClick={downloadMd}
                    className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-2 rounded-[3px] transition-colors">
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
          <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[340px] shadow-xl">
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
              onChange={e => { setAssigneeId(e.target.value); setClaimOverConfirm(false); setClaimError(''); }}
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-[3px] focus:outline-none focus:border-accent"
            >
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.id === userId ? ' (ฉัน)' : ''}
                </option>
              ))}
            </select>

            {claimTarget?.taskPoint === null && (
              <p className="text-[12px] text-warning mt-2">⚠ งานนี้ยังไม่ตั้ง Task Point — ต้องตั้ง point ก่อนถึงจะ assign ได้ (แก้ที่การ์ดได้เลย)</p>
            )}
            {claimTarget?.taskPoint !== null && claimOverConfirm && (
              <p className="text-[12px] text-danger mt-2">
                ⚠ assign แล้ว {members.find(m => m.id === assigneeId)?.name} จะมีโหลด {claimTargetNewLoad} ชม. เกินเป้า {capacityHours} ชม. — ยืนยันต่อไหม?
              </p>
            )}
            {claimError && <p className="text-[12px] text-danger mt-2">{claimError}</p>}

            <div className="flex gap-2 mt-4">
              <button
                onClick={submitClaim}
                disabled={claiming || claimTarget?.taskPoint === null}
                className={`flex-1 text-white text-[13px] py-2 rounded-[3px] font-medium disabled:opacity-50 transition-colors ${claiming ? 'btn-loading' : ''} ${
                  claimOverConfirm ? 'bg-danger hover:bg-danger/85' : 'bg-accent hover:bg-accent-hover'
                }`}
              >
                {claimOverConfirm ? 'ยืนยันต่อ (เกินโควตา)' : 'ยืนยัน'}
              </button>
              <button
                onClick={() => setClaimTarget(null)}
                disabled={claiming}
                className="px-4 py-2 text-[13px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors"
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
          <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[620px] max-h-[85vh] flex flex-col shadow-xl">
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
                <div className="flex-1 overflow-y-auto bg-surface-2 border border-app-border rounded-[3px] p-3 mb-4 min-h-0">
                  <pre className="text-[12.5px] text-txt-secondary whitespace-pre-wrap font-mono leading-relaxed">{sprintExportMd}</pre>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={downloadSprintMd}
                    className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-4 py-2 rounded-[3px] transition-colors">
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
          <div className="bg-surface-1 border border-app-border rounded-[4px] w-full max-w-[400px] shadow-2xl p-5">
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
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-[3px] focus:outline-none focus:border-accent mb-3 font-[inherit]"
            />
            <label className="block text-[12px] text-txt-secondary mb-1.5">วันปิด Sprint <span className="text-txt-muted">(ไม่บังคับ — ใช้แจ้งเตือนงานเสี่ยง)</span></label>
            <input
              type="date"
              value={newSprintEndDate}
              onChange={e => setNewSprintEndDate(e.target.value)}
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-[3px] focus:outline-none focus:border-accent mb-3 font-[inherit]"
            />
            {openSprintError && <p className="text-[12px] text-danger mb-3">{openSprintError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowOpenSprint(false)}
                disabled={openingLoading}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-[3px] hover:bg-surface-3 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitOpenSprint}
                disabled={openingLoading}
                className={`bg-success border border-success text-white text-[13px] px-4 py-2 rounded-[3px] font-medium hover:opacity-90 transition-colors disabled:opacity-50 ${openingLoading ? 'btn-loading' : ''}`}
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
          <div className="bg-surface-1 border border-app-border rounded-[4px] w-full max-w-[440px] shadow-2xl p-5">
            <h2 className="text-[15px] font-semibold text-danger mb-1">🔴 ปิด Sprint</h2>
            <p className="text-[12.5px] text-txt-secondary mb-4 leading-relaxed">
              ยืนยันการปิด <b>{activeSprint.name}</b> — sprint นี้จะเป็น read-only และระบบจะเปิด Sprint ใหม่ให้ต่อทันที
            </p>

            {unfinishedCount !== null && unfinishedCount > 0 && (
              <div className="bg-warning-bg border border-warning/30 rounded-[3px] px-3 py-2.5 mb-4">
                <p className="text-[12.5px] text-warning font-medium">
                  ▲ ยังมีงานที่ยังไม่เสร็จ {unfinishedCount} งาน (รวมงานกองกลาง)
                </p>
                <p className="text-[11.5px] text-txt-secondary mt-1">
                  งานเหล่านี้จะถูกย้ายไป Sprint ใหม่ให้อัตโนมัติ (คงเลนเดิม ยังไม่มีเจ้าของเหมือนเดิมถ้ายังไม่มี)
                </p>
              </div>
            )}

            {closeSprintError && <p className="text-[12px] text-danger mb-3">{closeSprintError}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCloseSprint(false); setUnfinishedCount(null); }}
                disabled={closingLoading}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-[3px] hover:bg-surface-3 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => submitCloseSprint(unfinishedCount !== null)}
                disabled={closingLoading}
                className={`bg-danger border border-danger text-white text-[13px] px-4 py-2 rounded-[3px] font-medium hover:bg-[#7A3D00] transition-colors disabled:opacity-50 ${closingLoading ? 'btn-loading' : ''}`}
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
