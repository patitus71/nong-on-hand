'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent,
  PointerSensor, closestCorners, pointerWithin, useSensor, useSensors, useDroppable,
  type CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable,
  verticalListSortingStrategy, horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { fmt, fmtHM, burnColorCls, initials, avatarColor, renderReportMarkdown, markdownToPlainText } from '@/lib/ui';

/* ─── Types ─────────────────────────────────────────── */
type TaskData = {
  id: string; title: string; hasIssue: boolean; order: number;
  reviewApprovedAt: string | null;
  isCancelled: boolean;
  cancelNote: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  prLink: string | null;
  squad: { name: string } | null;
  squadId: string | null;
  assignee: { name: string } | null;
  assigneeId: string | null;
  taskPoint: number | null;
  estimatedHours: number | null;
  totalNormalMin: number; totalOtMin: number;
  isAtRisk: boolean; riskReason: string;
};
type LaneData = { id: string; name: string; tasks: TaskData[] };
type PointMapping = { id: string; point: number; hours: number };

type ProblemTask = {
  id: string; title: string; hasIssue: boolean; laneName: string;
  squadName: string; totalNormalMin: number; totalOtMin: number;
};

type PendingReview = {
  id: string; title: string; prLink: string | null;
  squad: { id: string; name: string } | null;
  assignee: { name: string } | null;
};

type Reviewer = { id: string; name: string };

