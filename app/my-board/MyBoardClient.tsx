'use client';

import { useRef, useState } from 'react';
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
import { fmt, initials, avatarColor } from '@/lib/ui';

/* ─── Types ─────────────────────────────────────────── */
type TaskData = {
  id: string; title: string; hasIssue: boolean; order: number;
  reviewApprovedAt: string | null;
  squad: { name: string } | null;
  assignee: { name: string } | null;
  totalNormalMin: number; totalOtMin: number;
};
type LaneData = { id: string; name: string; tasks: TaskData[] };

type ProblemTask = {
  id: string; title: string; hasIssue: boolean; laneName: string;
  squadName: string; totalNormalMin: number; totalOtMin: number;
};

/* ─── Sortable card (normal lane) ────────────────────── */
function SortableCard({ task, overlay = false }: { task: TaskData; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const av = task.assignee ? avatarColor(task.assignee.name) : null;
  const normalFmt = fmt(task.totalNormalMin);
  const otFmt     = fmt(task.totalOtMin);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes} {...listeners}
      className={`bg-surface-2 border rounded-lg p-2.5 cursor-grab active:cursor-grabbing transition-colors select-none
        ${task.hasIssue ? 'border-danger/40' : 'border-app-border'}
        ${isDragging && !overlay ? 'opacity-40' : ''}
        ${overlay ? 'shadow-xl rotate-1' : 'hover:border-[#3a3f4d]'}
      `}
    >
      <Link
        href={`/tasks/${task.id}`}
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
        className="block text-[13px] text-txt-primary leading-snug mb-2 flex items-start gap-1.5 hover:text-accent transition-colors"
      >
        {task.hasIssue && <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 mt-[5px]" />}
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
        ✓ แก้ไขแล้ว — กลับไป To Do
      </button>
    </div>
  );
}

