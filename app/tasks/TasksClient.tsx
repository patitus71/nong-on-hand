'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmt, initials, avatarColor, laneBadgeCls } from '@/lib/ui';

type TaskRow = {
  id:                  string;
  title:               string;
  hasIssue:            boolean;
  source:              'MANUAL' | 'IMPORTED';
  pulledIntoBoardAt:   string | null;
  flaggedForDeletion:  boolean;
  deletionFlagNote:    string | null;
  deletionFlaggedById: string | null;
  squad:               { id: string; name: string } | null;
  assignee:            { id: string; name: string } | null;
  laneName:            string | null;
  totalNormalMin:      number;
  totalOtMin:          number;
};

type PullInEntry = { est: string; due: string; assignee: string };

type OpenSprint = { id: string; name: string; squadId: string };

type Props = {
  tasks:        TaskRow[];
  squads:       { id: string; name: string }[];
  users:        { id: string; name: string }[];
  userRole:     string;
  userSquadId:  string | null;
  userId:       string;
  qaEngineers:  { id: string; name: string }[];
  openSprints:  OpenSprint[];
};

function isPendingImport(t: TaskRow) {
  return t.source === 'IMPORTED' && t.pulledIntoBoardAt === null;
}

// Client-side equivalent of canBulkSelectForDelete (pure — no Prisma import needed)
function isBulkSelectable(t: TaskRow, userRole: string, userSquadId: string | null): boolean {
  if (userRole === 'QA_ENGINEER') return false;
  const pending = isPendingImport(t);
  const flagged = t.flaggedForDeletion;
  if (!pending && !flagged) return false;
  if (userRole === 'ADMIN') return true;
  if (userRole === 'QA_LEAD') return !!t.squad?.id && userSquadId === t.squad?.id;
  if (userRole === 'QA_MANAGER') return flagged;
  return false;
}

// Client-side equivalent of canDeleteTask
function isMenuDeleteEnabled(t: TaskRow, userRole: string, userSquadId: string | null): boolean {
  if (userRole === 'ADMIN') return true;
  if (userRole === 'QA_LEAD') {
    if (!t.squad?.id || userSquadId !== t.squad?.id) return false;
    return isPendingImport(t) || t.flaggedForDeletion;
  }
  if (userRole === 'QA_MANAGER') return t.flaggedForDeletion;
  return false;
}

// Client-side equivalent of canFlagTaskForDeletion (unflag uses same permission)
function isUnflagEnabled(t: TaskRow, userRole: string, userSquadId: string | null): boolean {
  if (userRole === 'ADMIN') return true;
  if (userRole === 'QA_LEAD') return !!t.squad?.id && userSquadId === t.squad?.id;
  return false;
}

