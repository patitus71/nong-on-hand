'use client';

import { useState } from 'react';
import { fmtHM } from '@/lib/ui';

export type JiraPromptTask = {
  id: string;
  title: string;
  taskPoint: number | null;
  totalNormalMin: number;
  totalOtMin: number;
  jiraTicketNo: string | null;
  jiraUrl: string | null;
};

// การ์ดที่ลิงก์กับ Jira อยู่แล้ว — ใช้เลข ticket ถ้ามี ไม่งั้นดึงจาก URL (/browse/KEY-123) หรือใช้ URL ตรงๆ
export function jiraRef(t: JiraPromptTask): string | null {
  if (t.jiraTicketNo) return t.jiraTicketNo;
  if (!t.jiraUrl) return null;
  return t.jiraUrl.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i)?.[1] ?? t.jiraUrl;
}

// รูปแบบเวลาที่ Jira รับใน Log work ("3h 30m") — Rovo เอาไปกรอกต่อได้ตรงๆ
function jiraDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0 && m === 0) return '0m';
  return [h > 0 ? `${h}h` : '', m > 0 ? `${m}m` : ''].filter(Boolean).join(' ');
}

// ชื่อการ์ดอาจมี | (จาก Jira path) — ต้อง escape ไม่งั้นตาราง markdown แตกคอลัมน์
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

const CONFIRM_LINE = 'Before making any changes, show me the list for confirmation. If a field or transition cannot be done in this project, tell me which one.';

// กลุ่ม "สร้าง Jira card" — งานที่ยังไม่มีลิงก์ Jira → สร้าง sub-task ใหม่ใต้ story ที่เปิดอยู่
export function buildCreatePrompt(tasks: JiraPromptTask[]): string {
  const totalPt  = tasks.reduce((s, t) => s + (t.taskPoint ?? 0), 0);
  const totalMin = tasks.reduce((s, t) => s + t.totalNormalMin + t.totalOtMin, 0);
  return [
    'Create the following sub-tasks under the Jira story I currently have open (use it as the parent issue).',
    'Create one sub-task per row and use the Summary exactly as written. For each sub-task:',
    '- Set Story Points to the "Task Point" value (skip if it is "-")',
    '- Log work (time spent) equal to the "Man-Hour" value',
    '- Transition the status to Done',
    '',
    '| # | Summary | Task Point | Man-Hour |',
    '|---|---|---|---|',
    ...tasks.map((t, i) =>
      `| ${i + 1} | ${cell(t.title)} | ${t.taskPoint ?? '-'} | ${jiraDuration(t.totalNormalMin + t.totalOtMin)} |`
    ),
    '',
    `Total: ${tasks.length} sub-tasks · ${totalPt} Task Point · ${jiraDuration(totalMin)}`,
    '',
    CONFIRM_LINE,
  ].join('\n');
}

// กลุ่ม "ปรับ status" — งานที่ลิงก์ Jira อยู่แล้ว → ห้ามสร้างใหม่ แค่ transition ticket เดิมเป็น Done
export function buildStatusPrompt(tasks: JiraPromptTask[]): string {
  return [
    'The following tickets already exist in Jira. Do NOT create new tickets for them — only transition each one to Done:',
    '',
    '| # | Ticket | Summary |',
    '|---|---|---|',
    ...tasks.map((t, i) => `| ${i + 1} | ${cell(jiraRef(t)!)} | ${cell(t.title)} |`),
    '',
    CONFIRM_LINE,
  ].join('\n');
}

type Mode = 'create' | 'status';

