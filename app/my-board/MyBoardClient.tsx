'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent,
  PointerSensor, closestCorners, useSensor, useSensors, useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable,
  verticalListSortingStrategy, horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { fmt, initials, avatarColor, renderReportMarkdown, markdownToPlainText } from '@/lib/ui';

/* ─── Types ─────────────────────────────────────────── */
type TaskData = {
  id: string; title: string; hasIssue: boolean; order: number;
  reviewApprovedAt: string | null;
  requiresReview: boolean;
  isCancelled: boolean;
  cancelNote: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  prLink: string | null;
  squad: { name: string } | null;
  squadId: string | null;
  assignee: { name: string } | null;
  assigneeId: string | null;
  totalNormalMin: number; totalOtMin: number;
  isAtRisk: boolean; riskReason: string;
};
type LaneData = { id: string; name: string; tasks: TaskData[] };

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

/* ─── Pending review section ─────────────────────────── */
function PendingReviewSection({
  reviews, onApprove,
}: { reviews: PendingReview[]; onApprove: (taskId: string) => Promise<void> }) {
  const [approving, setApproving] = useState<string | null>(null);
  if (reviews.length === 0) return null;
  return (
    <div className="bg-[#111d2e] border border-accent/30 rounded-xl p-3 mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[12.5px] font-semibold text-accent">🔍 รอฉัน Review</span>
        <span className="text-[11px] text-txt-muted bg-surface-2 px-2 py-0.5 rounded-full">{reviews.length}</span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {reviews.map(r => (
          <div key={r.id} className="bg-surface-2 border border-accent/20 rounded-lg p-2.5 w-[240px] flex-shrink-0">
            <Link href={`/tasks/${r.id}`}
              className="block text-[12.5px] text-txt-primary mb-1 hover:text-accent transition-colors leading-snug">
              {r.title}
            </Link>
            {r.squad && <p className="text-[10.5px] text-txt-muted mb-0.5">{r.squad.name}</p>}
            {r.assignee && <p className="text-[10.5px] text-txt-secondary mb-2">ผู้ทำ: {r.assignee.name}</p>}
            {r.prLink ? (
              <a href={r.prLink} target="_blank" rel="noopener noreferrer"
                className="block text-[10.5px] text-accent underline truncate mb-2" title={r.prLink}>
                {r.prLink}
              </a>
            ) : (
              <p className="text-[10.5px] text-txt-muted italic mb-2">ไม่มี PR link แนบมา</p>
            )}
            <button
              disabled={approving === r.id}
              onClick={async () => {
                setApproving(r.id);
                await onApprove(r.id);
                setApproving(null);
              }}
              className="w-full bg-success/10 border border-success/30 text-success text-[11px] py-1.5 rounded-md hover:bg-success/20 disabled:opacity-50 transition-colors font-medium"
            >
              {approving === r.id ? '...' : '✓ Approve Review'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Sortable card (normal lane) ────────────────────── */
function SortableCard({
  task, overlay = false, laneName, reviewersBySquad, onReviewerChange, onPrLinkSave, saving = false,
}: {
  task: TaskData; overlay?: boolean; laneName?: string;
  reviewersBySquad?: Record<string, Reviewer[]>;
  onReviewerChange?: (taskId: string, reviewerId: string | null) => Promise<void>;
  onPrLinkSave?: (taskId: string, prLink: string | null) => Promise<{ error: string | null }>;
  saving?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: saving || task.isCancelled });

  const av = task.assignee ? avatarColor(task.assignee.name) : null;
  const normalFmt = fmt(task.totalNormalMin);
  const otFmt     = fmt(task.totalOtMin);

  const isReviewLane = laneName === 'Review' && !overlay;
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

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes} {...listeners}
      className={`bg-surface-2 border rounded-lg p-2.5 transition-colors select-none relative
        ${task.isCancelled ? 'grayscale-[0.4] opacity-75 cursor-default' : 'cursor-grab active:cursor-grabbing'}
        ${task.hasIssue && !task.isCancelled ? 'border-danger/40' : task.isAtRisk ? 'border-warning/40' : 'border-app-border'}
        ${isDragging && !overlay ? 'opacity-40' : ''}
        ${overlay ? 'shadow-xl rotate-1' : 'hover:border-[#3a3f4d]'}
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
        <span className="absolute top-1.5 right-1.5 text-[12px] leading-none pointer-events-none z-10" title={task.riskReason}>🔥</span>
      )}
      <Link
        href={`/tasks/${task.id}`}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        className="block text-[13px] text-txt-primary leading-snug mb-2 flex items-start gap-1.5 hover:text-accent transition-colors"
      >
        {task.hasIssue && !task.isCancelled && <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 mt-[5px]" />}
        {task.reviewApprovedAt && <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0 mt-[5px]" title="Review ผ่านแล้ว — ย้ายไป Done ได้" />}
        {task.title}
      </Link>
      <div className="flex items-center justify-between">
        {task.squad
          ? <span className="text-[10.5px] text-txt-secondary bg-[#2a2e3a] px-2 py-0.5 rounded-full">{task.squad.name}</span>
          : <span />}
        {av && task.assignee && (
          <div className="w-[19px] h-[19px] rounded-full text-[9px] font-semibold flex items-center justify-center flex-shrink-0"
            style={{ background: av.bg, color: av.fg }}>
            {initials(task.assignee.name)}
          </div>
        )}
      </div>
      {(normalFmt || otFmt) && (
        <div className={`text-[11px] mt-1.5 flex items-center gap-1 ${otFmt ? 'text-warning' : 'text-txt-secondary'}`}>
          {normalFmt && <span>รวม {normalFmt}</span>}
          {otFmt     && <span>· OT {otFmt}</span>}
        </div>
      )}
      {task.isCancelled && task.cancelNote && (
        <div className="text-[10.5px] text-danger mt-1.5 leading-relaxed">
          🚫 ยกเลิก: {task.cancelNote}
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
                className="w-full bg-surface-1 border border-app-border text-txt-primary text-[11px] px-1.5 py-1 rounded-md focus:outline-none focus:border-accent disabled:opacity-50 cursor-pointer"
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
                className="w-full bg-surface-1 border border-app-border text-txt-primary text-[11px] px-1.5 py-1 rounded-md focus:outline-none focus:border-accent placeholder-txt-muted"
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
      className={`bg-surface-2 border border-danger/45 rounded-lg p-2.5 w-[220px] flex-shrink-0 cursor-grab active:cursor-grabbing select-none ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <Link
        href={`/tasks/${task.id}`}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        className="block text-[12.5px] text-txt-primary mb-1 flex items-start gap-1.5 hover:text-accent transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 mt-[5px]" />
        {task.title}
      </Link>
      {task.squad && <p className="text-[10.5px] text-txt-muted mb-2">{task.squad.name}</p>}
      <button
        onClick={e => { e.stopPropagation(); onResolve(task); }}
        onPointerDown={e => e.stopPropagation()}
        className="w-full bg-surface-3 text-success text-[11px] py-1.5 rounded-md hover:bg-success-bg font-medium transition-colors"
      >
        ✓ จัดการปัญหานี้
      </button>
    </div>
  );
}

/* ─── Droppable lane card area ──────────────────────── */
function DroppableLaneCards({
  laneId, tasks, laneName, reviewersBySquad, onReviewerChange, onPrLinkSave, savingTaskIds,
}: {
  laneId: string; tasks: TaskData[]; laneName: string;
  reviewersBySquad: Record<string, Reviewer[]>;
  onReviewerChange: (taskId: string, reviewerId: string | null) => Promise<void>;
  onPrLinkSave: (taskId: string, prLink: string | null) => Promise<{ error: string | null }>;
  savingTaskIds: Set<string>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId });
  return (
    <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 overflow-y-auto flex-1 px-0.5 pb-0.5 min-h-[40px] rounded-lg transition-colors ${
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
          />
        ))}
      </div>
    </SortableContext>
  );
}

/* ─── Droppable issue section ───────────────────────── */
const ISSUE_DROP_ID = '__issue_section__';
function DroppableIssueSection({
  flaggedTasks, onResolve,
}: { flaggedTasks: TaskData[]; onResolve: (t: TaskData) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: ISSUE_DROP_ID });
  return (
    <div className="bg-danger-bg border border-danger/30 rounded-xl p-3 mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[12.5px] font-semibold text-danger">⚠ การ์ดที่มีปัญหา</span>
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
          className={`flex gap-2.5 flex-wrap min-h-[52px] rounded-lg p-1 transition-colors ${
            isOver ? 'bg-danger/8' : ''
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
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch('/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, laneId, squadId }),
    });
    if (res.ok) {
      const task = await res.json();
      onCreated({
        id: task.id, title: task.title, hasIssue: false, order: task.order,
        reviewApprovedAt: null, requiresReview: true, isCancelled: false, cancelNote: null,
        reviewerId: null, reviewerName: null, prLink: null,
        squadId: task.squadId ?? null, squad: task.squad, assigneeId: null, assignee: task.assignee,
        totalNormalMin: 0, totalOtMin: 0, isAtRisk: false, riskReason: '',
      });
      setTitle(''); setOpen(false);
    }
    setSaving(false);
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="w-full text-left text-[12px] text-txt-muted hover:text-txt-secondary hover:bg-surface-2 px-1.5 py-1.5 rounded-md flex items-center gap-1.5 mt-1.5 transition-colors">
      + เพิ่มงาน
    </button>
  );

  return (
    <form onSubmit={submit} className="mt-2">
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="ชื่องาน..."
        className="w-full bg-surface-2 border border-accent text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none mb-1.5" />
      <div className="flex gap-1.5">
        <button type="submit" disabled={saving || !title.trim()}
          className="bg-accent text-white text-[12px] px-3 py-1.5 rounded-md disabled:opacity-50">บันทึก</button>
        <button type="button" onClick={() => { setOpen(false); setTitle(''); }}
          className="text-txt-muted text-[12px] px-2 py-1.5 rounded-md hover:text-txt-secondary">ยกเลิก</button>
      </div>
    </form>
  );
}

/* ─── Protected lane names ───────────────────────────── */
const PROTECTED_LANES = new Set(['To Do', 'In Progress', 'Review', 'Done', 'Cancel']);
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
};

export default function MyBoardClient({
  boardId, initialLanes, userSquadId, canEditLanes, canCreateTask,
  reviewersBySquad, pendingReviews: initialPendingReviews,
}: Props) {
  const [, setLanesState] = useState<LaneData[]>(initialLanes);
  const lanesRef   = useRef<LaneData[]>(initialLanes);
  const preDragRef = useRef<LaneData[]>([]);

  function setLanes(next: LaneData[]) {
    lanesRef.current = next;
    setLanesState(next);
  }
  const lanes = lanesRef.current;

  const [activeTask, setActiveTask] = useState<TaskData | null>(null);
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

  /* ── Derived views ── */
  const flaggedTasks = lanes.flatMap(l => l.tasks.filter(t => t.hasIssue));
  const flaggedIds   = new Set(flaggedTasks.map(t => t.id));
  const normalLanes  = lanes.map(l => ({ ...l, tasks: l.tasks.filter(t => !t.hasIssue) }));

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
  const pendingReviewerRef = useRef<{ taskId: string; reviewerId: string | null } | null>(null);

  /* ── Review-time modal (any → Review) ── */
  type ReviewTimeModalData = {
    taskId: string; taskTitle: string; pendingLanes: LaneData[];
    hasTime: boolean; totalNormalMin: number; totalOtMin: number;
  };
  const [reviewTimeModal,   setReviewTimeModal]   = useState<ReviewTimeModalData | null>(null);
  const [reviewMode,        setReviewMode]        = useState<'auto' | 'manual' | null>(null);
  const [reviewNormalHrs,   setReviewNormalHrs]   = useState('');
  const [reviewOtHrs,       setReviewOtHrs]       = useState('');
  const [reviewReplace,     setReviewReplace]     = useState(false);
  const [reviewTimeAdded,   setReviewTimeAdded]   = useState(false);
  const [reviewTimeSaving,  setReviewTimeSaving]  = useState(false);
  const [reviewTimeError,   setReviewTimeError]   = useState('');

  /* ── Pending reviews (I'm the reviewer) ── */
  const [pendingReviewsList, setPendingReviewsList] = useState<PendingReview[]>(initialPendingReviews);

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
    setActiveTask(task ?? null);
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
    const current = lanesRef.current;

    /* Review approval guard: block QA_ENGINEER from dragging squad task to Done without approval */
    const landedLane = current.find(l => l.tasks.some(t => t.id === activeId));
    if (landedLane?.name === 'Done') {
      const task = landedLane.tasks.find(t => t.id === activeId);
      if (task?.squad && task.requiresReview && !task.reviewApprovedAt) {
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

        if (dstName === 'Review') {
          const t = current.flatMap(l => l.tasks).find(t => t.id === activeId)!;

          // Squad tasks: show reviewer modal first (chained before time modal)
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

          // Personal task (no squad): go straight to time modal
          setReviewTimeModal({
            taskId: activeId, taskTitle: t.title, pendingLanes: current,
            hasTime: t.totalNormalMin > 0 || t.totalOtMin > 0,
            totalNormalMin: t.totalNormalMin, totalOtMin: t.totalOtMin,
          });
          setReviewMode(null); setReviewNormalHrs(''); setReviewOtHrs('');
          setReviewReplace(false); setReviewTimeAdded(false); setReviewTimeError('');
          return;
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
    setResolving(true);
    const res = await fetch(`/api/tasks/${resolveTarget.id}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasIssue: false, resolutionNote: resolutionNote.trim(), destination: resolveDestination }),
    });
    if (res.ok) {
      const doneLane   = lanesRef.current.find(l => l.name === 'Done');
      const cancelLane = lanesRef.current.find(l => l.name === 'Cancel');
      const firstLane  = lanesRef.current[0];
      const targetLane =
        resolveDestination === 'done'   ? (doneLane ?? firstLane) :
        resolveDestination === 'cancel' ? (cancelLane ?? firstLane) :
        firstLane;
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
              : [...cleaned, resolvedTask], // append ท้าย Done/Cancel
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
  function openReviewTimeModal(taskId: string, taskTitle: string, pendingLanes: LaneData[]) {
    const t = pendingLanes.flatMap(l => l.tasks).find(t => t.id === taskId)!;
    setReviewTimeModal({
      taskId, taskTitle, pendingLanes,
      hasTime: t.totalNormalMin > 0 || t.totalOtMin > 0,
      totalNormalMin: t.totalNormalMin, totalOtMin: t.totalOtMin,
    });
    setReviewMode(null); setReviewNormalHrs(''); setReviewOtHrs('');
    setReviewReplace(false); setReviewTimeAdded(false); setReviewTimeError('');
  }

  function confirmReviewerModal(reviewerId: string | null) {
    if (!reviewerModal) return;
    pendingReviewerRef.current = { taskId: reviewerModal.taskId, reviewerId };
    openReviewTimeModal(reviewerModal.taskId, reviewerModal.taskTitle, reviewerModal.pendingLanes);
    setReviewerModal(null);
    setSelectedReviewerId('');
  }

  function cancelReviewerModal() {
    setLanes(preDragRef.current);
    setReviewerModal(null);
    setSelectedReviewerId('');
  }

  /* ─── Review-time modal handlers ─── */
  async function submitReviewAuto() {
    if (!reviewTimeModal) return;
    setReviewTimeSaving(true); setReviewTimeError('');
    const res = await fetch(`/api/tasks/${reviewTimeModal.taskId}/timelog/stop`, { method: 'POST' });
    if (res.ok) {
      const log = await res.json();
      const updatedLanes = reviewTimeModal.pendingLanes.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === reviewTimeModal.taskId
            ? { ...t, totalNormalMin: t.totalNormalMin + log.normalMinutes, totalOtMin: t.totalOtMin + log.otMinutes }
            : t
        ),
      }));
      setLanes(updatedLanes);
      setReviewTimeModal(m => m ? { ...m, pendingLanes: updatedLanes, hasTime: true } : m);
      setReviewTimeAdded(true);
    } else {
      setReviewTimeError(
        res.status === 404
          ? 'ไม่มีตัวจับเวลาที่กำลังทำงานอยู่ — กรุณาเลือกบันทึก manual'
          : await res.text()
      );
    }
    setReviewTimeSaving(false);
  }

  async function submitReviewManual() {
    if (!reviewTimeModal) return;
    const n = parseFloat(reviewNormalHrs);
    if (!n || n <= 0) { setReviewTimeError('กรุณากรอกชั่วโมงที่ทำงาน'); return; }
    setReviewTimeSaving(true); setReviewTimeError('');
    const res = await fetch(`/api/tasks/${reviewTimeModal.taskId}/timelog`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalHours: n, otHours: parseFloat(reviewOtHrs) || 0, replace: reviewReplace }),
    });
    if (res.ok) {
      const log = await res.json();
      const newNormal = reviewReplace ? log.normalMinutes : reviewTimeModal.totalNormalMin + log.normalMinutes;
      const newOt     = reviewReplace ? log.otMinutes    : reviewTimeModal.totalOtMin    + log.otMinutes;
      const updatedLanes = reviewTimeModal.pendingLanes.map(l => ({
        ...l, tasks: l.tasks.map(t =>
          t.id === reviewTimeModal.taskId ? { ...t, totalNormalMin: newNormal, totalOtMin: newOt } : t
        ),
      }));
      setLanes(updatedLanes);
      setReviewTimeModal(m => m ? { ...m, pendingLanes: updatedLanes, hasTime: true, totalNormalMin: newNormal, totalOtMin: newOt } : m);
      setReviewNormalHrs(''); setReviewOtHrs('');
      setReviewTimeAdded(true);
    } else {
      setReviewTimeError(await res.text());
    }
    setReviewTimeSaving(false);
  }

  async function proceedToReview() {
    const pending = pendingReviewerRef.current;
    if (pending) {
      const task = lanesRef.current.flatMap(l => l.tasks).find(t => t.id === pending.taskId);
      const squadId = task?.squadId;
      const reviewerName = pending.reviewerId && squadId
        ? (reviewersBySquad[squadId] ?? []).find(r => r.id === pending.reviewerId)?.name ?? null
        : null;
      const ok = await saveOrder(lanesRef.current, { [pending.taskId]: pending.reviewerId });
      if (ok) {
        setLanes(lanesRef.current.map(l => ({
          ...l, tasks: l.tasks.map(t =>
            t.id === pending.taskId ? { ...t, reviewerId: pending.reviewerId, reviewerName } : t
          ),
        })));
      }
      pendingReviewerRef.current = null;
    } else {
      await saveOrder(lanesRef.current);
    }
    setReviewTimeModal(null);
    setReviewMode(null); setReviewTimeAdded(false); setReviewTimeError('');
  }

  function cancelReviewModal() {
    setLanes(preDragRef.current);
    pendingReviewerRef.current = null;
    setReviewTimeModal(null);
    setReviewMode(null); setReviewTimeAdded(false); setReviewTimeError('');
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

  /* ─── Render ─────────────────────────────────────────── */
  return (
    <div className="px-7 py-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2.5">
        <h1 className="text-[19px] font-semibold text-txt-primary">บอร์ดของฉัน</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={openExport}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-md hover:bg-[#2a2e3a] transition-colors"
          >
            📄 Export Report
          </button>
          {canEditLanes && (
            <button
              onClick={() => { setEditMode(e => !e); setAddingLane(false); }}
              className={`border text-[13px] px-3 py-[7px] rounded-md flex items-center gap-1.5 transition-colors ${
                editMode
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-2 border-app-border text-txt-primary hover:bg-[#2a2e3a]'
              }`}
            >
              ✎ แก้ไขเลน
            </button>
          )}
          {canCreateTask && (
            <Link href="/tasks"
              className="bg-accent hover:bg-accent-hover text-white text-[13px] font-medium px-3 py-[7px] rounded-md transition-colors">
              + สร้างงานใหม่
            </Link>
          )}
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners}
        onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>

        {/* Pending reviews section (tasks where I'm the reviewer) */}
        <PendingReviewSection reviews={pendingReviewsList} onApprove={approveReview} />

        <DroppableIssueSection flaggedTasks={flaggedTasks} onResolve={openResolve} />

        <div
          className={`grid gap-3.5 pb-5 items-start ${editMode ? 'edit-mode-on' : ''}`}
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
        >
          {normalLanes.map(lane => (
            <div key={lane.id}
              className={`bg-surface-1 border rounded-[12px] p-2.5 flex flex-col transition-colors ${
                editMode ? 'border-accent' : 'border-app-border'
              }`}
              style={{ height: 'calc(100vh - 220px)' }}
            >
              <div className="flex items-center justify-between px-1 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[13px] font-semibold ${lane.name === 'Review' ? 'text-warning' : 'text-txt-primary'}`}>
                    {lane.name}
                  </span>
                  <span className="text-[11px] text-txt-muted bg-surface-2 px-2 py-0.5 rounded-full">{lane.tasks.length}</span>
                </div>
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
              <DroppableLaneCards
                laneId={lane.id}
                tasks={lane.tasks}
                laneName={lane.name}
                reviewersBySquad={reviewersBySquad}
                onReviewerChange={handleReviewerChange}
                onPrLinkSave={handlePrLinkSave}
                savingTaskIds={savingTaskIds}
              />
              <AddTaskForm laneId={lane.id} squadId={userSquadId} onCreated={t => onTaskCreated(lane.id, t)} />
            </div>
          ))}

          {editMode && (
            addingLane ? (
              <form onSubmit={submitLane}
                className="bg-surface-1 border border-accent rounded-[12px] p-3">
                <input autoFocus value={newLaneName} onChange={e => setNewLaneName(e.target.value)}
                  placeholder="ชื่อเลนใหม่..."
                  className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent mb-2" />
                <button type="submit" disabled={savingLane || !newLaneName.trim()}
                  className="w-full bg-accent text-white text-[12px] py-1.5 rounded-md disabled:opacity-50">
                  + เพิ่มเลนนี้
                </button>
              </form>
            ) : (
              <button onClick={() => setAddingLane(true)}
                className="border-[1.5px] border-dashed border-accent rounded-[12px] flex items-center justify-center gap-1.5 text-[13px] text-accent h-11 hover:bg-accent/5 transition-colors">
                + เพิ่มเลน
              </button>
            )
          )}

          {!editMode && (
            <button onClick={() => setEditMode(true)}
              className="border-[1.5px] border-dashed border-app-border rounded-[12px] flex items-center justify-center gap-1.5 text-[13px] text-txt-muted hover:border-accent hover:text-accent transition-colors h-11">
              + เพิ่มเลน
            </button>
          )}
        </div>

        {editMode && (
          <button onClick={() => { setEditMode(false); setAddingLane(false); }}
            className="mt-2 bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-2 rounded-md hover:bg-[#2a2e3a] transition-colors">
            ✓ เสร็จสิ้นการแก้ไข
          </button>
        )}

        <DragOverlay>
          {activeTask && <SortableCard task={activeTask} overlay />}
        </DragOverlay>
      </DndContext>

      {/* ── Review block alert ────────────────────────── */}
      {reviewBlockMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-warning/40 rounded-xl p-5 w-[380px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-warning mb-2">⚠ ยังไม่ผ่าน Review</h3>
            <p className="text-[13px] text-txt-secondary mb-4">{reviewBlockMsg}</p>
            <button
              onClick={() => setReviewBlockMsg(null)}
              className="w-full bg-accent hover:bg-accent-hover text-white text-[13px] font-medium py-2 rounded-lg transition-colors"
            >
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Flag issue ─────────────────────────── */}
      {flagTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[400px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-danger mb-1">⚠ รายงานปัญหา</h3>
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
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent resize-y min-h-[80px] font-inherit"
            />
            {flagError && <p className="text-[11.5px] text-danger mt-2">{flagError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setFlagTarget(null)}
                disabled={flagging}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitFlag}
                disabled={flagging || !flagNote.trim()}
                className={`bg-danger hover:bg-danger/80 text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${flagging ? 'btn-loading' : ''}`}
              >
                ⚠ Flag ปัญหานี้
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Start timer (To Do → In Progress) ──────── */}
      {startTimerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[420px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-1">▶ เริ่มบันทึกเวลา?</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">
              งาน <span className="font-medium text-txt-primary">"{startTimerModal.taskTitle}"</span>{' '}
              กำลังย้ายไป <span className="text-accent">In Progress</span><br />
              ต้องการให้ระบบเริ่มจับเวลาอัตโนมัติไหม?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={skipStartTimer} disabled={startTimerSaving}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors">
                ข้าม — ย้ายโดยไม่จับเวลา
              </button>
              <button onClick={confirmStartTimer} disabled={startTimerSaving}
                className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
                {startTimerSaving ? 'กำลังเริ่ม...' : '▶ เริ่มจับเวลา'}
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
            <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[400px] shadow-xl">
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
                    className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent mb-4"
                  >
                    <option value="">— เลือกผู้ review —</option>
                    {options.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2 justify-end">
                    <button onClick={cancelReviewerModal}
                      className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors">
                      ยกเลิก
                    </button>
                    <button
                      onClick={() => confirmReviewerModal(selectedReviewerId || null)}
                      className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg transition-colors"
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
                      className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors">
                      ยกเลิก
                    </button>
                    <button onClick={() => confirmReviewerModal(null)}
                      className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg transition-colors">
                      เข้า Review โดยไม่เลือก reviewer
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Modal: Record time before Review ────────────── */}
      {reviewTimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[450px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-1">⏱ บันทึกเวลาก่อนส่ง Review</h3>
            <p className="text-[12.5px] text-txt-secondary mb-2">
              งาน <span className="font-medium text-txt-primary">"{reviewTimeModal.taskTitle}"</span>
            </p>

            {reviewTimeModal.hasTime && !reviewTimeAdded && (
              <div className="flex items-center gap-2 text-[12px] text-success bg-success/8 border border-success/25 px-3 py-2 rounded-lg mb-3">
                <span>✓ เวลาที่บันทึกแล้ว:</span>
                <span className="font-medium">{fmt(reviewTimeModal.totalNormalMin)}</span>
                {reviewTimeModal.totalOtMin > 0 && (
                  <span className="text-warning">+OT {fmt(reviewTimeModal.totalOtMin)}</span>
                )}
                <span className="text-txt-muted ml-auto">· เพิ่มเวลาได้ถ้าต้องการ</span>
              </div>
            )}

            {reviewTimeAdded && (
              <div className="text-[12px] text-success bg-success/8 border border-success/25 px-3 py-2 rounded-lg mb-3">
                ✓ บันทึกเวลาเรียบร้อย — กดยืนยันเพื่อย้ายงานไป Review
              </div>
            )}

            {!reviewTimeAdded && (
              <div className="mb-3">
                <p className="text-[11.5px] text-txt-muted mb-2.5">
                  {reviewTimeModal.hasTime ? 'เพิ่มเวลาเพิ่มเติม (ไม่บังคับ):' : <>กรุณาเลือกวิธีบันทึกเวลา <span className="text-danger">(จำเป็น)</span></>}
                </p>

                <div className="flex flex-col gap-2 mb-3">
                  <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    reviewMode === 'auto' ? 'border-accent bg-accent/5' : 'border-app-border hover:border-accent/50'
                  }`}>
                    <input type="radio" name="revMode" value="auto" checked={reviewMode === 'auto'}
                      onChange={() => { setReviewMode('auto'); setReviewTimeError(''); }} className="mt-0.5 accent-accent" />
                    <div>
                      <p className="text-[12.5px] text-txt-primary">⏹ หยุดตัวจับเวลา (บันทึกอัตโนมัติ)</p>
                      <p className="text-[11px] text-txt-muted">หยุดการนับเวลาที่กำลังทำงานอยู่และบันทึกเวลาที่ผ่านมา</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    reviewMode === 'manual' ? 'border-accent bg-accent/5' : 'border-app-border hover:border-accent/50'
                  }`}>
                    <input type="radio" name="revMode" value="manual" checked={reviewMode === 'manual'}
                      onChange={() => { setReviewMode('manual'); setReviewTimeError(''); }} className="mt-0.5 accent-accent" />
                    <span className="text-[12.5px] text-txt-primary">✎ บันทึกเวลา manual</span>
                  </label>
                </div>

                {reviewMode === 'auto' && (
                  <button onClick={submitReviewAuto} disabled={reviewTimeSaving}
                    className="w-full bg-accent/10 border border-accent/40 text-accent text-[12.5px] py-2 rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50">
                    {reviewTimeSaving ? 'กำลังบันทึก...' : '⏹ หยุดและบันทึกเวลา'}
                  </button>
                )}

                {reviewMode === 'manual' && (
                  <div className="flex flex-col gap-2">
                    {reviewTimeModal.hasTime && (
                      <div className="flex gap-4 px-1">
                        <label className="flex items-center gap-1.5 text-[12px] text-txt-secondary cursor-pointer">
                          <input type="radio" name="revManualMode" checked={!reviewReplace}
                            onChange={() => setReviewReplace(false)} className="accent-accent" />
                          เพิ่มเติม (บวกกับเวลาเดิม)
                        </label>
                        <label className="flex items-center gap-1.5 text-[12px] text-txt-secondary cursor-pointer">
                          <input type="radio" name="revManualMode" checked={reviewReplace}
                            onChange={() => setReviewReplace(true)} className="accent-accent" />
                          แทนที่เวลาเดิม
                        </label>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-[11px] text-txt-muted mb-1">Normal (ชม.)</label>
                        <input type="number" min="0.25" step="0.25" autoFocus
                          value={reviewNormalHrs} onChange={e => setReviewNormalHrs(e.target.value)}
                          placeholder="เช่น 2.5"
                          className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-accent" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-[11px] text-txt-muted mb-1">OT (ชม.) — ไม่บังคับ</label>
                        <input type="number" min="0" step="0.25"
                          value={reviewOtHrs} onChange={e => setReviewOtHrs(e.target.value)}
                          placeholder="0"
                          className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-accent" />
                      </div>
                    </div>
                    <button onClick={submitReviewManual} disabled={reviewTimeSaving || !reviewNormalHrs}
                      className="w-full bg-accent/10 border border-accent/40 text-accent text-[12.5px] py-2 rounded-lg hover:bg-accent/20 transition-colors disabled:opacity-50">
                      {reviewTimeSaving ? 'กำลังบันทึก...' : '✎ บันทึกเวลา'}
                    </button>
                  </div>
                )}

                {reviewTimeError && <p className="text-[11.5px] text-danger mt-2">{reviewTimeError}</p>}
              </div>
            )}

            <div className="flex gap-2 justify-end mt-1">
              <button onClick={cancelReviewModal}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors">
                ยกเลิก
              </button>
              {reviewTimeModal.hasTime && !reviewTimeAdded && (
                <button onClick={proceedToReview}
                  className="px-4 py-2 text-[12.5px] text-txt-secondary hover:text-txt-primary border border-app-border rounded-lg transition-colors">
                  ข้าม — ย้ายงานเลย
                </button>
              )}
              <button onClick={proceedToReview}
                disabled={!reviewTimeModal.hasTime && !reviewTimeAdded}
                className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
                ยืนยันและย้ายงาน →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Resolve issue ───────────────────────── */}
      {resolveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[400px] shadow-xl">
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
                <label key={v} className={`flex items-start gap-2.5 border rounded-lg px-3 py-2.5 cursor-pointer transition-colors text-[12px] leading-[1.5] ${
                  resolveDestination === v
                    ? 'border-accent bg-accent/10 text-txt-primary'
                    : 'border-app-border bg-surface-2 text-txt-secondary hover:border-[#3a3f4d]'
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
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent resize-y min-h-[80px] font-inherit"
            />
            {resolveError && <p className="text-[11.5px] text-danger mt-2">{resolveError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => { setResolveTarget(null); setResolutionNote(''); setResolveDestination('todo'); }}
                disabled={resolving}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors">
                ยกเลิก
              </button>
              <button onClick={submitResolve} disabled={resolving || !resolutionNote.trim()}
                className={`bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${resolving ? 'btn-loading' : ''}`}>
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
          <div className="bg-surface-1 border border-app-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4">
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
                    className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-[7px] rounded-md transition-colors">
                    ⬇ ดาวน์โหลด .md
                  </button>
                  <button onClick={copyPlainText}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-4 py-[7px] rounded-md hover:bg-[#2a2e3a] transition-colors">
                    {copied ? '✅ คัดลอกแล้ว!' : '📋 Copy เป็นข้อความ'}
                  </button>
                  <button onClick={() => window.print()}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-4 py-[7px] rounded-md hover:bg-[#2a2e3a] transition-colors">
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
          className={`fixed bottom-5 right-5 z-[60] px-4 py-2.5 rounded-lg shadow-xl text-[12.5px] font-medium text-white ${
            toast.type === 'error' ? 'bg-danger' : 'bg-success'
          }`}
        >
          {toast.type === 'error' ? '⚠ ' : '✓ '}{toast.message}
        </div>
      )}

    </div>
  );
}
