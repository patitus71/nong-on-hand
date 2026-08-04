'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { fmt, initials, avatarColor } from '@/lib/ui';

type TaskCard = {
  id: string;
  title: string;
  hasIssue: boolean;
  assignee: { id: string; name: string } | null;
  laneName: string | null;
  totalNormalMin: number;
  totalOtMin: number;
};

type LaneData  = { name: string; tasks: TaskCard[] };
type Member    = { id: string; name: string; taskCount: number };
type SquadOpt  = { id: string; name: string };

type Props = {
  currentSquadId:   string;
  currentSquadName: string;
  lanes:   LaneData[];
  members: Member[];
  squads:  SquadOpt[];
  userId:  string;
  canAssign: boolean;
};

type ClaimTarget = { taskId: string; taskTitle: string };

export default function SquadBoardClient({ currentSquadId, currentSquadName, lanes, members, squads, userId, canAssign }: Props) {
  const router  = useRouter();
  const [activeMember, setActiveMember] = useState<string | null>(null);
  const [claimTarget, setClaimTarget]   = useState<ClaimTarget | null>(null);
  const [assigneeId,  setAssigneeId]    = useState(userId);
  const [claiming,    setClaiming]      = useState(false);
  const [claimError,  setClaimError]    = useState('');

  const visibleLanes = lanes.map(lane => ({
    ...lane,
    tasks: activeMember
      ? lane.tasks.filter(t => t.assignee?.id === activeMember)
      : lane.tasks,
  }));

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
      if (!res.ok) {
        const msg = await res.text();
        setClaimError(msg || 'เกิดข้อผิดพลาด');
        return;
      }
      setClaimTarget(null);
      router.refresh();
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="max-w-[1180px] mx-auto px-7 py-6 pb-16">

      {/* Page header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[19px] font-semibold text-txt-primary">Squad Board</h1>
          <select
            className="bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-[7px] rounded-md focus:outline-none focus:border-accent"
            value={currentSquadId}
            onChange={e => router.push(`/squads/${e.target.value}`)}
          >
            {squads.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
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
                  isActive
                    ? 'border-accent bg-accent-bg'
                    : 'border-app-border bg-surface-1 hover:border-txt-muted'
                }`}
              >
                <div
                  className="w-5 h-5 rounded-full text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0"
                  style={{ background: av.bg, color: av.fg }}
                >
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
                <span className={`text-[13px] font-semibold ${lane.name === 'มีปัญหา' ? 'text-danger' : lane.name === 'Done' ? 'text-success' : 'text-txt-primary'}`}>{lane.name}</span>
                <span className="text-[11px] text-txt-muted bg-surface-2 px-2 py-0.5 rounded-full">
                  {lane.tasks.length}
                </span>
              </div>

              {/* Empty lane hint */}
              {lane.tasks.length === 0 && (
                <div className="text-center text-[12px] text-txt-muted py-6 px-2">
                  {lane.name === 'To do' ? 'ดึงงานเข้าบอร์ดเพื่อเริ่มต้น' : 'ว่างอยู่'}
                </div>
              )}

              {/* Cards */}
              {lane.tasks.map(t => {
                const av = t.assignee ? avatarColor(t.assignee.name) : null;
                const normalFmt = fmt(t.totalNormalMin);
                const otFmt     = fmt(t.totalOtMin);

                return (
                  <div
                    key={t.id}
                    className={`bg-surface-2 border rounded-lg p-2.5 mb-2 last:mb-0 ${
                      t.hasIssue ? 'border-danger/40' : 'border-app-border'
                    }`}
                  >
                    {/* Title — navigates to task detail */}
                    <Link
                      href={`/tasks/${t.id}`}
                      className="block text-[13px] text-txt-primary mb-2 flex items-start gap-1.5 hover:text-accent transition-colors"
                    >
                      {t.hasIssue && (
                        <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0 mt-[5px]" />
                      )}
                      {t.title}
                    </Link>

                    {/* On-Board: show which personal lane the task is in */}
                    {lane.name === 'On-Board' && t.laneName && t.assignee && (
                      <p className="text-[10.5px] text-txt-muted mt-1 mb-1.5">
                        อยู่เลน "{t.laneName}" ในบอร์ดของ {t.assignee.name}
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

                    {/* Claim button — ADMIN/QA_LEAD only */}
                    {canAssign && members.length > 0 && (
                      <button
                        onClick={() => openClaim(t)}
                        className="mt-2 w-full text-[11.5px] px-2 py-1 rounded-md border border-app-border text-txt-muted hover:border-accent hover:text-accent transition-colors"
                      >
                        + เพิ่มเข้าบอร์ดของฉัน
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

      {/* Claim dialog */}
      {claimTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[340px] shadow-xl">
            <h2 className="text-[15px] font-semibold text-txt-primary mb-1">เพิ่มเข้าบอร์ดของฉัน</h2>
            <p className="text-[12px] text-txt-muted mb-4 leading-relaxed">
              งานจะย้ายไป <span className="text-accent font-medium">In progress</span> ใน SQ Board
              และปรากฏในบอร์ดของผู้รับผิดชอบ
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

            {claimError && (
              <p className="text-[12px] text-danger mt-2">{claimError}</p>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={submitClaim}
                disabled={claiming}
                className="flex-1 bg-accent hover:bg-accent-hover text-white text-[13px] py-2 rounded-md font-medium disabled:opacity-50 transition-colors"
              >
                {claiming ? 'กำลังบันทึก...' : 'ยืนยัน'}
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