/* ─── Droppable lane card area ──────────────────────── */
function DroppableLaneCards({ laneId, tasks }: { laneId: string; tasks: TaskData[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: laneId });
  return (
    <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`flex flex-col gap-2 overflow-y-auto flex-1 px-0.5 pb-0.5 min-h-[40px] rounded-lg transition-colors ${
          isOver ? 'bg-accent/5' : ''
        }`}
      >
        {tasks.map(task => <SortableCard key={task.id} task={task} />)}
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
        reviewApprovedAt: null,
        squad: task.squad, assignee: task.assignee, totalNormalMin: 0, totalOtMin: 0,
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
const PROTECTED_LANES = new Set(['To Do', 'In Progress', 'Review', 'Done']);
const PROTECTED_TOOLTIP = 'เลนนี้ผูกกับ Squad Board — แก้ไข/ลบไม่ได้';

/* ─── Main board client ─────────────────────────────── */
type Props = {
  boardId: string;
  initialLanes: LaneData[];
  userId: string;
  userSquadId: string | null;
  squadTasks: ProblemTask[];
  canEditLanes: boolean;
  canCreateTask: boolean;
};

export default function MyBoardClient({
  boardId, initialLanes, userSquadId, canEditLanes, canCreateTask,
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

  /* ── Review-block alert state ── */
  const [reviewBlockMsg, setReviewBlockMsg] = useState<string | null>(null);

  /* ── Derived views ── */
  const flaggedTasks = lanes.flatMap(l => l.tasks.filter(t => t.hasIssue));
  const flaggedIds   = new Set(flaggedTasks.map(t => t.id));
  const normalLanes  = lanes.map(l => ({ ...l, tasks: l.tasks.filter(t => !t.hasIssue) }));

  /* ── Resolve modal state ── */
  const [resolveTarget,  setResolveTarget]  = useState<TaskData | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolveError,   setResolveError]   = useState('');
  const [resolving,      setResolving]      = useState(false);

  /* ── Flag modal state ── */
  const [flagTarget, setFlagTarget] = useState<TaskData | null>(null);
  const [flagNote,   setFlagNote]   = useState('');
  const [flagError,  setFlagError]  = useState('');
  const [flagging,   setFlagging]   = useState(false);

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

  function saveOrder(ls: LaneData[]) {
    const items = ls.flatMap(l => l.tasks.map((t, idx) => ({ id: t.id, laneId: l.id, order: idx })));
    if (!items.length) return;
    fetch('/api/tasks/reorder', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).catch(console.error);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
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
      if (task?.squad && !task.reviewApprovedAt) {
        setReviewBlockMsg('ต้องรอ QA_LEAD approve review ก่อนจึงจะย้ายงานไป Done ได้');
        setLanes(preDragRef.current);
        return;
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
      saveOrder(reordered);
    } else {
      saveOrder(current);
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
      setResolveError('กรุณาอธิบายวิธีแก้ไขก่อนยืนยัน — ต้องมีเหตุผลเสมอ ห้ามเว้นว่าง');
      return;
    }
    if (!resolveTarget) return;
    setResolving(true);
    const res = await fetch(`/api/tasks/${resolveTarget.id}/flag`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasIssue: false, resolutionNote: resolutionNote.trim() }),
    });
    if (res.ok) {
      const firstLane = lanesRef.current[0];
      const next = lanesRef.current.map(l => {
        const cleaned = l.tasks.filter(t => t.id !== resolveTarget.id);
        if (firstLane && l.id === firstLane.id) {
          return { ...l, tasks: [{ ...resolveTarget, hasIssue: false }, ...cleaned] };
        }
        return { ...l, tasks: cleaned };
      });
      setLanes(next);
      setResolveTarget(null);
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

  /* ─── Render ─────────────────────────────────────────── */
  return (
    <div className="max-w-[1280px] mx-auto px-7 py-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2.5">
        <h1 className="text-[19px] font-semibold text-txt-primary">บอร์ดของฉัน</h1>
        <div className="flex items-center gap-2">
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

        <DroppableIssueSection flaggedTasks={flaggedTasks} onResolve={openResolve} />

        <div className={`flex gap-3.5 items-start overflow-x-auto pb-5 ${editMode ? 'edit-mode-on' : ''}`}>
          {normalLanes.map(lane => (
            <div key={lane.id}
              className={`bg-surface-1 border rounded-[12px] w-[270px] flex-shrink-0 p-2.5 flex flex-col transition-colors ${
                editMode ? 'border-accent' : 'border-app-border'
              }`}
              style={{ maxHeight: 'calc(100vh - 220px)' }}
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
              <DroppableLaneCards laneId={lane.id} tasks={lane.tasks} />
              <AddTaskForm laneId={lane.id} squadId={userSquadId} onCreated={t => onTaskCreated(lane.id, t)} />
            </div>
          ))}

          {editMode && (
            addingLane ? (
              <form onSubmit={submitLane}
                className="bg-surface-1 border border-accent rounded-[12px] w-[230px] flex-shrink-0 p-3">
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
                className="w-[230px] flex-shrink-0 border-[1.5px] border-dashed border-accent rounded-[12px] flex items-center justify-center gap-1.5 text-[13px] text-accent h-11 hover:bg-accent/5 transition-colors">
                + เพิ่มเลน
              </button>
            )
          )}

          {!editMode && (
            <button onClick={() => setEditMode(true)}
              className="w-[230px] flex-shrink-0 border-[1.5px] border-dashed border-app-border rounded-[12px] flex items-center justify-center gap-1.5 text-[13px] text-txt-muted hover:border-accent hover:text-accent transition-colors h-11">
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

      {/* ── Modal: Resolve issue ───────────────────────── */}
      {resolveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[380px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-success mb-1">✓ ยืนยันว่าแก้ไขปัญหาแล้ว</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">
              งานนี้จะกลับไปอยู่เลน "To Do" และปลด flag ปัญหาออก
            </p>
            <label className="block text-[12px] text-txt-secondary mb-1.5">
              อธิบายว่าแก้ไขปัญหานี้ยังไง <span className="text-danger">(จำเป็นต้องกรอก)</span>
            </label>
            <textarea
              value={resolutionNote}
              onChange={e => setResolutionNote(e.target.value)}
              placeholder="เช่น เพิ่ม null check ก่อน call ฟังก์ชัน แก้ปัญหา crash เมื่อ state เป็น undefined"
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent resize-y min-h-[80px] font-inherit"
            />
            {resolveError && <p className="text-[11.5px] text-danger mt-2">{resolveError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setResolveTarget(null)} disabled={resolving}
                className="px-4 py-2 text-[12.5px] text-txt-muted hover:text-txt-secondary border border-app-border rounded-lg transition-colors">
                ยกเลิก
              </button>
              <button onClick={submitResolve} disabled={resolving || !resolutionNote.trim()}
                className={`bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${resolving ? 'btn-loading' : ''}`}>
                ยืนยันและกลับไป To Do
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