export default function TasksClient({ tasks, squads, users, userRole, userSquadId, userId, qaEngineers, openSprints }: Props) {
  const router = useRouter();

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState('');
  const [filterSquad,    setFilterSquad]    = useState('');
  const [filterLane,     setFilterLane]     = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [issueOnly,      setIssueOnly]      = useState(false);
  const [flaggedOnly,    setFlaggedOnly]    = useState(false);

  const laneNames = useMemo(
    () => Array.from(new Set(tasks.map(t => t.laneName).filter(Boolean) as string[])),
    [tasks],
  );

  const filtered = useMemo(() => tasks.filter(t => {
    if (search         && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterSquad    && t.squad?.id !== filterSquad)       return false;
    if (filterAssignee && t.assignee?.id !== filterAssignee) return false;
    if (filterLane     && t.laneName !== filterLane)         return false;
    if (issueOnly      && !t.hasIssue)                       return false;
    if (flaggedOnly    && !t.flaggedForDeletion)             return false;
    return true;
  }), [tasks, search, filterSquad, filterAssignee, filterLane, issueOnly, flaggedOnly]);

  const stats = {
    total:      tasks.length,
    inProgress: tasks.filter(t => t.laneName?.toLowerCase().includes('progress')).length,
    done:       tasks.filter(t => t.laneName?.toLowerCase() === 'done').length,
    issues:     tasks.filter(t => t.hasIssue).length,
  };

  // ── Checkbox / bulk select ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectableInFiltered = useMemo(
    () => filtered.filter(t => isBulkSelectable(t, userRole, userSquadId)),
    [filtered, userRole, userSquadId],
  );

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const allIds = selectableInFiltered.map(t => t.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  const allSelectableSelected =
    selectableInFiltered.length > 0 && selectableInFiltered.every(t => selectedIds.has(t.id));

  useEffect(() => { setSelectedIds(new Set()); }, [search, filterSquad, filterAssignee, filterLane, issueOnly, flaggedOnly]);

  // ── Row action menu (⋯) ──────────────────────────────────────────────────────
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const closeMenu = useCallback(() => setOpenMenuId(null), []);
  useEffect(() => {
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [closeMenu]);

  // ── Pull-in modal ────────────────────────────────────────────────────────────
  const [showPullInModal,  setShowPullInModal]  = useState(false);
  const [modalTaskIds,     setModalTaskIds]     = useState<string[]>([]);
  const [pullInData,       setPullInData]       = useState<Record<string, PullInEntry>>({});
  const [pullSubmitting,   setPullSubmitting]   = useState(false);
  const [pullError,        setPullError]        = useState('');
  const [selectedSprintId, setSelectedSprintId] = useState('');
  const [modalSquadId,     setModalSquadId]     = useState<string | null>(null);

  function openPullIn(taskIds: string[]) {
    const init: Record<string, PullInEntry> = {};
    taskIds.forEach(id => { init[id] = { est: '', due: '', assignee: '' }; });
    setPullInData(init);
    setModalTaskIds(taskIds);
    setPullError('');
    // Determine squad from tasks — block if mixed squads
    const squadIds = Array.from(new Set(taskIds.map(id => tasks.find(t => t.id === id)?.squad?.id ?? null).filter(Boolean)));
    const singleSquadId = squadIds.length === 1 ? (squadIds[0] as string) : null;
    setModalSquadId(singleSquadId);
    // Pre-select the open sprint for this squad if there is one
    const sprint = singleSquadId ? openSprints.find(s => s.squadId === singleSquadId) : null;
    setSelectedSprintId(sprint?.id ?? '');
    setShowPullInModal(true);
    setOpenMenuId(null);
  }

  function setField(id: string, key: keyof PullInEntry, val: string) {
    setPullInData(prev => ({ ...prev, [id]: { ...prev[id], [key]: val } }));
  }

  async function submitPullIn() {
    if (!selectedSprintId) {
      setPullError('กรุณาเลือก Sprint ก่อนดึงงานเข้าบอร์ด');
      return;
    }
    setPullSubmitting(true);
    setPullError('');
    for (const id of modalTaskIds) {
      const f = pullInData[id] ?? { est: '', due: '', assignee: '' };
      const res = await fetch(`/api/tasks/${id}/pull-in`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          estimatedHours: f.est ? Number(f.est) : undefined,
          dueDate:        f.due || undefined,
          assigneeId:     f.assignee || undefined,
          sprintId:       selectedSprintId,
        }),
      });
      if (!res.ok) {
        setPullError(`เกิดข้อผิดพลาดกับงาน "${tasks.find(t => t.id === id)?.title}" — ${await res.text()}`);
        setPullSubmitting(false);
        return;
      }
    }
    setSelectedIds(new Set());
    setShowPullInModal(false);
    router.refresh();
    setPullSubmitting(false);
  }

  // ── Unflag task ──────────────────────────────────────────────────────────────
  async function submitUnflag(taskId: string) {
    setOpenMenuId(null);
    const res = await fetch(`/api/tasks/${taskId}/flag-delete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flaggedForDeletion: false }),
    });
    if (res.ok) router.refresh();
    else alert(await res.text());
  }

  // ── Delete modal ─────────────────────────────────────────────────────────────
  const [showDeleteModal,  setShowDeleteModal]  = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deleting,         setDeleting]         = useState(false);
  const [deleteError,      setDeleteError]      = useState('');

  function openDeleteModal(ids: string[]) {
    setPendingDeleteIds(ids);
    setDeleteError('');
    setShowDeleteModal(true);
    setOpenMenuId(null);
  }

  async function submitDelete() {
    setDeleting(true);
    setDeleteError('');

    try {
      if (pendingDeleteIds.length === 1) {
        const res = await fetch(`/api/tasks/${pendingDeleteIds[0]}`, { method: 'DELETE' });
        if (!res.ok) {
          setDeleteError(await res.text());
          setDeleting(false);
          return;
        }
      } else {
        const res = await fetch('/api/tasks/bulk-delete', {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ids: pendingDeleteIds }),
        });
        if (!res.ok) {
          setDeleteError(await res.text());
          setDeleting(false);
          return;
        }
      }
    } catch {
      setDeleteError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      setDeleting(false);
      return;
    }

    setSelectedIds(new Set());
    setShowDeleteModal(false);
    setPendingDeleteIds([]);
    router.refresh();
    setDeleting(false);
  }

  // ── Derived permission flags ─────────────────────────────────────────────────
  const canPullIn = ['ADMIN', 'QA_LEAD'].includes(userRole);
  const canDeleteAny = userRole !== 'QA_ENGINEER';

  // Bulk bar derived state
  const selectedTasks      = tasks.filter(t => selectedIds.has(t.id));
  const allSelectedPending = selectedTasks.length > 0 && selectedTasks.every(t => isPendingImport(t));
  const selectedSquadIds   = Array.from(new Set(selectedTasks.map(t => t.squad?.id).filter(Boolean)));
  const isSingleSquad      = selectedSquadIds.length === 1;
  const canBulkPullIn      = canPullIn && allSelectedPending && isSingleSquad;

  const selCls = 'bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-md focus:outline-none focus:border-accent';
  const btnCls = 'bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-md flex items-center gap-1.5 transition-colors hover:bg-[#2a2e3a]';

  return (
    <div className="px-7 py-6 pb-16">

      {/* Page header */}
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-txt-primary mb-1">งานทั้งหมด</h1>
          <p className="text-[13px] text-txt-secondary">รวมงานจากทุก Squad — กรองและค้นหาได้</p>
        </div>
        {['ADMIN', 'QA_LEAD'].includes(userRole) && (
          <Link href="/tasks/import"
            className="bg-accent text-white text-[13px] px-3.5 py-2 rounded-md font-medium hover:bg-accent-hover transition-colors">
            ⬆ Import งาน
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-2.5 mb-5 flex-wrap">
        {[
          { num: stats.total,      label: 'งานทั้งหมด', danger: false },
          { num: stats.inProgress, label: 'กำลังทำ',    danger: false },
          { num: stats.done,       label: 'เสร็จแล้ว',  danger: false },
          { num: stats.issues,     label: 'มีปัญหา',    danger: true  },
        ].map(s => (
          <div key={s.label} className="bg-surface-1 border border-app-border rounded-[10px] px-4 py-3 min-w-[110px]">
            <div className={`text-[19px] font-semibold leading-tight ${s.danger ? 'text-danger' : 'text-txt-primary'}`}>{s.num}</div>
            <div className="text-[11.5px] text-txt-secondary mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          className="w-[220px] bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-md focus:outline-none focus:border-accent placeholder:text-txt-muted"
          placeholder="ค้นหางาน..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={selCls} value={filterSquad} onChange={e => setFilterSquad(e.target.value)}>
          <option value="">ทุก Squad</option>
          {squads.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={selCls} value={filterLane} onChange={e => setFilterLane(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          {laneNames.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select className={selCls} value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="">ผู้รับผิดชอบทุกคน</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <div className="flex-1" />
        <button
          className={`${btnCls} ${issueOnly ? 'border-danger text-danger' : ''}`}
          onClick={() => setIssueOnly(!issueOnly)}
        >
          ⚠ เฉพาะที่มีปัญหา
        </button>
        {canDeleteAny && (
          <button
            className={`${btnCls} ${flaggedOnly ? 'border-danger text-danger' : ''}`}
            onClick={() => setFlaggedOnly(!flaggedOnly)}
          >
            🚩 เฉพาะที่ถูก flag ให้ลบ
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-accent-bg border border-accent/35 rounded-[10px] px-4 py-2.5 mb-3 text-[13px] text-accent">
          <span>เลือกแล้ว {selectedIds.size} งาน</span>
          <div className="flex-1" />
          <button
            onClick={() => setSelectedIds(new Set())}
            className="bg-surface-2 border border-app-border text-txt-secondary text-[12.5px] px-3 py-1.5 rounded-md hover:bg-[#2a2e3a] transition-colors"
          >
            ยกเลิกเลือก
          </button>
          {canPullIn && (
            <button
              onClick={() => openPullIn(Array.from(selectedIds))}
              disabled={!canBulkPullIn}
              title={canBulkPullIn ? '' : 'ดึงเข้าบอร์ดได้เฉพาะงาน pending-import ล้วนๆ และต้องอยู่ Squad เดียวกันเท่านั้น'}
              className="bg-accent text-white text-[12.5px] px-3 py-1.5 rounded-md font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              📥 ดึงเข้าบอร์ด ({selectedIds.size} งาน)
            </button>
          )}
          <button
            onClick={() => openDeleteModal(Array.from(selectedIds))}
            className="bg-danger border border-danger text-white text-[12.5px] px-3 py-1.5 rounded-md font-medium hover:bg-[#d94848] transition-colors"
          >
            🗑 ลบ ({selectedIds.size} งาน)
          </button>
        </div>
      )}

      {/* Table */}
      <div className="w-full bg-surface-1 border border-app-border rounded-[10px] overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="w-8 px-3 py-2.5 border-b border-app-border">
                {selectableInFiltered.length > 0 && (
                  <input
                    type="checkbox"
                    checked={allSelectableSelected}
                    onChange={toggleSelectAll}
                    className="w-[15px] h-[15px] accent-accent cursor-pointer"
                    title="เลือกงานที่มีสิทธิ์ลบ/ดึงบอร์ดทั้งหมด"
                  />
                )}
              </th>
              {[['38%', 'งาน'], ['', 'Squad'], ['', 'สถานะ'], ['', 'ผู้รับผิดชอบ'], ['', 'เวลาที่ใช้']].map(([w, h]) => (
                <th
                  key={h}
                  style={w ? { width: w } : {}}
                  className="text-left text-[11.5px] font-medium text-txt-muted px-3.5 py-2.5 border-b border-app-border uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
              <th className="w-9 border-b border-app-border" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-[12.5px] text-txt-muted py-10">
                  ไม่พบงานที่ตรงเงื่อนไข
                </td>
              </tr>
            )}
            {filtered.map(t => {
              const av          = t.assignee ? avatarColor(t.assignee.name) : null;
              const normalFmt   = fmt(t.totalNormalMin);
              const otFmt       = fmt(t.totalOtMin);
              const badge       = laneBadgeCls(t.laneName);
              const pending     = isPendingImport(t);
              const isSelected  = selectedIds.has(t.id);
              const menuOpen    = openMenuId === t.id;
              const selectable  = isBulkSelectable(t, userRole, userSquadId);
              const deleteEnabled = isMenuDeleteEnabled(t, userRole, userSquadId);
              const unflagEnabled = t.flaggedForDeletion && isUnflagEnabled(t, userRole, userSquadId);
              const showMenu    = canDeleteAny && (deleteEnabled || unflagEnabled || (canPullIn && pending));

              return (
                <tr
                  key={t.id}
                  className={`border-b border-app-border last:border-none transition-colors ${isSelected ? 'bg-accent-bg/40' : 'hover:bg-surface-2'}`}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    {selectable ? (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(t.id)}
                        className="w-[15px] h-[15px] accent-accent cursor-pointer"
                      />
                    ) : (
                      <input
                        type="checkbox"
                        disabled
                        className="w-[15px] h-[15px] opacity-25 cursor-not-allowed"
                      />
                    )}
                  </td>

                  {/* Task title */}
                  <td className="px-3.5 py-3">
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-2 font-[450] text-[13px] text-txt-primary hover:text-accent transition-colors">
                      {t.hasIssue && <span className="w-[7px] h-[7px] rounded-full bg-danger flex-shrink-0" />}
                      <span>{t.title}</span>
                    </Link>
                    {t.flaggedForDeletion && (
                      <div className="mt-1">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-danger-bg text-danger font-semibold">
                          🚩 ถูก flag ให้ลบ{t.deletionFlagNote ? ` — "${t.deletionFlagNote}"` : ''}
                        </span>
                      </div>
                    )}
                    {!t.flaggedForDeletion && pending && (
                      <div className="mt-1">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent-bg text-accent font-medium">
                          Imported · รอดึงเข้าบอร์ด
                        </span>
                      </div>
                    )}
                    {!t.flaggedForDeletion && !pending && t.source === 'IMPORTED' && (
                      <div className="mt-1">
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-txt-muted font-medium">Import</span>
                      </div>
                    )}
                  </td>

                  {/* Squad */}
                  <td className="px-3.5 py-3">
                    {t.squad
                      ? <span className="text-[11.5px] px-2.5 py-1 rounded-full bg-surface-2 text-txt-secondary font-medium">{t.squad.name}</span>
                      : <span className="text-txt-muted text-[12px]">—</span>
                    }
                  </td>

                  {/* Status */}
                  <td className="px-3.5 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[11.5px] px-2.5 py-1 rounded-full font-medium ${badge}`}>
                        {t.laneName ?? 'ยังไม่ดึง'}
                      </span>
                      {t.hasIssue && (
                        <span className="text-[11.5px] px-2.5 py-1 rounded-full bg-danger-bg text-danger font-medium">มีปัญหา</span>
                      )}
                    </div>
                  </td>

                  {/* Assignee */}
                  <td className="px-3.5 py-3">
                    {t.assignee && av ? (
                      <div className="flex items-center gap-1.5 text-[12.5px] text-txt-secondary">
                        <div
                          className="w-5 h-5 rounded-full text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0"
                          style={{ background: av.bg, color: av.fg }}
                        >
                          {initials(t.assignee.name)}
                        </div>
                        {t.assignee.name}
                      </div>
                    ) : (
                      <span className="text-txt-muted text-[12px]">—</span>
                    )}
                  </td>

                  {/* Time */}
                  <td className="px-3.5 py-3 text-[12.5px] text-txt-secondary">
                    {normalFmt
                      ? <>{normalFmt}{otFmt && <span className="text-warning ml-1">+OT {otFmt}</span>}</>
                      : <span className="text-txt-muted">—</span>
                    }
                  </td>

                  {/* ⋯ menu */}
                  <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
                    {showMenu && (
                      <div className="relative">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            e.nativeEvent.stopImmediatePropagation();
                            setOpenMenuId(menuOpen ? null : t.id);
                          }}
                          className="text-txt-muted hover:text-txt-primary text-[16px] leading-none px-2 py-1 rounded hover:bg-surface-2 transition-colors"
                        >
                          ⋯
                        </button>
                        {menuOpen && (
                          <div
                            className="absolute right-0 top-7 bg-surface-2 border border-app-border rounded-lg py-1 min-w-[170px] z-20 shadow-lg"
                            onClick={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
                          >
                            {canPullIn && pending && (
                              <button
                                onClick={() => openPullIn([t.id])}
                                className="w-full text-left text-[12.5px] px-3 py-2 hover:bg-[#2a2e3a] transition-colors text-txt-primary flex items-center gap-2"
                              >
                                📥 ดึงเข้าบอร์ด
                              </button>
                            )}
                            {unflagEnabled && (
                              <button
                                onClick={() => submitUnflag(t.id)}
                                className="w-full text-left text-[12.5px] px-3 py-2 hover:bg-surface-0 transition-colors text-txt-secondary flex items-center gap-2"
                              >
                                ↩ ยกเลิก flag (เก็บงานนี้ไว้)
                              </button>
                            )}
                            {deleteEnabled ? (
                              <button
                                onClick={() => openDeleteModal([t.id])}
                                className="w-full text-left text-[12.5px] px-3 py-2 hover:bg-danger-bg transition-colors text-danger flex items-center gap-2"
                              >
                                🗑 ลบงาน
                              </button>
                            ) : (
                              <div
                                title="งานนี้กำลังถูกใช้งานอยู่ ต้อง flag จาก Squad Board ก่อนถึงจะลบได้"
                                className="text-[12.5px] px-3 py-2 text-txt-muted opacity-50 cursor-not-allowed flex items-center gap-2 select-none"
                              >
                                🗑 ลบงาน
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="mt-4 text-center text-[12.5px] text-txt-muted">
          แสดง {filtered.length} จาก {tasks.length} งาน
        </p>
      )}

      {/* ── Pull-in modal ── */}
      {showPullInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="bg-surface-1 border border-app-border rounded-xl w-full max-w-[600px] max-h-[85vh] flex flex-col shadow-2xl">
            <div className="px-5 pt-5 pb-3 border-b border-app-border flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-txt-primary">📥 ดึงงานเข้าบอร์ด</h2>
                <p className="text-[12px] text-txt-secondary mt-0.5">
                  {modalTaskIds.length > 1
                    ? `เลือก ${modalTaskIds.length} งาน — ทุกงานจะเข้าเลน "To do" ทันที`
                    : 'งานจะเข้าเลน "To do" ของบอร์ด Squad ทันที'}
                </p>
              </div>
              <button onClick={() => setShowPullInModal(false)} className="text-txt-muted hover:text-txt-primary text-[18px] leading-none">✕</button>
            </div>
            {/* Sprint selector */}
            <div className="px-5 py-3 border-b border-app-border">
              {(() => {
                const squadSprints = modalSquadId ? openSprints.filter(s => s.squadId === modalSquadId) : [];
                if (!modalSquadId) {
                  return <p className="text-[12px] text-danger">⚠ งานที่เลือกมาจากหลาย Squad — ไม่สามารถดึงพร้อมกันได้</p>;
                }
                if (squadSprints.length === 0) {
                  return (
                    <div className="bg-warning-bg border border-warning/30 rounded-lg px-3 py-2">
                      <p className="text-[12px] text-warning font-medium">⚠ Squad นี้ยังไม่มี Sprint ที่เปิดอยู่</p>
                      <p className="text-[11px] text-txt-secondary mt-0.5">ADMIN หรือ QA Lead ต้องเปิด Sprint ที่ Squad Board ก่อนจึงจะดึงงานได้</p>
                    </div>
                  );
                }
                return (
                  <div>
                    <label className="block text-[11px] text-txt-secondary mb-1.5 font-medium">Sprint (บังคับเลือก)</label>
                    <select
                      value={selectedSprintId}
                      onChange={e => setSelectedSprintId(e.target.value)}
                      className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-md focus:outline-none focus:border-accent"
                    >
                      <option value="">— เลือก Sprint —</option>
                      {squadSprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                );
              })()}
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-2">
              {modalTaskIds.map(id => {
                const task = tasks.find(t => t.id === id);
                if (!task) return null;
                const f = pullInData[id] ?? { est: '', due: '', assignee: '' };
                return (
                  <div key={id} className="py-3 border-b border-app-border last:border-none grid grid-cols-[1.5fr_1fr_1.1fr_1.3fr] gap-2.5 items-end">
                    <div>
                      <p className="text-[13px] font-medium text-txt-primary truncate" title={task.title}>{task.title}</p>
                      <p className="text-[11px] text-txt-muted mt-0.5">→ เลน "To do"</p>
                    </div>
                    <div>
                      <label className="block text-[10.5px] text-txt-secondary mb-1">Estimate (ชม.)</label>
                      <input type="number" step="0.5" min="0" placeholder="เช่น 2.5" value={f.est}
                        onChange={e => setField(id, 'est', e.target.value)}
                        className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2 py-1.5 rounded-md focus:outline-none focus:border-accent" />
                    </div>
                    <div>
                      <label className="block text-[10.5px] text-txt-secondary mb-1">วันที่คาดว่าจะเสร็จ</label>
                      <input type="date" value={f.due}
                        onChange={e => setField(id, 'due', e.target.value)}
                        className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2 py-1.5 rounded-md focus:outline-none focus:border-accent" />
                    </div>
                    <div>
                      <label className="block text-[10.5px] text-txt-secondary mb-1">มอบหมายให้</label>
                      <select value={f.assignee}
                        onChange={e => setField(id, 'assignee', e.target.value)}
                        className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2 py-1.5 rounded-md focus:outline-none focus:border-accent">
                        <option value="">— เลือกทีหลัง —</option>
                        {qaEngineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            {pullError && <p className="px-5 py-2 text-[12px] text-danger bg-danger-bg">{pullError}</p>}
            <p className="px-5 py-2 text-[11px] text-txt-muted border-t border-app-border">
              ℹ️ ทุกงานจะเข้าเลน <b>"To do"</b> เสมอ — estimate, วันที่ และผู้รับผิดชอบกรอกทีหลังได้
            </p>
            <div className="px-5 pb-5 pt-3 flex justify-end gap-2">
              <button onClick={() => setShowPullInModal(false)} disabled={pullSubmitting}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-md hover:bg-[#2a2e3a] transition-colors">
                ยกเลิก
              </button>
              <button
                onClick={submitPullIn}
                disabled={pullSubmitting || !modalSquadId || !selectedSprintId}
                className={`bg-accent text-white text-[13px] px-4 py-2 rounded-md font-medium hover:bg-accent-hover transition-colors disabled:opacity-50 ${pullSubmitting ? 'btn-loading' : ''}`}
              >
                ยืนยันดึงเข้าบอร์ด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="bg-surface-1 border border-app-border rounded-xl w-full max-w-[400px] shadow-2xl p-5">
            <h2 className="text-[15px] font-semibold text-danger mb-1">🗑 ลบงาน{pendingDeleteIds.length > 1 ? ` ${pendingDeleteIds.length} รายการ` : 'นี้'}?</h2>
            <p className="text-[12.5px] text-txt-secondary mb-3 leading-relaxed">
              {pendingDeleteIds.length === 1
                ? `ยืนยันการลบ "${tasks.find(t => t.id === pendingDeleteIds[0])?.title}"`
                : `ยืนยันการลบ ${pendingDeleteIds.length} งาน: ${pendingDeleteIds.map(id => tasks.find(t => t.id === id)?.title).filter(Boolean).join(', ')}`
              }
            </p>
            <p className="text-[12px] text-warning bg-warning-bg px-3 py-2 rounded-lg mb-2 leading-relaxed">
              ⚠ ลบแล้วจะแจ้งเตือนผู้รับผิดชอบ (ถ้ามี) และงานจะหายออกจากระบบ ดึงกลับมาไม่ได้
            </p>
            {pendingDeleteIds.some(id => {
              const t = tasks.find(x => x.id === id);
              return t && (t.totalNormalMin > 0 || t.totalOtMin > 0);
            }) && (
              <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-lg mb-2 leading-relaxed">
                ⚠ งานที่เลือกมีเวลาที่ log ไว้อยู่ — เวลาทำงานและ OT จะหายไปด้วยเมื่อลบ
              </p>
            )}
            {deleteError && (
              <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-lg mb-3">{deleteError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteModal(false); setPendingDeleteIds([]); setDeleteError(''); }}
                disabled={deleting}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-4 py-2 rounded-md hover:bg-[#2a2e3a] transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitDelete}
                disabled={deleting}
                className={`bg-danger border border-danger text-white text-[13px] px-4 py-2 rounded-md font-medium hover:bg-[#d94848] transition-colors disabled:opacity-50 ${deleting ? 'btn-loading' : ''}`}
              >
                ลบงานนี้ถาวร
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