/* ─── Queue rail (left sidebar): urgent / pending-review / ready-to-close ── */
function QueueRail({
  pendingReviews, readyTasks, onApprove, onMoveToDone,
}: {
  pendingReviews: PendingReview[];
  readyTasks: TaskData[];
  onApprove: (taskId: string) => Promise<void>;
  onMoveToDone: (taskId: string) => void;
}) {
  const [approving, setApproving] = useState<string | null>(null);
  if (pendingReviews.length === 0 && readyTasks.length === 0) return null;

  return (
    <div className="w-[260px] flex-shrink-0 flex flex-col gap-4">
      {pendingReviews.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10.5px] font-semibold tracking-[.04em] text-accent">◆ รอฉัน REVIEW · {pendingReviews.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {pendingReviews.map(r => (
              <div key={r.id} className="bg-accent-bg border border-accent/20 rounded-[9px] p-2.5">
                <Link href={`/tasks/${r.id}`}
                  className="block text-[12.5px] text-txt-primary mb-1 hover:text-accent transition-colors leading-snug">
                  {r.title}
                </Link>
                <p className="text-[11px] text-txt-muted mb-2">
                  {r.squad ? `${r.squad.name} · ` : ''}ส่งโดย {r.assignee?.name ?? '—'}
                  {r.prLink ? ' · มี PR link' : ' · ไม่มี PR link'}
                </p>
                <button
                  disabled={approving === r.id}
                  onClick={async () => { setApproving(r.id); await onApprove(r.id); setApproving(null); }}
                  className="w-full bg-success/10 border border-success/30 text-success text-[11px] py-1.5 rounded-[3px] hover:bg-success/20 disabled:opacity-50 transition-colors font-medium"
                >
                  {approving === r.id ? '...' : '✓ Review ผ่าน'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {readyTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[10.5px] font-semibold tracking-[.04em] text-success">✓ พร้อมปิดงาน · {readyTasks.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {readyTasks.map(t => (
              <div key={t.id} className="bg-success-bg border border-success/30 rounded-[9px] p-2.5">
                <Link href={`/tasks/${t.id}`}
                  className="block text-[12.5px] text-txt-primary mb-1 hover:text-success transition-colors leading-snug">
                  {t.title}
                </Link>
                {t.reviewerName && <p className="text-[11px] text-txt-muted mb-2">Review ผ่านโดย {t.reviewerName}</p>}
                <button
                  onClick={() => onMoveToDone(t.id)}
                  className="w-full bg-success/10 border border-success/30 text-success text-[11px] py-1.5 rounded-[3px] hover:bg-success/20 disabled:opacity-50 transition-colors font-medium"
                >
                  ย้ายไป Done
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sortable card (normal lane) ────────────────────── */
function SortableCard({
  task, overlay = false, laneName, reviewersBySquad, onReviewerChange, onPrLinkSave, saving = false,
  pointMappings = [], onTaskPointChange,
  logFormOpen = false, logNormalHours = '', logOtHours = '', logSaving = false, logError = '',
  onToggleLogForm, onQuickAdd, onNormalHoursChange, onOtHoursChange, onSubmitLog, onCancelLog,
}: {
  task: TaskData; overlay?: boolean; laneName?: string;
  reviewersBySquad?: Record<string, Reviewer[]>;
  onReviewerChange?: (taskId: string, reviewerId: string | null) => Promise<void>;
  onPrLinkSave?: (taskId: string, prLink: string | null) => Promise<{ error: string | null }>;
  saving?: boolean;
  pointMappings?: PointMapping[];
  onTaskPointChange?: (taskId: string, point: number) => Promise<{ error: string | null }>;
  logFormOpen?: boolean;
  logNormalHours?: string;
  logOtHours?: string;
  logSaving?: boolean;
  logError?: string;
  onToggleLogForm?: (taskId: string) => void;
  onQuickAdd?: (minutes: number) => void;
  onNormalHoursChange?: (value: string) => void;
  onOtHoursChange?: (value: string) => void;
  onSubmitLog?: (taskId: string) => void;
  onCancelLog?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: saving || task.isCancelled });

  const av = task.assignee ? avatarColor(task.assignee.name) : null;

  const isReviewLane = laneName === 'Review' && !overlay;
  const isReviewApprovedBanner = isReviewLane && !!task.reviewApprovedAt;
  const reviewerOptions = isReviewLane && task.squadId
    ? (reviewersBySquad?.[task.squadId] ?? []).filter(r => r.id !== task.assigneeId)
    : [];

  const [prLinkDraft,   setPrLinkDraft]   = useState(task.prLink ?? '');
  const [prLinkError,   setPrLinkError]   = useState('');
  const [prLinkSaving,  setPrLinkSaving]  = useState(false);
  const [reviewerSaving, setReviewerSaving] = useState(false);

  useEffect(() => { setPrLinkDraft(task.prLink ?? ''); }, [task.prLink]);

  async function handlePrLinkBlur() {
    const val     = prLinkDraft.trim();
    const current = task.prLink ?? '';
    if (val === current) return;
    if (val) {
      try {
        const parsed = new URL(val);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setPrLinkError('URL ต้องขึ้นต้นด้วย http:// หรือ https://');
          setPrLinkDraft(current);
          return;
        }
      } catch {
        setPrLinkError('URL ไม่ถูกต้อง');
        setPrLinkDraft(current);
        return;
      }
    }
    setPrLinkError('');
    setPrLinkSaving(true);
    const result = await onPrLinkSave?.(task.id, val || null);
    if (result?.error) {
      setPrLinkError(result.error);
      setPrLinkDraft(current);
    }
    setPrLinkSaving(false);
  }

  async function handleReviewerSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setReviewerSaving(true);
    await onReviewerChange?.(task.id, val || null);
    setReviewerSaving(false);
  }

  const stripeColor = isReviewApprovedBanner ? undefined
    : task.hasIssue && !task.isCancelled ? 'rgb(var(--danger))'
    : task.isAtRisk ? 'rgb(var(--warning))'
    : LANE_ACCENT[laneName ?? ''] ?? 'rgb(var(--border))';

  /* ── Point block / Burn bar (design handoff: Task Card Burn Bar) ── */
  const [pointSaving, setPointSaving] = useState(false);
  const [pointError,  setPointError]  = useState('');

  /* ── Manual time-log button (design handoff: only usable in In Progress) ── */
  const canLogTime = laneName === 'In Progress' && !overlay && !task.isCancelled;
  const [showLogTooltip, setShowLogTooltip] = useState(false);

  async function handlePointSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const point = Number(e.target.value);
    setPointSaving(true); setPointError('');
    const result = await onTaskPointChange?.(task.id, point);
    if (result?.error) setPointError('บันทึกไม่สำเร็จ');
    setPointSaving(false);
  }

  const isDoneLane   = laneName === 'Done';
  const actMinutes   = task.totalNormalMin + task.totalOtMin;
  const estMinutes   = task.estimatedHours ? task.estimatedHours * 60 : 0;
  const burnRatio    = estMinutes > 0 ? actMinutes / estMinutes : 0;
  const overageMin   = actMinutes > estMinutes ? actMinutes - estMinutes : 0;
  const velocity     = isDoneLane && actMinutes > 0 && task.estimatedHours
    ? task.estimatedHours / (actMinutes / 60)
    : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        ...(stripeColor ? { borderLeftWidth: 4, borderLeftColor: stripeColor } : {}),
      }}
      {...attributes} {...listeners}
      className={`bg-surface-1 border rounded-[9px] p-2.5 transition-colors select-none relative
        ${task.isCancelled ? 'grayscale-[0.4] opacity-75 cursor-default' : 'cursor-grab active:cursor-grabbing'}
        ${isReviewApprovedBanner ? 'card-review-approved border-success' : 'border-app-border'}
        ${isDragging && !overlay ? 'opacity-40' : ''}
        ${overlay ? 'shadow-xl rotate-1' : 'hover:border-[#B4BCC8]'}
        ${task.isAtRisk && !isDragging && !overlay ? 'card-at-risk' : ''}
        ${saving ? 'opacity-60 pointer-events-none cursor-wait' : ''}
      `}
    >
      {saving && (
        <span
          className="absolute top-1.5 right-1.5 z-10 animate-spin inline-block w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full"
          title="กำลังบันทึก..."
        />
      )}
      {task.isAtRisk && !saving && (
        <span className="absolute top-1.5 right-1.5 text-[12px] leading-none pointer-events-none z-10" title={task.riskReason} aria-label={`งานด่วน: ${task.riskReason}`} role="img">🔥</span>
      )}
      {isReviewApprovedBanner && (
        <div className="review-approved-banner">
          <span className="checkmark">✅</span> Review ผ่านแล้ว — พร้อมย้ายไป Done!
        </div>
      )}
      <Link
        href={`/tasks/${task.id}`}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        className="block text-[13px] text-txt-primary leading-snug mb-2 flex items-start gap-1.5 hover:text-accent transition-colors"
      >
        {task.hasIssue && !task.isCancelled && <span className="text-danger flex-shrink-0 text-[11px] leading-[1.4]">▲</span>}
        {task.title}
      </Link>

      {/* Meta row: squad tag + point chip + estimate + avatar */}
      <div className="flex items-center gap-1.5 mb-2">
        {task.squad && (
          <span className="text-[10.5px] font-mono text-txt-secondary bg-surface-3 px-2 py-0.5 rounded-full flex-shrink-0">{task.squad.name}</span>
        )}
        <div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
          <select
            value={task.taskPoint ?? ''}
            onChange={handlePointSelect}
            disabled={pointSaving || !onTaskPointChange || task.isCancelled}
            className={`appearance-none text-center font-mono text-[10.5px] font-semibold rounded-full px-2 py-0.5 border cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-default ${
              task.taskPoint !== null ? 'bg-accent-bg text-accent border-accent/30' : 'bg-surface-3 text-txt-muted border-app-border'
            }`}
          >
            {task.taskPoint === null && <option value="" disabled>– PT</option>}
            {pointMappings.map(p => <option key={p.id} value={p.point}>{p.point} PT</option>)}
          </select>
        </div>
        <span className={`font-mono text-[10.5px] text-txt-secondary flex-shrink-0 ${task.isCancelled ? 'line-through' : ''}`}>
          {task.estimatedHours !== null ? `${task.estimatedHours} ชม.` : '—'}
        </span>
        {pointError && <span className="text-[9px] text-danger flex-shrink-0">{pointError}</span>}
        {av && task.assignee && (
          <div className="ml-auto w-[19px] h-[19px] rounded-full text-[9px] font-semibold flex items-center justify-center flex-shrink-0"
            style={{ background: av.bg, color: av.fg }}>
            {initials(task.assignee.name)}
          </div>
        )}
      </div>

      {/* Burn bar — ACT ÷ EST (ไม่โชว์ถ้าการ์ดถูกยกเลิก) */}
      {!task.isCancelled && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className={
              actMinutes === 0 ? 'text-txt-muted'
                : estMinutes === 0 ? 'text-txt-secondary'
                : burnRatio > 1 ? 'text-danger' : burnRatio >= 0.7 ? 'text-warning' : 'text-success'
            }>
              {fmtHM(actMinutes)}{' '}
              <span className="text-txt-muted font-sans">
                {isDoneLane && task.totalOtMin > 0 ? `· OT ${fmtHM(task.totalOtMin)}` : !isDoneLane ? 'ใช้ไป' : ''}
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

      {/* Manual time-log button (design handoff: only usable in In Progress) */}
      {!overlay && !task.isCancelled && (
        <div className="relative mt-2">
          <button
            type="button"
            onClick={() => canLogTime ? onToggleLogForm?.(task.id) : setShowLogTooltip(true)}
            onMouseEnter={() => { if (!canLogTime) setShowLogTooltip(true); }}
            onMouseLeave={() => setShowLogTooltip(false)}
            onFocus={() => { if (!canLogTime) setShowLogTooltip(true); }}
            onBlur={() => setShowLogTooltip(false)}
            onPointerDown={e => e.stopPropagation()}
            aria-disabled={!canLogTime}
            className={`w-full h-7 rounded-[3px] text-[11.5px] font-semibold flex items-center justify-center gap-[5px] transition-colors ${
              canLogTime
                ? 'bg-accent-bg text-accent border border-accent/35 hover:bg-accent/20 cursor-pointer'
                : 'bg-surface-3 text-txt-muted border border-app-border cursor-not-allowed'
            }`}
          >
            ⏱ ลงเวลา
          </button>
          {showLogTooltip && !canLogTime && (
            <div className="pop-in absolute left-2.5 right-2.5 top-full mt-1.5 z-10 bg-surface-3 border border-app-border rounded px-2.5 py-[7px] text-[11px] leading-[1.4] text-txt-secondary shadow-[0_6px_18px_rgba(0,0,0,0.45)]">
              ลงเวลาได้เฉพาะการ์ดในเลน <span className="text-accent font-semibold">In Progress</span> — ลากการ์ดนี้เข้า In Progress ก่อน
            </div>
          )}
        </div>
      )}

      {/* Inline manual time-log form */}
      {logFormOpen && canLogTime && (
        <div
          className="pop-in bg-surface-3 border border-app-border rounded p-2.5 flex flex-col gap-[9px] mt-2"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-txt-primary">ใช้เวลาไปเท่าไหร่</span>
            <span className="font-mono text-[10.5px] text-txt-muted">
              EST {task.estimatedHours !== null ? `${task.estimatedHours} ชม.` : '—'}
            </span>
          </div>
          <div className="flex gap-[5px] flex-wrap">
            {[{ min: 15, label: '+15 น.' }, { min: 30, label: '+30 น.' }, { min: 60, label: '+1 ชม.' }, { min: 120, label: '+2 ชม.' }].map(q => (
              <button
                key={q.min} type="button" onClick={() => onQuickAdd?.(q.min)}
                className="h-[26px] px-[9px] rounded-[3px] font-mono text-[11px] font-semibold bg-accent-bg text-accent border border-accent/30 hover:bg-accent/20 transition-colors"
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10.5px] text-txt-secondary mb-1">ชั่วโมงปกติ</label>
              <input
                type="number" step="0.25" min="0" placeholder="0"
                value={logNormalHours}
                onChange={e => onNormalHoursChange?.(e.target.value)}
                className="w-full h-7 bg-surface-2 border border-app-border rounded-[3px] font-mono text-xs px-2 text-txt-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10.5px] text-txt-secondary mb-1">OT (ชม.)</label>
              <input
                type="number" step="0.25" min="0" placeholder="0"
                value={logOtHours}
                onChange={e => onOtHoursChange?.(e.target.value)}
                className="w-full h-7 bg-surface-2 border border-app-border rounded-[3px] font-mono text-xs px-2 text-txt-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <p className="font-mono text-[10.5px] text-txt-muted">
            รวมหลังบันทึก {fmtHM(actMinutes + Math.round((parseFloat(logNormalHours) || 0) * 60) + Math.round((parseFloat(logOtHours) || 0) * 60))} / EST {fmtHM(estMinutes)}
          </p>
          {logError && <p className="text-[11.5px] text-danger">{logError}</p>}
          <div className="flex gap-1.5">
            <button
              type="button" disabled={logSaving || !logNormalHours} onClick={() => onSubmitLog?.(task.id)}
              className={`flex-1 h-7 bg-accent text-white rounded-[3px] text-[11.5px] font-semibold hover:bg-accent-hover disabled:opacity-50 transition-colors ${logSaving ? 'btn-loading' : ''}`}
            >
              บันทึก
            </button>
            <button
              type="button" onClick={() => onCancelLog?.()}
              className="px-[11px] h-7 border border-app-border text-txt-secondary bg-transparent rounded-[3px] text-[11.5px] hover:bg-surface-2 transition-colors"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {task.isCancelled && task.cancelNote && (
        <div className="text-[10.5px] text-danger mt-1.5 leading-relaxed">
          🚫 ยกเลิก: {task.cancelNote} — ตัดออกจากโหลดแล้ว
        </div>
      )}

      {/* Review lane: reviewer selector + PR link */}
      {isReviewLane && (
        <div
          className="mt-2 pt-2 border-t border-app-border/40"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          {/* Reviewer */}
          {task.squadId && reviewerOptions.length > 0 ? (
            <div className="mb-1.5">
              <label className="block text-[10px] text-txt-muted mb-0.5">ผู้ review</label>
              <select
                value={task.reviewerId ?? ''}
                onChange={handleReviewerSelectChange}
                disabled={reviewerSaving}
                className="w-full bg-surface-2 border border-app-border text-txt-primary text-[11px] px-1.5 py-1 rounded-[3px] focus:outline-none focus:border-accent disabled:opacity-50 cursor-pointer"
              >
                <option value="">— ยังไม่เลือก —</option>
                {reviewerOptions.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          ) : task.reviewerName ? (
            <p className="text-[10.5px] text-txt-secondary mb-1.5">👤 {task.reviewerName}</p>
          ) : null}

          {/* PR link */}
          <div>
            <label className="block text-[10px] text-txt-muted mb-0.5">PR link</label>
            {prLinkSaving ? (
              <span className="text-[10.5px] text-txt-muted">กำลังบันทึก...</span>
            ) : (
              <input
                type="url"
                value={prLinkDraft}
                onChange={e => { setPrLinkDraft(e.target.value); setPrLinkError(''); }}
                onBlur={handlePrLinkBlur}
                placeholder="https://github.com/..."
                className="w-full bg-surface-2 border border-app-border text-txt-primary text-[11px] px-1.5 py-1 rounded-[3px] focus:outline-none focus:border-accent placeholder-txt-muted"
              />
            )}
            {prLinkError && <p className="text-[10px] text-danger mt-0.5">{prLinkError}</p>}
            {!prLinkError && task.prLink && (
              <a href={task.prLink} target="_blank" rel="noopener noreferrer"
                className="block text-[10px] text-accent hover:underline truncate mt-0.5"
                title={task.prLink}
                onClick={e => e.stopPropagation()}
              >↗ เปิด PR</a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sortable flagged card (issue section) ─────────── */
function SortableFlaggedCard({
  task, onResolve,
}: { task: TaskData; onResolve: (t: TaskData) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes} {...listeners}
      className={`bg-surface-1 border border-danger/45 rounded-[9px] p-2.5 w-[220px] flex-shrink-0 cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <Link
        href={`/tasks/${task.id}`}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        className="block text-[12.5px] text-txt-primary mb-1 flex items-start gap-1.5 hover:text-accent transition-colors"
      >
        <span className="text-danger flex-shrink-0 text-[11px] leading-[1.4]">▲</span>
        {task.title}
      </Link>
      {task.squad && <p className="text-[10.5px] text-txt-muted mb-2">{task.squad.name}</p>}
      <button
        onClick={e => { e.stopPropagation(); onResolve(task); }}
        onPointerDown={e => e.stopPropagation()}
        className="w-full bg-surface-3 text-success text-[11px] py-1.5 rounded-[3px] hover:bg-success-bg font-medium transition-colors"
      >
        ✓ จัดการปัญหานี้
      </button>
    </div>
  );
}

/* ─── Droppable lane card area ──────────────────────── */
function DroppableLaneCards({
  laneId, tasks, laneName, reviewersBySquad, onReviewerChange, onPrLinkSave, savingTaskIds,
  pointMappings, onTaskPointChange,
  logFormTaskId, logNormalHours, logOtHours, logSaving, logError,
  onToggleLogForm, onQuickAdd, onNormalHoursChange, onOtHoursChange, onSubmitLog, onCancelLog,
}: {
  laneId: string; tasks: TaskData[]; laneName: string;
  reviewersBySquad: Record<string, Reviewer[]>;
  onReviewerChange: (taskId: string, reviewerId: string | null) => Promise<void>;
  onPrLinkSave: (taskId: string, prLink: string | null) => Promise<{ error: string | null }>;
  savingTaskIds: Set<string>;
  pointMappings: PointMapping[];
  onTaskPointChange: (taskId: string, point: number) => Promise<{ error: string | null }>;
  logFormTaskId: string | null;
  logNormalHours: string;
  logOtHours: string;
  logSaving: boolean;
  logError: string;
  onToggleLogForm: (taskId: string) => void;
  onQuickAdd: (minutes: number) => void;
  onNormalHoursChange: (value: string) => void;
  onOtHoursChange: (value: string) => void;
  onSubmitLog: (taskId: string) => void;
  onCancelLog: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId });
  return (
    <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 overflow-y-auto flex-1 px-0.5 pb-0.5 min-h-[40px] rounded-[3px] transition-colors ${
          isOver ? 'bg-accent/5' : ''
        }`}
      >
        {tasks.map(task => (
          <SortableCard
            key={task.id} task={task} laneName={laneName}
            reviewersBySquad={reviewersBySquad}
            onReviewerChange={onReviewerChange}
            onPrLinkSave={onPrLinkSave}
            saving={savingTaskIds.has(task.id)}
            pointMappings={pointMappings}
            onTaskPointChange={onTaskPointChange}
            logFormOpen={logFormTaskId === task.id}
            logNormalHours={logNormalHours}
            logOtHours={logOtHours}
            logSaving={logSaving}
            logError={logError}
            onToggleLogForm={onToggleLogForm}
            onQuickAdd={onQuickAdd}
            onNormalHoursChange={onNormalHoursChange}
            onOtHoursChange={onOtHoursChange}
            onSubmitLog={onSubmitLog}
            onCancelLog={onCancelLog}
          />
        ))}
      </div>
    </SortableContext>
  );
}

/* ─── Droppable issue section ───────────────────────── */
const ISSUE_DROP_ID = '__issue_section__';

/* closestCorners อย่างเดียวใช้ไม่ได้ — droppable ของแต่ละเลนสูงเกือบเต็มจอ
   (height: calc(100vh - 220px)) ในขณะที่กล่อง "การ์ดที่มีปัญหา" เตี้ยแค่ ~52px
   มุมของเลนที่สูงกว่าจะใกล้เคอร์เซอร์กว่ากล่องเตี้ยๆ นี้เสมอ ทำให้ลากไปวางที่กล่อง
   การ์ดที่มีปัญหาไม่เคยติดเลยไม่ว่าจะเล็งตรงแค่ไหน — เช็คตำแหน่งเคอร์เซอร์จริง
   (pointerWithin) ก่อนเสมอ ถ้าไม่เจอ droppable ไหนตรงๆ ค่อย fallback ไป
   closestCorners (กันเคส sortable ระหว่างการ์ดในเลนเดียวกันที่เคอร์เซอร์อาจ
   หลุดจากทุก rect ชั่วขณะระหว่างลาก) */
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCorners(args);
};
function DroppableIssueSection({
  flaggedTasks, onResolve,
}: { flaggedTasks: TaskData[]; onResolve: (t: TaskData) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: ISSUE_DROP_ID });
  return (
    <div className="bg-danger-bg border border-danger/30 rounded-[4px] p-3 mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[12.5px] font-semibold text-danger">▲ การ์ดที่มีปัญหา</span>
        {flaggedTasks.length > 0 && (
          <span className="text-[11px] text-txt-muted bg-surface-2 px-2 py-0.5 rounded-full">{flaggedTasks.length}</span>
        )}
        <span className="text-[11px] text-txt-muted ml-auto">
          ลากการ์ดมาที่นี่เพื่อ flag ปัญหา · ลากออกเพื่อ resolve
        </span>
      </div>
      <SortableContext items={flaggedTasks.map(t => t.id)} strategy={horizontalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex gap-2.5 flex-wrap min-h-[52px] rounded-[3px] p-1 transition-colors ${
            isOver ? 'bg-danger/25 ring-2 ring-danger' : ''
          } ${flaggedTasks.length === 0 ? 'items-center' : ''}`}
        >
          {flaggedTasks.length === 0 && (
            <span className="text-[12px] text-txt-muted px-1">ลากการ์ดที่มีปัญหามาวางตรงนี้</span>
          )}
          {flaggedTasks.map(t => (
            <SortableFlaggedCard key={t.id} task={t} onResolve={onResolve} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

/* ─── Add-task inline form ───────────────────────────── */
function AddTaskForm({ laneId, squadId, onCreated }: {
  laneId: string; squadId: string | null;
  onCreated: (task: TaskData) => void;
}) {
  const [open, setOpen]   = useState(false);
  const [title, setTitle] = useState('');
  const [taskPoint, setTaskPoint] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const [pointMappings, setPointMappings] = useState<{ id: string; point: number; hours: number }[]>([]);
  useEffect(() => {
    fetch('/api/admin/task-point-mapping').then(r => r.json()).then(setPointMappings);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || taskPoint === '') return;
    setSaving(true);
    const res = await fetch('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, laneId, squadId, taskPoint: Number(taskPoint) }),
    });
    if (res.ok) {
      const task = await res.json();
      onCreated({
        id: task.id, title: task.title, hasIssue: false, order: task.order,
        reviewApprovedAt: null, isCancelled: false, cancelNote: null,
        reviewerId: null, reviewerName: null, prLink: null,
        squadId: task.squadId ?? null, squad: task.squad, assigneeId: null, assignee: task.assignee,
        taskPoint: task.taskPoint ?? null, estimatedHours: task.estimatedHours ?? null,
        totalNormalMin: 0, totalOtMin: 0, isAtRisk: false, riskReason: '',
      });
      setTitle(''); setTaskPoint(''); setOpen(false);
    }
    setSaving(false);
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full text-left text-[12px] text-txt-muted hover:text-txt-secondary hover:bg-surface-2 px-1.5 py-1.5 rounded-[3px] flex items-center gap-1.5 mt-1.5 transition-colors">
      + เพิ่มงาน
    </button>
  );

  return (
    <form onSubmit={submit} className="mt-2">
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="ชื่องาน..."
        className="w-full bg-surface-2 border border-accent text-txt-primary text-[13px] px-2.5 py-2 rounded-[3px] focus:outline-none mb-1.5" />
      <select value={taskPoint} onChange={e => setTaskPoint(e.target.value)}
        className={`w-full bg-surface-2 border text-txt-primary text-[13px] px-2.5 py-2 rounded-[3px] focus:outline-none mb-1.5 ${taskPoint === '' ? 'border-danger/50' : 'border-app-border'}`}>
        <option value="">Task Point — เลือก (จำเป็น)</option>
        {pointMappings.map(p => <option key={p.id} value={p.point}>{p.point} pt ({p.hours} ชม.)</option>)}
      </select>
      <div className="flex gap-1.5">
        <button type="submit" disabled={saving || !title.trim() || taskPoint === ''}
          className="bg-accent text-white text-[12px] px-3 py-1.5 rounded-[3px] disabled:opacity-50">บันทึก</button>
        <button type="button" onClick={() => { setOpen(false); setTitle(''); setTaskPoint(''); }}
          className="text-txt-muted text-[12px] px-2 py-1.5 rounded-[3px] hover:text-txt-secondary">ยกเลิก</button>
      </div>
    </form>
  );
}

/* ─── Protected lane names ───────────────────────────── */
const PROTECTED_LANES = new Set(['To Do', 'In Progress', 'Review', 'Done', 'Cancel']);
/* สัญลักษณ์รูปทรงกำกับสถานะ — ห้ามพึ่งสีเดี่ยวๆ (colorblind-safe), ดู design handoff */
const LANE_GLYPH: Record<string, string> = {
  'To Do': '○', 'In Progress': '◐', 'Review': '◆', 'Done': '✓', 'Cancel': '⊘',
};
/* Left-accent stripe color per lane — same status-color scheme as LANE_GLYPH's
   text-color siblings above, just exposed as a raw value for inline styles. */
const LANE_ACCENT: Record<string, string> = {
  'To Do': 'rgb(var(--text-muted))', 'In Progress': 'rgb(var(--accent))',
  'Review': 'rgb(var(--warning))', 'Done': 'rgb(var(--success))', 'Cancel': 'rgb(var(--danger))',
};
const PROTECTED_TOOLTIP = 'เลนนี้ผูกกับ Squad Board — แก้ไข/ลบไม่ได้';

/* ปิดไว้ชั่วคราว — auto-start timer ตอนลากเข้า In Progress เรียก 2 endpoint
   แยกกัน (timelog/start + reorder) โดยไม่มี transaction ร่วม ถ้า reorder fail
   แต่ timer start สำเร็จ จะเห็น timer เดินแต่การ์ดไม่ขยับ (เจอจริงกับ SR-25877)
   ปิดไว้ก่อนจนกว่าจะรวมเป็น transaction เดียวได้จริง — โค้ดยังเก็บไว้ครบเผื่อใช้อนาคต */
const AUTO_TIMER_ON_DRAG = false;

/* ─── Main board client ─────────────────────────────── */
type Props = {
  boardId: string;
  initialLanes: LaneData[];
  userId: string;
  userSquadId: string | null;
  squadTasks: ProblemTask[];
  canEditLanes: boolean;
  canCreateTask: boolean;
  reviewersBySquad: Record<string, Reviewer[]>;
  pendingReviews: PendingReview[];
  capacityHours: number | null;
  squadName: string | null;
};

export default function MyBoardClient({
  boardId, initialLanes, userSquadId, canEditLanes, canCreateTask,
  reviewersBySquad, pendingReviews: initialPendingReviews, capacityHours, squadName,
}: Props) {
  const [, setLanesState] = useState<LaneData[]>(initialLanes);
  const lanesRef   = useRef<LaneData[]>(initialLanes);
  const preDragRef = useRef<LaneData[]>([]);

  function setLanes(next: LaneData[]) {
    lanesRef.current = next;
    setLanesState(next);
  }
  const lanes = lanesRef.current;

  // initialLanes only feeds useState/useRef on the very first mount — React ignores it on every
  // later render, so edits made elsewhere (e.g. logging time on a task's detail page) never reached
  // this board after navigating back, even once the server sent fresh data. Re-sync whenever the
  // server actually gives us a new snapshot (mount, or any refetch of this route).
  useEffect(() => {
    setLanes(initialLanes);
  }, [initialLanes]);

  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
  const [activeLaneName, setActiveLaneName] = useState<string | undefined>(undefined);
  const [editMode,   setEditMode]   = useState(false);

  /* ── Drag-and-drop save state: per-card "saving" overlay + error/success toast ── */
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(type: 'error' | 'success', message: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message });
    toastTimerRef.current = setTimeout(() => setToast(null), type === 'error' ? 4000 : 2200);
  }

  /* ── Review-block alert state ── */
  const [reviewBlockMsg, setReviewBlockMsg] = useState<string | null>(null);

  /* ── Task Point config (global — ใช้ทำ Point block บนการ์ด) ── */
  const [pointMappings, setPointMappings] = useState<PointMapping[]>([]);
  useEffect(() => {
    fetch('/api/admin/task-point-mapping').then(r => r.json()).then(setPointMappings);
  }, []);

  async function handleTaskPointChange(taskId: string, point: number): Promise<{ error: string | null }> {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskPoint: point }),
    });
    if (res.ok) {
      const updated = await res.json();
      setLanes(lanesRef.current.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === taskId ? { ...t, taskPoint: updated.taskPoint, estimatedHours: updated.estimatedHours } : t
        ),
      })));
      return { error: null };
    }
    return { error: await res.text() };
  }

  /* ── Derived views ──
     งานที่ isCancelled ยังคง hasIssue=true ไว้ (ให้ Squad Board จัดอยู่บัคเก็ต "มีปัญหา" ตามเดิม
     — ดู flag/route.ts) แต่ฝั่ง my-board เองต้องไม่ถือว่ามันเป็น "การ์ดที่มีปัญหา" ที่ยังรอ resolve
     อีกต่อไป — มันจบแล้ว ต้องอยู่ในเลน Cancel ตามปกติ ไม่ใช่ค้างอยู่แถว issue section */
  const flaggedTasks = lanes.flatMap(l => l.tasks.filter(t => t.hasIssue && !t.isCancelled));
  const flaggedIds   = new Set(flaggedTasks.map(t => t.id));
  const normalLanes  = lanes.map(l => ({ ...l, tasks: l.tasks.filter(t => !t.hasIssue || t.isCancelled) }));

  // ── My Load (Board Point Capacity) — รวมทุกเลนยกเว้น Cancel ────────────────────
  function bucketLoad(laneName: string) {
    const laneTasks = lanes.find(l => l.name === laneName)?.tasks ?? [];
    return laneTasks.reduce(
      (acc, t) => ({ hours: acc.hours + (t.estimatedHours ?? 0), points: acc.points + (t.taskPoint ?? 0) }),
      { hours: 0, points: 0 }
    );
  }
  const loadBuckets = {
    done:     bucketLoad('Done'),
    progress: bucketLoad('In Progress'),
    review:   bucketLoad('Review'),
    todo:     bucketLoad('To Do'),
  };
  const cancelLoad = bucketLoad('Cancel');
  const myTotalHours  = loadBuckets.done.hours + loadBuckets.progress.hours + loadBuckets.review.hours + loadBuckets.todo.hours;
  const myTotalPoints = loadBuckets.done.points + loadBuckets.progress.points + loadBuckets.review.points + loadBuckets.todo.points;

  /* ── Resolve modal state ── */
  const [resolveTarget,      setResolveTarget]      = useState<TaskData | null>(null);
  const [resolveDestination, setResolveDestination] = useState<'todo' | 'done' | 'cancel'>('todo');
  const [resolutionNote,     setResolutionNote]     = useState('');
  const [resolveError,       setResolveError]       = useState('');
  const [resolving,          setResolving]          = useState(false);

  /* ── Flag modal state ── */
  const [flagTarget, setFlagTarget] = useState<TaskData | null>(null);
  const [flagNote,   setFlagNote]   = useState('');
  const [flagError,  setFlagError]  = useState('');
  const [flagging,   setFlagging]   = useState(false);

  /* ── Start-timer modal (To Do → In Progress) ── */
  type StartTimerModal = { taskId: string; taskTitle: string; pendingLanes: LaneData[] };
  const [startTimerModal,   setStartTimerModal]   = useState<StartTimerModal | null>(null);
  const [startTimerSaving,  setStartTimerSaving]  = useState(false);

  /* ── Reviewer modal (any → Review) ── */
  type ReviewerModalData = { taskId: string; taskTitle: string; taskSquadId: string; pendingLanes: LaneData[] };
  const [reviewerModal,      setReviewerModal]      = useState<ReviewerModalData | null>(null);
  const [selectedReviewerId, setSelectedReviewerId] = useState<string>('');

  /* ── Time modal (any → Done) — forced once, regardless of whether the task passed through Review ── */
  type DoneTimeModalData = {
    taskId: string; taskTitle: string; pendingLanes: LaneData[]; revertLanes: LaneData[];
    hasTime: boolean; totalNormalMin: number; totalOtMin: number;
    /** Runs on confirm instead of the default saveOrder — used by flows (e.g. issue resolve)
     *  that need to call a different endpoint before the card actually lands in Done. */
    onConfirm?: () => Promise<void>;
  };
  const [doneTimeModal,   setDoneTimeModal]   = useState<DoneTimeModalData | null>(null);
  const [timeMode,        setTimeMode]        = useState<'auto' | 'manual' | null>(null);
  const [normalHrs,   setNormalHrs]   = useState('');
  const [otHrs,       setOtHrs]       = useState('');
  const [timeReplace,     setTimeReplace]     = useState(false);
  const [timeAdded,   setTimeAdded]   = useState(false);
  const [timeSaving,  setTimeSaving]  = useState(false);
  const [timeError,   setTimeError]   = useState('');

  /* ── Manual time-log button (My Board card, In Progress only) ── */
  const [logFormTaskId,  setLogFormTaskId]  = useState<string | null>(null);
  const [logNormalHours, setLogNormalHours] = useState('');
  const [logOtHours,     setLogOtHours]     = useState('');
  const [logSaving,      setLogSaving]      = useState(false);
  const [logError,       setLogError]       = useState('');

  function openLogForm(taskId: string) {
    setLogFormTaskId(prev => (prev === taskId ? null : taskId));
    setLogNormalHours('');
    setLogOtHours('');
    setLogError('');
  }
  function closeLogForm() {
    setLogFormTaskId(null);
    setLogNormalHours('');
    setLogOtHours('');
    setLogError('');
  }
  function quickAddMinutes(minutes: number) {
    setLogNormalHours(prev => {
      const next = (Number(prev || '0') || 0) + minutes / 60;
      return String(Math.round(next * 100) / 100);
    });
  }
  async function submitLog(taskId: string) {
    const n = parseFloat(logNormalHours);
    if (!n || n <= 0) { setLogError('กรุณากรอกชั่วโมงที่ทำงาน'); return; }
    setLogSaving(true);
    setLogError('');
    const otHrsVal = parseFloat(logOtHours) || 0;
    const res = await fetch(`/api/tasks/${taskId}/timelog`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalHours: n, otHours: otHrsVal }),
    });
    if (res.ok) {
      const addedNormalMin = Math.round(n * 60);
      const addedOtMin     = Math.round(otHrsVal * 60);
      setLanes(lanesRef.current.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === taskId
            ? { ...t, totalNormalMin: t.totalNormalMin + addedNormalMin, totalOtMin: t.totalOtMin + addedOtMin }
            : t
        ),
      })));
      closeLogForm();
      showToast('success', `บันทึก ${fmtHM(addedNormalMin + addedOtMin)} ชม. แล้ว (MANUAL)`);
    } else {
      setLogError(await res.text());
    }
    setLogSaving(false);
  }

  /* ── Move-out-of-In-Progress confirm (drag away from the lane loses manual logging) ── */
  type MoveOutOfProgressModalData = {
    taskId: string; taskTitle: string; totalMinutes: number;
    pendingLanes: LaneData[]; revertLanes: LaneData[];
  };
  const [moveOutOfProgressModal, setMoveOutOfProgressModal] = useState<MoveOutOfProgressModalData | null>(null);

  /* ── Pending reviews (I'm the reviewer) ── */
  const [pendingReviewsList, setPendingReviewsList] = useState<PendingReview[]>(initialPendingReviews);
  useEffect(() => {
    setPendingReviewsList(initialPendingReviews);
  }, [initialPendingReviews]);

  /* ── Personal export ── */
  const [showExport,     setShowExport]     = useState(false);
  const [exporting,      setExporting]      = useState(false);
  const [exportMarkdown, setExportMarkdown] = useState<string | null>(null);
  const [exportError,    setExportError]    = useState('');
  const [copied,         setCopied]         = useState(false);

  async function openExport() {
    setExportMarkdown(null);
    setExportError('');
    setShowExport(true);
    setExporting(true);
    const now   = new Date();
    const day   = now.getDay();
    const diff  = day === 0 ? -6 : 1 - day;
    const start = new Date(now); start.setDate(now.getDate() + diff); start.setHours(0, 0, 0, 0);
    const end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    const res = await fetch(
      `/api/reports/personal?weekStart=${start.toISOString()}&weekEnd=${end.toISOString()}`
    );
    if (res.ok) {
      setExportMarkdown(await res.text());
    } else {
      setExportError(await res.text());
    }
    setExporting(false);
  }

  function downloadMarkdown() {
    if (!exportMarkdown) return;
    const blob = new Blob([exportMarkdown], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `my-board-report-${new Date().toISOString().slice(0, 10)}.md`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function copyPlainText() {
    if (!exportMarkdown) return;
    const text = markdownToPlainText(exportMarkdown);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      alert(text);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /* ── Lane management ── */
  const [addingLane,  setAddingLane]  = useState(false);
  const [newLaneName, setNewLaneName] = useState('');
  const [savingLane,  setSavingLane]  = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /* ─── DND handlers ──────────────────────────────────── */
  function onDragStart({ active }: DragStartEvent) {
    const task = lanesRef.current.flatMap(l => l.tasks).find(t => t.id === active.id);
    const lane = lanesRef.current.find(l => l.tasks.some(t => t.id === active.id));
    setActiveTask(task ?? null);
    setActiveLaneName(lane?.name);
    preDragRef.current = JSON.parse(JSON.stringify(lanesRef.current));
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = String(active.id);

    if (flaggedIds.has(activeId)) return;
    if (String(over.id) === ISSUE_DROP_ID) return;

    const current    = lanesRef.current;
    const sourceLane = current.find(l => l.tasks.some(t => t.id === activeId));
    const targetLane = current.find(l => l.id === over.id)
      ?? current.find(l => l.tasks.some(t => t.id === over.id));

    if (!sourceLane || !targetLane || sourceLane.id === targetLane.id) return;

    const task = sourceLane.tasks.find(t => t.id === activeId)!;
    const next = current.map(l => {
      if (l.id === sourceLane.id) return { ...l, tasks: l.tasks.filter(t => t.id !== activeId) };
      if (l.id === targetLane.id) {
        const overIdx = l.tasks.findIndex(t => t.id === over.id);
        const newTasks = [...l.tasks];
        newTasks.splice(overIdx >= 0 ? overIdx : newTasks.length, 0, task);
        return { ...l, tasks: newTasks };
      }
      return l;
    });
    setLanes(next);
  }

  /** ย้ายเลน/reorder จริง — await ผลเสมอ, เช็ค res.ok, rollback + toast ถ้า fail */
  async function saveOrder(
    ls: LaneData[],
    reviewerOverrides?: Record<string, string | null>,
  ): Promise<boolean> {
    const items = ls.flatMap(l => l.tasks.map((t, idx) => {
      const item: { id: string; laneId: string; order: number; reviewerId?: string | null } = {
        id: t.id, laneId: l.id, order: idx,
      };
      if (reviewerOverrides && t.id in reviewerOverrides) {
        item.reviewerId = reviewerOverrides[t.id];
      }
      return item;
    }));
    if (!items.length) return true;

    const movedIds = items.map(i => i.id);
    setSavingTaskIds(prev => {
      const next = new Set(prev);
      movedIds.forEach(id => next.add(id));
      return next;
    });
    try {
      const res = await fetch('/api/tasks/reorder', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        setLanes(preDragRef.current);
        showToast('error', msg || 'ย้ายไม่สำเร็จ — ลองใหม่อีกครั้ง');
        return false;
      }
      return true;
    } catch {
      setLanes(preDragRef.current);
      showToast('error', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
      return false;
    } finally {
      setSavingTaskIds(prev => {
        const next = new Set(prev);
        movedIds.forEach(id => next.delete(id));
        return next;
      });
    }
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null);
    const activeId = String(active.id);

    /* Card dragged out of issue section → resolve modal */
    if (flaggedIds.has(activeId)) {
      const dragged = lanesRef.current.flatMap(l => l.tasks).find(t => t.id === activeId);
      const overId  = String(over?.id ?? '');
      const droppedBackInSection = overId === ISSUE_DROP_ID || flaggedIds.has(overId);
      if (dragged && over && !droppedBackInSection) {
        openResolve(dragged);
      }
      return;
    }

    /* Card dragged into issue section → flag modal */
    if (over?.id === ISSUE_DROP_ID) {
      const task = lanesRef.current.flatMap(l => l.tasks).find(t => t.id === activeId);
      if (task && !task.hasIssue) {
        setFlagTarget(task);
        setFlagNote('');
        setFlagError('');
      }
      return;
    }

    if (!over) return;
    const overId  = String(over.id);
    let current = lanesRef.current;

    /* Review approval guard: Review is opt-in, not mandatory — dragging In Progress → Done
       directly needs no reviewer/approval. Only a task actually leaving the Review lane
       still needs QA_LEAD approval before it can land in Done. */
    const landedLane = current.find(l => l.tasks.some(t => t.id === activeId));
    if (landedLane?.name === 'Done') {
      const task = landedLane.tasks.find(t => t.id === activeId);
      const srcLaneName = preDragRef.current.find(l => l.tasks.some(t => t.id === activeId))?.name;
      if (task?.squad && srcLaneName === 'Review' && !task.reviewApprovedAt) {
        setReviewBlockMsg('ต้องรอ QA_LEAD approve review ก่อนจึงจะย้ายงานไป Done ได้');
        setLanes(preDragRef.current);
        return;
      }
    }

    /* เลน Cancel เข้าได้ทางเดียวผ่าน resolve modal (จาก "การ์ดที่มีปัญหา") เท่านั้น —
       ห้ามลากการ์ดจากเลนอื่นเข้ามาตรงๆ เด็ดขาด เด้งกลับที่เดิมเสมอถ้าใครลอง (server-side
       ก็ validate ซ้ำอีกชั้นใน /api/tasks/reorder กันเคสยิง API ตรงๆ ข้าม UI) */
    if (landedLane?.name === 'Cancel') {
      showToast('error', 'ย้ายเข้าเลน Cancel ตรงๆ ไม่ได้ — ต้องกด "จัดการปัญหานี้" แล้วเลือกปลายทาง Cancel เท่านั้น');
      setLanes(preDragRef.current);
      return;
    }

    /* ── Time tracking intercepts for cross-lane moves ── */
    {
      const preDragSrc = preDragRef.current.find(l => l.tasks.some(t => t.id === activeId));
      const currentDst = current.find(l => l.tasks.some(t => t.id === activeId));
      if (preDragSrc && currentDst && preDragSrc.id !== currentDst.id) {
        const srcName = preDragSrc.name;
        const dstName = currentDst.name;

        if (AUTO_TIMER_ON_DRAG && srcName === 'To Do' && dstName === 'In Progress') {
          const t = current.flatMap(l => l.tasks).find(t => t.id === activeId)!;
          setStartTimerModal({ taskId: activeId, taskTitle: t.title, pendingLanes: current });
          return;
        }

        // Leaving In Progress means the manual "⏱ ลงเวลา" button (In-Progress-only) goes away for
        // this card — warn before it's too late. Review/Done already have their own dedicated gates
        // right below (reviewer picker / forced time entry), so skip this generic warning for those
        // destinations rather than stacking two confirm dialogs on the same drag. Card stays at its
        // dragged-to position while the modal is open — same convention as openDoneTimeModal/
        // reviewerModal below; only an explicit "ยกเลิก"/"ลงเวลาก่อน" reverts it.
        if (srcName === 'In Progress' && dstName !== 'In Progress' && dstName !== 'Review' && dstName !== 'Done') {
          const t = current.flatMap(l => l.tasks).find(t => t.id === activeId)!;
          setMoveOutOfProgressModal({
            taskId: activeId, taskTitle: t.title,
            totalMinutes: t.totalNormalMin + t.totalOtMin,
            pendingLanes: current, revertLanes: preDragRef.current,
          });
          return;
        }

        if (dstName === 'Review') {
          const t = current.flatMap(l => l.tasks).find(t => t.id === activeId)!;

          // Squad tasks: pick a reviewer before entering the lane. Time entry is no
          // longer forced here — it's forced once at Done instead (below), for every
          // task regardless of whether it passed through Review.
          if (t.squadId) {
            setReviewerModal({
              taskId: activeId,
              taskTitle: t.title,
              taskSquadId: t.squadId,
              pendingLanes: current,
            });
            setSelectedReviewerId('');
            return;
          }
          // Personal task (no squad): nothing to gate on entering Review anymore.
        }

        if (dstName === 'Done') {
          const t = current.flatMap(l => l.tasks).find(t => t.id === activeId)!;
          openDoneTimeModal(activeId, t.title, current, preDragRef.current);
          return;
        }

        // ออกจากเลน Review ไปเลนอื่นที่ไม่ใช่ Done (เช่น bounce กลับ In Progress) — server
        // (shouldResetReviewApproval ใน /api/tasks/reorder) reset reviewApprovedAt/reviewerId
        // เสมอในเคสนี้ ต้อง sync local state ด้วย ไม่งั้น banner "Review ผ่านแล้ว" จะค้างอยู่
        if (srcName === 'Review' && dstName !== 'Done') {
          current = current.map(l => ({
            ...l, tasks: l.tasks.map(t =>
              t.id === activeId ? { ...t, reviewApprovedAt: null, reviewerId: null, reviewerName: null } : t
            ),
          }));
          // else-branch below (dropped without reordering within the lane) never calls setLanes
          // on its own — push the reset now so the banner clears immediately, not just on reload
          setLanes(current);
        }
      }
    }

    const lane   = current.find(l => l.tasks.some(t => t.id === activeId));
    if (!lane) return;

    const oldIdx = lane.tasks.findIndex(t => t.id === activeId);
    const newIdx = lane.tasks.findIndex(t => t.id === overId);

    if (oldIdx !== newIdx && newIdx >= 0) {
      const reordered = current.map(l =>
        l.id === lane.id ? { ...l, tasks: arrayMove(l.tasks, oldIdx, newIdx) } : l,
      );
      setLanes(reordered);
      await saveOrder(reordered);
    } else {
      await saveOrder(current);
    }
  }

  /* ─── Flag issue (confirm modal) ─── */
  async function submitFlag() {
    if (!flagNote.trim()) {
      setFlagError('กรุณาอธิบายปัญหาก่อน flag — ห้ามเว้นว่าง');
      return;
    }
    if (!flagTarget) return;
    setFlagging(true);
    const res = await fetch(`/api/tasks/${flagTarget.id}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasIssue: true, issueNote: flagNote.trim() }),
    });
    if (res.ok) {
      setLanes(lanesRef.current.map(l => ({
        ...l, tasks: l.tasks.map(t => t.id === flagTarget.id ? { ...t, hasIssue: true } : t),
      })));
      setFlagTarget(null);
    } else {
      setFlagError(await res.text());
    }
    setFlagging(false);
  }

  /* ─── Resolve issue ─── */
  function openResolve(task: TaskData) {
    setResolveTarget(task);
    setResolutionNote('');
    setResolveError('');
  }

  async function submitResolve() {
    if (!resolutionNote.trim()) {
      setResolveError('กรุณากรอกเหตุผลก่อนยืนยัน — ต้องมีเหตุผลเสมอ ห้ามเว้นว่าง');
      return;
    }
    if (!resolveTarget) return;

    // Resolving straight to Done still needs the forced time-entry gate — same as any other
    // move into Done. The actual /flag call (which clears hasIssue) is deferred into onConfirm
    // so it only fires once time has been logged.
    if (resolveDestination === 'done') {
      const task = resolveTarget;
      const note = resolutionNote.trim();
      setResolveTarget(null);
      openDoneTimeModal(task.id, task.title, lanesRef.current, lanesRef.current, async () => {
        const res = await fetch(`/api/tasks/${task.id}/flag`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hasIssue: false, resolutionNote: note, destination: 'done' }),
        });
        if (res.ok) {
          const doneLane = lanesRef.current.find(l => l.name === 'Done');
          const firstLane = lanesRef.current[0];
          const targetLane = doneLane ?? firstLane;
          const next = lanesRef.current.map(l => {
            const cleaned = l.tasks.filter(t => t.id !== task.id);
            return targetLane && l.id === targetLane.id
              ? { ...l, tasks: [...cleaned, { ...task, hasIssue: false }] }
              : { ...l, tasks: cleaned };
          });
          setLanes(next);
          setResolutionNote('');
          setResolveDestination('todo');
        } else {
          showToast('error', await res.text());
        }
      });
      return;
    }

    setResolving(true);
    const res = await fetch(`/api/tasks/${resolveTarget.id}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasIssue: false, resolutionNote: resolutionNote.trim(), destination: resolveDestination }),
    });
    if (res.ok) {
      const cancelLane = lanesRef.current.find(l => l.name === 'Cancel');
      const firstLane  = lanesRef.current[0];
      const targetLane = resolveDestination === 'cancel' ? (cancelLane ?? firstLane) : firstLane;
      const resolvedTask = resolveDestination === 'cancel'
        ? { ...resolveTarget, isCancelled: true, cancelNote: resolutionNote.trim() } // hasIssue คงเดิม (true)
        : { ...resolveTarget, hasIssue: false };
      const next = lanesRef.current.map(l => {
        const cleaned = l.tasks.filter(t => t.id !== resolveTarget.id);
        if (targetLane && l.id === targetLane.id) {
          return {
            ...l,
            tasks: resolveDestination === 'todo'
              ? [resolvedTask, ...cleaned]  // prepend หัว To Do
              : [...cleaned, resolvedTask], // append ท้าย Cancel
          };
        }
        return { ...l, tasks: cleaned };
      });
      setLanes(next);
      setResolveTarget(null);
      setResolutionNote('');
      setResolveDestination('todo');
    } else {
      setResolveError(await res.text());
    }
    setResolving(false);
  }

  /* ─── Lane management ─── */
  async function submitLane(e: React.FormEvent) {
    e.preventDefault();
    if (!newLaneName.trim()) return;
    setSavingLane(true);
    const res = await fetch('/api/boards/lanes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boardId, name: newLaneName }),
    });
    if (res.ok) {
      const lane = await res.json();
      setLanes([...lanesRef.current, { id: lane.id, name: lane.name, tasks: [] }]);
      setNewLaneName('');
    }
    setSavingLane(false);
  }

  async function deleteLane(laneId: string) {
    const lane = lanesRef.current.find(l => l.id === laneId);
    if (!lane) return;
    if (lane.tasks.length > 0) {
      if (!confirm(`เลน "${lane.name}" มีงานอยู่ ${lane.tasks.length} รายการ — ยืนยันลบเลนพร้อมงานทั้งหมดไหม?`)) return;
    }
    const res = await fetch(`/api/boards/lanes/${laneId}`, { method: 'DELETE' });
    if (res.ok) setLanes(lanesRef.current.filter(l => l.id !== laneId));
  }

  function onTaskCreated(laneId: string, task: TaskData) {
    setLanes(lanesRef.current.map(l => l.id === laneId ? { ...l, tasks: [...l.tasks, task] } : l));
  }

  /* ─── Start-timer modal handlers (dead while AUTO_TIMER_ON_DRAG=false, kept for future re-enable) ─── */
  async function confirmStartTimer() {
    if (!startTimerModal) return;
    setStartTimerSaving(true);
    try {
      const res = await fetch(`/api/tasks/${startTimerModal.taskId}/timelog/start`, { method: 'POST' });
      if (!res.ok) {
        setLanes(preDragRef.current);
        showToast('error', 'เริ่มจับเวลาไม่สำเร็จ — ลองใหม่อีกครั้ง');
        return;
      }
      const ok = await saveOrder(startTimerModal.pendingLanes);
      if (!ok) {
        // รู้ข้อจำกัด: ถ้า reorder fail ตรงนี้ timer ฝั่ง server เริ่มไปแล้ว (คนละ transaction กัน)
        // ต้องรวม transaction ก่อนเปิด AUTO_TIMER_ON_DRAG กลับ — ดูคอมเมนต์ที่ประกาศ flag ด้านบน
        showToast('error', 'ย้ายเลนไม่สำเร็จ (แต่เริ่มจับเวลาไปแล้ว) — ลองลากใหม่อีกครั้ง');
      }
    } finally {
      setStartTimerModal(null);
      setStartTimerSaving(false);
    }
  }
  async function skipStartTimer() {
    if (!startTimerModal) return;
    await saveOrder(startTimerModal.pendingLanes);
    setStartTimerModal(null);
  }

  /* ─── Reviewer modal handlers ─── */
  async function confirmReviewerModal(reviewerId: string | null) {
    if (!reviewerModal) return;
    const { taskId, pendingLanes } = reviewerModal;
    const task = pendingLanes.flatMap(l => l.tasks).find(t => t.id === taskId);
    const squadId = task?.squadId;
    const reviewerName = reviewerId && squadId
      ? (reviewersBySquad[squadId] ?? []).find(r => r.id === reviewerId)?.name ?? null
      : null;
    const ok = await saveOrder(pendingLanes, { [taskId]: reviewerId });
    if (ok) {
      // เข้าเลน Review รอบใหม่เสมอต้อง reset review approval (shouldResetReviewApproval ฝั่ง
      // server ก็ทำแบบนี้ใน /api/tasks/reorder) — ต้อง sync local state ด้วยไม่งั้น banner
      // "Review ผ่านแล้ว" เดิมจะค้างอยู่บนการ์ดทั้งที่ DB reset ไปแล้วจริง
      setLanes(pendingLanes.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === taskId ? { ...t, reviewerId, reviewerName, reviewApprovedAt: null } : t
        ),
      })));
    }
    setReviewerModal(null);
    setSelectedReviewerId('');
  }

  function cancelReviewerModal() {
    setLanes(preDragRef.current);
    setReviewerModal(null);
    setSelectedReviewerId('');
  }

  /* ─── Done-time modal handlers ─── */
  function openDoneTimeModal(
    taskId: string, taskTitle: string, pendingLanes: LaneData[], revertLanes: LaneData[],
    onConfirm?: () => Promise<void>,
  ) {
    const t = pendingLanes.flatMap(l => l.tasks).find(t => t.id === taskId)!;
    setDoneTimeModal({
      taskId, taskTitle, pendingLanes, revertLanes, onConfirm,
      hasTime: t.totalNormalMin > 0 || t.totalOtMin > 0,
      totalNormalMin: t.totalNormalMin, totalOtMin: t.totalOtMin,
    });
    setTimeMode(null); setNormalHrs(''); setOtHrs('');
    setTimeReplace(false); setTimeAdded(false); setTimeError('');
  }

  async function submitTimeAuto() {
    if (!doneTimeModal) return;
    setTimeSaving(true); setTimeError('');
    const res = await fetch(`/api/tasks/${doneTimeModal.taskId}/timelog/stop`, { method: 'POST' });
    if (res.ok) {
      const log = await res.json();
      const updatedLanes = doneTimeModal.pendingLanes.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === doneTimeModal.taskId
            ? { ...t, totalNormalMin: t.totalNormalMin + log.normalMinutes, totalOtMin: t.totalOtMin + log.otMinutes }
            : t
        ),
      }));
      setLanes(updatedLanes);
      setDoneTimeModal(m => m ? { ...m, pendingLanes: updatedLanes, hasTime: true } : m);
      setTimeAdded(true);
    } else {
      setTimeError(
        res.status === 404
          ? 'ไม่มีตัวจับเวลาที่กำลังทำงานอยู่ — กรุณาเลือกบันทึก manual'
          : await res.text()
      );
    }
    setTimeSaving(false);
  }

  async function submitTimeManual() {
    if (!doneTimeModal) return;
    const n = parseFloat(normalHrs);
    if (!n || n <= 0) { setTimeError('กรุณากรอกชั่วโมงที่ทำงาน'); return; }
    setTimeSaving(true); setTimeError('');
    const res = await fetch(`/api/tasks/${doneTimeModal.taskId}/timelog`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalHours: n, otHours: parseFloat(otHrs) || 0, replace: timeReplace }),
    });
    if (res.ok) {
      const log = await res.json();
      const newNormal = timeReplace ? log.normalMinutes : doneTimeModal.totalNormalMin + log.normalMinutes;
      const newOt     = timeReplace ? log.otMinutes    : doneTimeModal.totalOtMin    + log.otMinutes;
      const updatedLanes = doneTimeModal.pendingLanes.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === doneTimeModal.taskId ? { ...t, totalNormalMin: newNormal, totalOtMin: newOt } : t
        ),
      }));
      setLanes(updatedLanes);
      setDoneTimeModal(m => m ? { ...m, pendingLanes: updatedLanes, hasTime: true, totalNormalMin: newNormal, totalOtMin: newOt } : m);
      setNormalHrs(''); setOtHrs('');
      setTimeAdded(true);
    } else {
      setTimeError(await res.text());
    }
    setTimeSaving(false);
  }

  async function proceedToDone() {
    if (doneTimeModal?.onConfirm) {
      await doneTimeModal.onConfirm();
    } else {
      await saveOrder(lanesRef.current);
    }
    setDoneTimeModal(null);
    setTimeMode(null); setTimeAdded(false); setTimeError('');
  }

  function cancelDoneTimeModal() {
    if (doneTimeModal) setLanes(doneTimeModal.revertLanes);
    setDoneTimeModal(null);
    setTimeMode(null); setTimeAdded(false); setTimeError('');
  }

  /* ─── Inline reviewer / PR link handlers (on Review lane cards) ─── */
  async function handleReviewerChange(taskId: string, reviewerId: string | null) {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerId }),
    });
    if (res.ok) {
      const task = lanesRef.current.flatMap(l => l.tasks).find(t => t.id === taskId);
      const squadId = task?.squadId;
      const reviewerName = reviewerId && squadId
        ? (reviewersBySquad[squadId] ?? []).find(r => r.id === reviewerId)?.name ?? null
        : null;
      setLanes(lanesRef.current.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === taskId ? { ...t, reviewerId, reviewerName } : t
        ),
      })));
    }
  }

  async function handlePrLinkSave(taskId: string, prLink: string | null): Promise<{ error: string | null }> {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prLink }),
    });
    if (res.ok) {
      setLanes(lanesRef.current.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === taskId ? { ...t, prLink } : t
        ),
      })));
      return { error: null };
    }
    return { error: await res.text() };
  }

  /* ─── Approve review (from pending review section) ─── */
  async function approveReview(taskId: string) {
    const res = await fetch(`/api/tasks/${taskId}/approve-review`, { method: 'PATCH' });
    if (res.ok) {
      setPendingReviewsList(list => list.filter(r => r.id !== taskId));
      setLanes(lanesRef.current.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === taskId ? { ...t, reviewApprovedAt: new Date().toISOString() } : t
        ),
      })));
    }
  }

  /* ─── Move a review-approved task straight to Done (queue rail quick action) ─── */
  function moveToDone(taskId: string) {
    if (doneTimeModal) return; // guard double-click: modal already gating this move
    const doneLane = lanesRef.current.find(l => l.name === 'Done');
    if (!doneLane) return;
    const revertLanes = lanesRef.current;
    const task = revertLanes.flatMap(l => l.tasks).find(t => t.id === taskId);
    if (!task) return;
    const next = revertLanes.map(l => {
      const cleaned = l.tasks.filter(t => t.id !== taskId);
      return l.id === doneLane.id ? { ...l, tasks: [...cleaned, task] } : { ...l, tasks: cleaned };
    });
    setLanes(next);
    openDoneTimeModal(taskId, task.title, next, revertLanes);
  }

  /* ─── Queue rail data ─────────────────────────────────── */
  const readyTasks   = normalLanes.find(l => l.name === 'Review')?.tasks.filter(t => t.reviewApprovedAt) ?? [];

  /* ─── Render ─────────────────────────────────────────── */
  return (
    <div className="px-7 py-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2.5">
        <h1 className="text-[19px] font-semibold text-txt-primary">บอร์ดของฉัน</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={openExport}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-[3px] hover:bg-surface-3 transition-colors"
          >
            📄 Export Report
          </button>
          {canEditLanes && (
            <button
              onClick={() => { setEditMode(e => !e); setAddingLane(false); }}
              className={`border text-[13px] px-3 py-[7px] rounded-[3px] flex items-center gap-1.5 transition-colors ${
                editMode
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-2 border-app-border text-txt-primary hover:bg-surface-3'
              }`}
            >
              ✎ แก้ไขเลน
            </button>
          )}
          {canCreateTask && (
            <Link href="/tasks"
              className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-3 py-[7px] rounded-[3px] transition-colors">
              + สร้างงานใหม่
            </Link>
          )}
        </div>
      </div>

      <div className="flex gap-4 items-start">
        <QueueRail
          pendingReviews={pendingReviewsList}
          readyTasks={readyTasks}
          onApprove={approveReview}
          onMoveToDone={moveToDone}
        />

        <div className="flex-1 min-w-0">
        <DndContext sensors={sensors} collisionDetection={collisionDetectionStrategy}
          onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>

        {capacityHours !== null && (myTotalHours > 0 || myTotalPoints > 0) && (() => {
          const ratio = myTotalHours / capacityHours;
          const over  = myTotalHours > capacityHours;
          const near  = !over && ratio >= 0.9;
          const statusText  = over ? `เกินเป้า ${myTotalHours - capacityHours} ชม.` : near ? 'ใกล้เต็มโควตา' : 'อยู่ในเป้า';
          const statusColor = over ? 'text-danger' : near ? 'text-accent' : 'text-success';
          const statusBg    = over ? 'bg-danger-bg' : near ? 'bg-accent-bg' : 'bg-success-bg';
          const remain = Math.max(capacityHours - myTotalHours, 0);
          const legend: { label: string; hours: number; points: number; color: string }[] = [
            { label: 'Done',        hours: loadBuckets.done.hours,     points: loadBuckets.done.points,     color: 'bg-success' },
            { label: 'In progress', hours: loadBuckets.progress.hours, points: loadBuckets.progress.points, color: 'bg-accent' },
            { label: 'Review',      hours: loadBuckets.review.hours,   points: loadBuckets.review.points,   color: 'bg-warning' },
            { label: 'To do',       hours: loadBuckets.todo.hours,     points: loadBuckets.todo.points,     color: 'bg-surface-3' },
          ];
          const segPct = (h: number) => `${myTotalHours > 0 ? Math.min(h / Math.max(myTotalHours, capacityHours), 1) * 100 : 0}%`;
          return (
            <div className="bg-surface-1 border border-app-border rounded-[4px] px-4 py-3.5 mb-4 flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <div className="text-[11px] font-semibold tracking-[.08em] text-txt-muted uppercase">
                    โหลดของฉัน{squadName ? ` — ${squadName}` : ''}
                  </div>
                  <div className="flex items-baseline gap-2 whitespace-nowrap">
                    <div className="font-mono text-[24px] font-semibold text-txt-primary leading-none">{myTotalHours}</div>
                    <div className="text-[13px] text-txt-secondary">/ {capacityHours} ชม. · {myTotalPoints} point · <span className="text-success">เสร็จแล้ว {loadBuckets.done.points} PT</span></div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className={`text-[12px] px-2.5 py-1 rounded-full whitespace-nowrap ${statusColor} ${statusBg}`}>{statusText}</span>
                  <span className="text-[12px] text-txt-muted whitespace-nowrap">รับได้อีก {remain} ชม.</span>
                </div>
              </div>

              <div className="flex h-2.5 rounded-md overflow-hidden bg-surface-2">
                {legend.map(seg => seg.hours > 0 && (
                  <div key={seg.label} className={seg.color} style={{ width: segPct(seg.hours) }} />
                ))}
              </div>

              <div className="flex gap-4 flex-wrap text-[11.5px] text-txt-secondary">
                {legend.map(seg => (
                  <div key={seg.label} className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-[2px] ${seg.color}`} />
                    {seg.label} {seg.hours} ชม. · {seg.points} PT
                  </div>
                ))}
                {(cancelLoad.hours > 0 || cancelLoad.points > 0) && (
                  <div className="text-txt-muted">ไม่นับการ์ดที่ยกเลิก ({cancelLoad.points} PT · {cancelLoad.hours} ชม.)</div>
                )}
              </div>
            </div>
          );
        })()}

        <DroppableIssueSection flaggedTasks={flaggedTasks} onResolve={openResolve} />

        <div
          className={`grid gap-3.5 pb-5 items-start ${editMode ? 'edit-mode-on' : ''}`}
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
        >
          {normalLanes.map(lane => (
            <div key={lane.id}
              className={`bg-surface-2 border rounded-[11px] p-2.5 flex flex-col transition-colors overflow-hidden ${
                editMode ? 'border-accent' : 'border-app-border'
              }`}
              style={{ height: 'calc(100vh - 220px)' }}
            >
              <div className="h-[3px] -mx-2.5 -mt-2.5 mb-2.5 flex-shrink-0"
                style={{ background: LANE_ACCENT[lane.name] ?? 'rgb(var(--border))' }} />
              <div className="flex items-center justify-between px-1 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[13px] font-semibold ${
                    lane.name === 'Cancel'      ? 'text-danger'  :
                    lane.name === 'Done'        ? 'text-success' :
                    lane.name === 'Review'      ? 'text-warning' :
                    lane.name === 'In Progress' ? 'text-accent'  :
                    'text-txt-primary'
                  }`}>
                    {LANE_GLYPH[lane.name] && <span className="mr-1">{LANE_GLYPH[lane.name]}</span>}
                    {lane.name}
                  </span>
                  <span className="text-[11px] font-mono text-txt-muted bg-surface-3 px-2 py-0.5 rounded-full">{lane.tasks.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  {lane.name === 'Cancel' ? (
                    <span className="font-mono text-[11px] font-semibold text-txt-muted">ไม่นับโหลด</span>
                  ) : (() => {
                    const sub = lane.tasks.reduce(
                      (acc, t) => ({ hours: acc.hours + (t.estimatedHours ?? 0), points: acc.points + (t.taskPoint ?? 0) }),
                      { hours: 0, points: 0 }
                    );
                    return (sub.hours > 0 || sub.points > 0) ? (
                      <span className="font-mono text-[11px] font-semibold text-txt-secondary">{sub.points} PT · {sub.hours} ชม.</span>
                    ) : null;
                  })()}
                {editMode && (() => {
                  const isProtected = PROTECTED_LANES.has(lane.name);
                  return isProtected ? (
                    <button title={PROTECTED_TOOLTIP} onClick={() => alert(PROTECTED_TOOLTIP)}
                      className="text-txt-muted text-[14px] px-1.5 py-0.5 rounded opacity-35 cursor-not-allowed">✕</button>
                  ) : (
                    <button onClick={() => deleteLane(lane.id)}
                      className="text-danger text-[14px] px-1.5 py-0.5 rounded hover:bg-danger-bg transition-colors">✕</button>
                  );
                })()}
                </div>
              </div>
              <DroppableLaneCards
                laneId={lane.id}
                tasks={lane.tasks}
                laneName={lane.name}
                reviewersBySquad={reviewersBySquad}
                onReviewerChange={handleReviewerChange}
                onPrLinkSave={handlePrLinkSave}
                savingTaskIds={savingTaskIds}
                pointMappings={pointMappings}
                onTaskPointChange={handleTaskPointChange}
                logFormTaskId={logFormTaskId}
                logNormalHours={logNormalHours}
                logOtHours={logOtHours}
                logSaving={logSaving}
                logError={logError}
                onToggleLogForm={openLogForm}
                onQuickAdd={quickAddMinutes}
                onNormalHoursChange={setLogNormalHours}
                onOtHoursChange={setLogOtHours}
                onSubmitLog={submitLog}
                onCancelLog={closeLogForm}
              />
              {lane.name === 'To Do' && (
                <AddTaskForm laneId={lane.id} squadId={userSquadId} onCreated={t => onTaskCreated(lane.id, t)} />
              )}
            </div>
          ))}

          {editMode && (
            addingLane ? (
              <form onSubmit={submitLane}
                className="bg-surface-2 border border-accent rounded-[11px] p-3">
                <input autoFocus value={newLaneName} onChange={e => setNewLaneName(e.target.value)}
                  placeholder="ชื่อเลนใหม่..."
                  className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-2 rounded-[3px] focus:outline-none focus:border-accent mb-2" />
                <button type="submit" disabled={savingLane || !newLaneName.trim()}
                  className="w-full bg-accent text-white text-[12px] py-1.5 rounded-[3px] disabled:opacity-50">
                  + เพิ่มเลนนี้
                </button>
              </form>
            ) : (
              <button onClick={() => setAddingLane(true)}
                className="border-[1.5px] border-dashed border-accent rounded-[11px] flex items-center justify-center gap-1.5 text-[13px] text-accent h-11 hover:bg-accent/5 transition-colors">
                + เพิ่มเลน
              </button>
            )
          )}

          {!editMode && (
            <button onClick={() => setEditMode(true)}
              className="border-[1.5px] border-dashed border-app-border rounded-[11px] flex items-center justify-center gap-1.5 text-[13px] text-txt-muted hover:border-accent hover:text-accent transition-colors h-11">
              + เพิ่มเลน
            </button>
          )}
        </div>

        {editMode && (
          <button onClick={() => { setEditMode(false); setAddingLane(false); }}
            className="mt-2 bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-[3px] hover:bg-surface-3 transition-colors">
            ✓ เสร็จสิ้นการแก้ไข
          </button>
        )}

        <DragOverlay>
          {activeTask && <SortableCard task={activeTask} laneName={activeLaneName} overlay />}
        </DragOverlay>
        </DndContext>
        </div>
      </div>

      {/* ── Review block alert ────────────────────────── */}
      {reviewBlockMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-warning/40 rounded-[4px] p-5 w-[380px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-warning mb-2">⚠ ยังไม่ผ่าน Review</h3>
            <p className="text-[13px] text-txt-secondary mb-4">{reviewBlockMsg}</p>
            <button
              onClick={() => setReviewBlockMsg(null)}
              className="w-full bg-accent hover:bg-accent-hover text-white text-[13px] font-medium py-2 rounded-[3px] transition-colors"
            >
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Flag issue ─────────────────────────── */}
      {flagTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[400px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-danger mb-1">▲ รายงานปัญหา</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">
              <span className="font-medium text-txt-primary">{flagTarget.title}</span>
              <br />งานนี้จะถูก flag และขึ้นสถานะ "มีปัญหา" บน Squad Board ทันที
            </p>
            <label className="block text-[12px] text-txt-secondary mb-1.5">
              อธิบายปัญหา <span className="text-danger">(จำเป็นต้องกรอก)</span>
            </label>
            <textarea
              autoFocus
              value={flagNote}
              onChange={e => setFlagNote(e.target.value)}
              placeholder="เช่น พบ bug ที่ทำให้ระบบ crash เมื่อ input ว่าง"
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-[3px] focus:outline-none focus:border-accent resize-y min-h-[80px] font-inherit"
            />
            {flagError && <p className="text-[11.5px] text-danger mt-2">{flagError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setFlagTarget(null)}
                disabled={flagging}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitFlag}
                disabled={flagging || !flagNote.trim()}
                className={`bg-danger hover:bg-danger/80 text-white text-[12.5px] font-medium px-4 py-2 rounded-[3px] disabled:opacity-50 transition-colors ${flagging ? 'btn-loading' : ''}`}
              >
                ▲ Flag ปัญหานี้
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Start timer (To Do → In Progress) ──────── */}
      {startTimerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[420px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-1">▶ เริ่มบันทึกเวลา?</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">
              งาน <span className="font-medium text-txt-primary">"{startTimerModal.taskTitle}"</span>{' '}
              กำลังย้ายไป <span className="text-accent">In Progress</span><br />
              ต้องการให้ระบบเริ่มจับเวลาอัตโนมัติไหม?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={skipStartTimer} disabled={startTimerSaving}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors">
                ข้าม — ย้ายโดยไม่จับเวลา
              </button>
              <button onClick={confirmStartTimer} disabled={startTimerSaving}
                className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-[3px] disabled:opacity-50 transition-colors">
                {startTimerSaving ? 'กำลังเริ่ม...' : '▶ เริ่มจับเวลา'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: leaving In Progress (design handoff: manual time-log) ──── */}
      {moveOutOfProgressModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="max-w-[360px] w-full bg-surface-1 border border-app-border rounded-md p-4 flex flex-col gap-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.5)]">
            <h3 className="text-[13px] font-bold text-txt-primary">ย้ายออกจาก In Progress?</h3>
            <p className="text-xs leading-[1.5] text-txt-secondary">
              การ์ด "{moveOutOfProgressModal.taskTitle}" ลงเวลาไว้ {fmtHM(moveOutOfProgressModal.totalMinutes)} ชม.
              หลังย้ายออกจากเลนนี้จะลงเวลาเพิ่มไม่ได้
            </p>
            <div className="flex flex-col gap-1.5 mt-1">
              <button
                onClick={() => {
                  const { taskId, revertLanes } = moveOutOfProgressModal;
                  setLanes(revertLanes);
                  setMoveOutOfProgressModal(null);
                  openLogForm(taskId);
                }}
                className="h-[30px] bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium rounded-[3px] transition-colors"
              >
                ลงเวลาก่อน
              </button>
              <button
                onClick={async () => {
                  const { pendingLanes } = moveOutOfProgressModal;
                  setMoveOutOfProgressModal(null);
                  await saveOrder(pendingLanes);
                }}
                className="h-[30px] bg-warning-bg text-warning border border-warning/35 text-[12.5px] font-medium rounded-[3px] transition-colors"
              >
                ย้ายเลย
              </button>
              <button
                onClick={() => {
                  setLanes(moveOutOfProgressModal.revertLanes);
                  setMoveOutOfProgressModal(null);
                }}
                className="h-[30px] border border-app-border text-txt-secondary text-[12.5px] rounded-[3px] hover:bg-surface-2 transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Select reviewer (before Review lane) ──── */}
      {reviewerModal && (() => {
        const options = (reviewersBySquad[reviewerModal.taskSquadId] ?? []).filter(r => {
          const task = lanesRef.current.flatMap(l => l.tasks).find(t => t.id === reviewerModal.taskId);
          return r.id !== task?.assigneeId;
        });
        const hasOptions = options.length > 0;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
            <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[400px] shadow-xl">
              {hasOptions ? (
                <>
                  <h3 className="text-[15px] font-semibold text-txt-primary mb-1">🔍 เลือกผู้รับ Review</h3>
                  <p className="text-[12.5px] text-txt-secondary mb-4">
                    งาน <span className="font-medium text-txt-primary">"{reviewerModal.taskTitle}"</span>{' '}
                    กำลังเข้าเลน Review — เลือกผู้ที่จะ review งานนี้
                  </p>
                  <label className="block text-[12px] text-txt-secondary mb-1.5">ผู้ review</label>
                  <select
                    value={selectedReviewerId}
                    onChange={e => setSelectedReviewerId(e.target.value)}
                    className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-[3px] focus:outline-none focus:border-accent mb-4"
                  >
                    <option value="">— เลือกผู้ review —</option>
                    {options.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelReviewerModal}
                      className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors">
                      ยกเลิก
                    </button>
                    <button
                      onClick={() => confirmReviewerModal(selectedReviewerId || null)}
                      className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-[3px] transition-colors"
                    >
                      ยืนยัน →
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-[15px] font-semibold text-txt-primary mb-1">🔍 ไม่มี reviewer ในทีม</h3>
                  <p className="text-[12.5px] text-txt-secondary mb-4">
                    ไม่พบ QA Lead หรือสมาชิก Floating Pool ที่สามารถ review งานนี้ได้<br />
                    ต้องการเข้า Review โดยไม่กำหนด reviewer?
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelReviewerModal}
                      className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors">
                      ยกเลิก
                    </button>
                    <button onClick={() => confirmReviewerModal(null)}
                      className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-[3px] transition-colors">
                      เข้า Review โดยไม่เลือก reviewer
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Modal: Record time before Done ────────────── */}
      {doneTimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[450px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-1">⏱ บันทึกเวลาก่อนปิดงาน (Done)</h3>
            <p className="text-[12.5px] text-txt-secondary mb-2">
              งาน <span className="font-medium text-txt-primary">"{doneTimeModal.taskTitle}"</span>
            </p>

            {doneTimeModal.hasTime && !timeAdded && (
              <div className="flex items-center gap-2 text-[12px] text-success bg-success/8 border border-success/25 px-3 py-2 rounded-[3px] mb-3">
                <span>✓ เวลาที่บันทึกแล้ว:</span>
                <span className="font-medium">{fmt(doneTimeModal.totalNormalMin)}</span>
                {doneTimeModal.totalOtMin > 0 && (
                  <span className="text-warning">+OT {fmt(doneTimeModal.totalOtMin)}</span>
                )}
                <span className="text-txt-muted ml-auto">· เพิ่มเวลาได้ถ้าต้องการ</span>
              </div>
            )}

            {timeAdded && (
              <div className="text-[12px] text-success bg-success/8 border border-success/25 px-3 py-2 rounded-[3px] mb-3">
                ✓ บันทึกเวลาเรียบร้อย — กดยืนยันเพื่อย้ายงานไป Done
              </div>
            )}

            {!timeAdded && (
              <div className="mb-3">
                <p className="text-[11.5px] text-txt-muted mb-2.5">
                  {doneTimeModal.hasTime ? 'เพิ่มเวลาเพิ่มเติม (ไม่บังคับ):' : <>กรุณาเลือกวิธีบันทึกเวลา <span className="text-danger">(จำเป็น)</span></>}
                </p>

                <div className="flex flex-col gap-2 mb-3">
                  <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-[3px] border cursor-pointer transition-colors ${
                    timeMode === 'auto' ? 'border-accent bg-accent/5' : 'border-app-border hover:border-accent/50'
                  }`}>
                    <input type="radio" name="revMode" value="auto" checked={timeMode === 'auto'}
                      onChange={() => { setTimeMode('auto'); setTimeError(''); }} className="mt-0.5 accent-accent" />
                    <div>
                      <p className="text-[12.5px] text-txt-primary">⏹ หยุดตัวจับเวลา (บันทึกอัตโนมัติ)</p>
                      <p className="text-[11px] text-txt-muted">หยุดการนับเวลาที่กำลังทำงานอยู่และบันทึกเวลาที่ผ่านมา</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-[3px] border cursor-pointer transition-colors ${
                    timeMode === 'manual' ? 'border-accent bg-accent/5' : 'border-app-border hover:border-accent/50'
                  }`}>
                    <input type="radio" name="revMode" value="manual" checked={timeMode === 'manual'}
                      onChange={() => { setTimeMode('manual'); setTimeError(''); }} className="mt-0.5 accent-accent" />
                    <span className="text-[12.5px] text-txt-primary">✎ บันทึกเวลา manual</span>
                  </label>
                </div>

                {timeMode === 'auto' && (
                  <button onClick={submitTimeAuto} disabled={timeSaving}
                    className="w-full bg-accent/10 border border-accent/40 text-accent text-[12.5px] py-2 rounded-[3px] hover:bg-accent/20 transition-colors disabled:opacity-50">
                    {timeSaving ? 'กำลังบันทึก...' : '⏹ หยุดและบันทึกเวลา'}
                  </button>
                )}

                {timeMode === 'manual' && (
                  <div className="flex flex-col gap-2">
                    {doneTimeModal.hasTime && (
                      <div className="flex gap-4 px-1">
                        <label className="flex items-center gap-1.5 text-[12px] text-txt-secondary cursor-pointer">
                          <input type="radio" name="revManualMode" checked={!timeReplace}
                            onChange={() => setTimeReplace(false)} className="accent-accent" />
                          เพิ่มเติม (บวกกับเวลาเดิม)
                        </label>
                        <label className="flex items-center gap-1.5 text-[12px] text-txt-secondary cursor-pointer">
                          <input type="radio" name="revManualMode" checked={timeReplace}
                            onChange={() => setTimeReplace(true)} className="accent-accent" />
                          แทนที่เวลาเดิม
                        </label>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-[11px] text-txt-muted mb-1">Normal (ชม.)</label>
                        <input type="number" min="0.25" step="0.25" autoFocus
                          value={normalHrs} onChange={e => setNormalHrs(e.target.value)}
                          placeholder="เช่น 2.5"
                          className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-[3px] focus:outline-none focus:border-accent" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[11px] text-txt-muted mb-1">OT (ชม.) — ไม่บังคับ</label>
                        <input type="number" min="0" step="0.25"
                          value={otHrs} onChange={e => setOtHrs(e.target.value)}
                          placeholder="0"
                          className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-[3px] focus:outline-none focus:border-accent" />
                      </div>
                    </div>
                    <button onClick={submitTimeManual} disabled={timeSaving || !normalHrs}
                      className="w-full bg-accent/10 border border-accent/40 text-accent text-[12.5px] py-2 rounded-[3px] hover:bg-accent/20 transition-colors disabled:opacity-50">
                      {timeSaving ? 'กำลังบันทึก...' : '✎ บันทึกเวลา'}
                    </button>
                  </div>
                )}

                {timeError && <p className="text-[11.5px] text-danger mt-2">{timeError}</p>}
              </div>
            )}

            <div className="flex gap-2 justify-end mt-1">
              <button onClick={cancelDoneTimeModal}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors">
                ยกเลิก
              </button>
              {doneTimeModal.hasTime && !timeAdded && (
                <button onClick={proceedToDone}
                  className="px-4 py-2 text-[12.5px] text-txt-secondary hover:text-txt-primary border border-app-border rounded-[3px] transition-colors">
                  ข้าม — ย้ายงานเลย
                </button>
              )}
              <button onClick={proceedToDone}
                disabled={!doneTimeModal.hasTime && !timeAdded}
                className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-[3px] disabled:opacity-50 transition-colors">
                ยืนยันและย้ายงาน →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Resolve issue ───────────────────────── */}
      {resolveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-[4px] p-5 w-[400px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-success mb-1">จัดการการ์ดที่มีปัญหา</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">เลือกว่าจะย้ายงานนี้ไปไหนหลังปลด flag ปัญหาออก</p>

            {/* Destination radio */}
            <label className="block text-[12px] text-txt-secondary mb-2">ย้ายกลับไปที่</label>
            <div className="flex flex-col gap-2 mb-4">
              {([
                { v: 'todo' as const,   label: 'To Do',       hint: 'ต้องทำงานต่อ / ต้องผ่าน review ใหม่ตามปกติ' },
                { v: 'done' as const,   label: 'Done',        hint: 'แก้บั๊กเสร็จสมบูรณ์แล้ว ไม่ต้อง review ซ้ำ' },
                { v: 'cancel' as const, label: '🚫 Cancel',   hint: 'เปิดผิด/เปิดซ้ำ ไม่ต้องทำต่อเลย ย้ายเข้าเลน Cancel' },
              ]).map(({ v, label, hint }) => (
                <label key={v} className={`flex items-start gap-2.5 border rounded-[3px] px-3 py-2.5 cursor-pointer transition-colors text-[12px] leading-[1.5] ${
                  resolveDestination === v
                    ? 'border-accent bg-accent/10 text-txt-primary'
                    : 'border-app-border bg-surface-2 text-txt-secondary hover:border-[#B4BCC8]'
                }`}>
                  <input
                    type="radio"
                    name="resolveDestination"
                    value={v}
                    checked={resolveDestination === v}
                    onChange={() => setResolveDestination(v)}
                    className="accent-accent mt-0.5 flex-shrink-0"
                  />
                  <span><b className="text-txt-primary">{label}</b> — {hint}</span>
                </label>
              ))}
            </div>

            <label className="block text-[12px] text-txt-secondary mb-1.5">
              อธิบายเหตุผล (จำเป็นต้องกรอกเสมอ ไม่ว่าจะเลือกปลายทางไหน — เช่น วิธีแก้บั๊ก หรือเหตุผลที่ยกเลิก)
              <span className="text-danger"> (จำเป็นต้องกรอก)</span>
            </label>
            <textarea
              value={resolutionNote}
              onChange={e => setResolutionNote(e.target.value)}
              placeholder="เช่น เพิ่ม null check ก่อน call ฟังก์ชัน แก้ปัญหา crash เมื่อ state เป็น undefined"
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-[3px] focus:outline-none focus:border-accent resize-y min-h-[80px] font-inherit"
            />
            {resolveError && <p className="text-[11.5px] text-danger mt-2">{resolveError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => { setResolveTarget(null); setResolutionNote(''); setResolveDestination('todo'); }}
                disabled={resolving}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-[3px] transition-colors">
                ยกเลิก
              </button>
              <button onClick={submitResolve} disabled={resolving || !resolutionNote.trim()}
                className={`bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-[3px] disabled:opacity-50 transition-colors ${resolving ? 'btn-loading' : ''}`}>
                {resolveDestination === 'done' ? 'ยืนยันและย้ายไป Done'
                  : resolveDestination === 'cancel' ? 'ยืนยันและยกเลิกงานนี้'
                  : 'ยืนยันและกลับไป To Do'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Export modal ── */}
      {showExport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setShowExport(false); }}
        >
          <div className="bg-surface-1 border border-app-border rounded-[4px] w-full max-w-2xl max-h-[90vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
              <div>
                <h2 className="text-[15px] font-semibold text-txt-primary">📄 Export Report (บอร์ดของฉัน)</h2>
                <p className="text-[12px] text-txt-muted mt-0.5">สรุปงานส่วนตัว — สัปดาห์ปัจจุบัน</p>
              </div>
              <button onClick={() => setShowExport(false)} className="text-txt-muted hover:text-txt-primary text-lg leading-none">✕</button>
            </div>

            {exporting && (
              <div className="flex items-center gap-2.5 px-5 py-6 text-[13px] text-txt-secondary">
                <span className="animate-spin inline-block w-4 h-4 border-2 border-accent border-t-transparent rounded-full" />
                กำลังสร้างรายงาน...
              </div>
            )}

            {exportError && <p className="px-5 py-3 text-[12.5px] text-danger">{exportError}</p>}

            {exportMarkdown && (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <div dangerouslySetInnerHTML={{ __html: renderReportMarkdown(exportMarkdown) }} />
                </div>
                <div className="px-5 py-3 border-t border-app-border flex items-center gap-2.5">
                  <button onClick={downloadMarkdown}
                    className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-[7px] rounded-[3px] transition-colors">
                    ⬇ ดาวน์โหลด .md
                  </button>
                  <button onClick={copyPlainText}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-4 py-[7px] rounded-[3px] hover:bg-surface-3 transition-colors">
                    {copied ? '✅ คัดลอกแล้ว!' : '📋 Copy เป็นข้อความ'}
                  </button>
                  <button onClick={() => window.print()}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-4 py-[7px] rounded-[3px] hover:bg-surface-3 transition-colors">
                    🖨 พิมพ์ / บันทึก PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Drag-and-drop save toast ── */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[60] px-4 py-2.5 rounded-[3px] shadow-xl text-[12.5px] font-medium text-white ${
            toast.type === 'error' ? 'bg-danger' : 'bg-success'
          }`}
        >
          {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.message}
        </div>
      )}

    </div>
  );
}