export default function JiraPromptModal({
  doneTasks, onClose,
}: {
  doneTasks: JiraPromptTask[];
  onClose: () => void;
}) {
  // แอปแยกกลุ่มให้เอง: ไม่มีลิงก์ Jira → "สร้าง Jira card", มีลิงก์แล้ว → "ปรับ status"
  const createTasks = doneTasks.filter(t => !jiraRef(t));
  const statusTasks = doneTasks.filter(t => jiraRef(t));

  const [mode, setMode] = useState<Mode>(() =>
    createTasks.length === 0 && statusTasks.length > 0 ? 'status' : 'create');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(doneTasks.map(t => t.id)));
  const [copied, setCopied] = useState(false);

  const groupTasks = mode === 'create' ? createTasks : statusTasks;
  const chosen = groupTasks.filter(t => selected.has(t.id));
  const prompt = chosen.length === 0 ? ''
    : mode === 'create' ? buildCreatePrompt(chosen) : buildStatusPrompt(chosen);
  const allChecked = groupTasks.length > 0 && chosen.length === groupTasks.length;

  function switchMode(next: Mode) {
    setMode(next);
    setCopied(false);
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setCopied(false);
  }

  // เลือก/ยกเลิกทั้งหมดเฉพาะกลุ่มที่เปิดอยู่ — ไม่แตะการ์ดของอีกกลุ่ม
  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev);
      groupTasks.forEach(t => { if (allChecked) next.delete(t.id); else next.add(t.id); });
      return next;
    });
    setCopied(false);
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      alert(prompt);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tabs: { key: Mode; label: string; count: number }[] = [
    { key: 'create', label: '➕ สร้าง Jira card', count: createTasks.length },
    { key: 'status', label: '🔄 ปรับ status',     count: statusTasks.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="max-w-[640px] w-full max-h-[85vh] bg-surface-1 border border-app-border rounded-md p-4 flex flex-col gap-3 shadow-[0_18px_48px_rgba(0,0,0,0.5)]">
        <div>
          <h3 className="text-[14px] font-bold text-txt-primary">สร้าง Prompt สำหรับ Jira (Rovo)</h3>
          <p className="text-xs leading-[1.5] text-txt-secondary mt-1">
            {mode === 'create'
              ? 'งานในเลน Done ที่ยังไม่มีลิงก์ Jira — เปิด story ใน Jira แล้ววาง prompt ใน Ask Rovo ระบบจะสร้าง sub-task พร้อม Task Point และ Man-Hour ให้'
              : 'งานในเลน Done ที่มีลิงก์ Jira อยู่แล้ว — วาง prompt ใน Ask Rovo ระบบจะปรับ status ของ ticket เดิมเป็น Done (ไม่สร้างใหม่)'}
          </p>
        </div>

        {doneTasks.length === 0 ? (
          <p className="text-[12.5px] text-txt-muted py-6 text-center">ยังไม่มีงานในเลน Done</p>
        ) : (
          <>
            <div className="flex gap-1 p-1 bg-surface-2 border border-app-border rounded-[5px]" role="tablist">
              {tabs.map(tab => (
                <button key={tab.key} type="button" role="tab" aria-selected={mode === tab.key}
                  onClick={() => switchMode(tab.key)}
                  className={`flex-1 h-[30px] rounded-[3px] text-[12.5px] font-medium transition-colors ${
                    mode === tab.key
                      ? 'bg-surface-1 text-accent border border-app-border shadow-sm'
                      : 'text-txt-secondary hover:text-txt-primary'
                  }`}>
                  {tab.label} <span className="font-mono text-[11px] text-txt-muted">({tab.count})</span>
                </button>
              ))}
            </div>

            {groupTasks.length === 0 ? (
              <p className="text-[12.5px] text-txt-muted py-6 text-center">
                {mode === 'create'
                  ? 'งานในเลน Done มีลิงก์ Jira ครบทุกใบแล้ว — ไม่มีอะไรต้องสร้างใหม่'
                  : 'ยังไม่มีงานในเลน Done ที่ลิงก์ Jira ไว้'}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11.5px] text-txt-muted">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    เลือกทั้งหมด
                  </label>
                  <span>เลือก {chosen.length} / {groupTasks.length}</span>
                </div>
                <div className="flex flex-col gap-1 overflow-y-auto max-h-[38vh] border border-app-border rounded-[3px] p-1.5">
                  {groupTasks.map(t => {
                    const ref = jiraRef(t);
                    return (
                      <label key={t.id}
                        className="flex items-start gap-2 px-2 py-1.5 rounded-[3px] hover:bg-surface-2 cursor-pointer">
                        <input type="checkbox" className="mt-[3px]" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                        <span className="flex-1 min-w-0 text-[12.5px] text-txt-primary leading-snug [overflow-wrap:anywhere]">
                          {ref && <span className="font-mono text-[11px] text-accent mr-1.5">{ref}</span>}
                          {t.title}
                        </span>
                        <span className="text-[11px] text-txt-secondary whitespace-nowrap">
                          {t.taskPoint ?? '–'} PT · {fmtHM(t.totalNormalMin + t.totalOtMin)} ชม.
                        </span>
                      </label>
                    );
                  })}
                </div>
                <textarea readOnly value={prompt} placeholder="เลือกงานอย่างน้อย 1 งาน"
                  className="w-full h-[150px] bg-surface-2 border border-app-border rounded-[3px] p-2 text-[11.5px] font-mono text-txt-secondary resize-none" />
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose}
            className="h-[30px] px-3 border border-app-border text-txt-secondary text-[12.5px] rounded-[3px] hover:bg-surface-2 transition-colors">
            ปิด
          </button>
          <button onClick={copyPrompt} disabled={!prompt}
            className="h-[30px] px-3 bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium rounded-[3px] disabled:opacity-50 transition-colors">
            {copied ? '✓ คัดลอกแล้ว' : mode === 'create' ? '📋 คัดลอก Prompt สร้าง Jira' : '📋 คัดลอก Prompt ปรับ status'}
          </button>
        </div>
      </div>
    </div>
  );
}
