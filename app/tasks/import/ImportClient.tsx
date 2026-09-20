'use client';

import { useEffect, useRef, useState } from 'react';

type Squad     = { id: string; name: string };
type PointRow  = { id: string; point: number; hours: number };
type TypeRow   = { id: string; label: string; order: number };

type Row = {
  id:        string;
  title:     string;
  taskType:  string;        // '' = ยังไม่เลือก — free string เก็บบน Task.taskType ไม่ผูก FK
  ticketRef: string;
  taskPoint: number | null; // null = ยังไม่เลือก
  squadId:   string;        // '' = ไม่ระบุ squad
  // ผูกไว้เบื้องหลังจาก import Jira JSON เท่านั้น — ไม่มี input ให้แก้ในตาราง (มีแค่ badge read-only)
  jiraTicketNo: string | null;
  jiraUrl:      string | null;
  jiraStatus:   string | null;
};

type EpicBanner = { ticketNo: string; url: string; totalPoints: number | null };

function newRow(): Row {
  return {
    id: crypto.randomUUID(), title: '', taskType: '', ticketRef: '', taskPoint: null, squadId: '',
    jiraTicketNo: null, jiraUrl: null, jiraStatus: null,
  };
}

function isRowValid(r: Row): boolean {
  return r.title.trim() !== '' && r.taskPoint !== null;
}

function isValidHttpUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ตัด tag "[QA]" ตัวแรกออกก่อน (ถ้ามี) แล้วดึงกลุ่มวงเล็บที่เหลือต่อจากต้นสตริง เช่น
// "[QA][automation][review pr] เคสทดสอบ..." -> "[automation][review pr]"
function stripLeadingQaTag(summary: string): string {
  return summary.replace(/^\s*\[\s*qa\s*\]\s*/i, '');
}

function extractLeadingBrackets(s: string): string {
  const m = s.match(/^(?:\s*\[[^\]]*\])+/);
  return m ? m[0].trim() : '';
}

// normalize เฉพาะช่องว่างระหว่าง "][" และช่องว่างหัว-ท้าย — ห้ามลบช่องว่าง "ภายใน" แต่ละ tag
// (เช่น "[review pr]" ต้องคงช่องว่างไว้ ไม่งั้นจะไม่ match label ที่ seed ไว้)
function normalizeBracketGroup(s: string): string {
  return s.toLowerCase().replace(/\s*\]\s*\[\s*/g, '][').replace(/\s+/g, ' ').trim();
}

function matchTaskType(summary: string, taskTypes: TypeRow[]): string {
  if (!summary || taskTypes.length === 0) return '';
  const stripped      = stripLeadingQaTag(summary);
  const bracketPrefix = extractLeadingBrackets(stripped);
  if (!bracketPrefix) return '';
  const target = normalizeBracketGroup(bracketPrefix);

  const exact = taskTypes.find(t => normalizeBracketGroup(t.label) === target);
  if (exact) return exact.label;

  // substring match — เทียบตัวที่ label ยาวสุดก่อน กัน "[automation]" ชนะ "[automation][review pr]" ผิดๆ
  const bySubstring = [...taskTypes]
    .sort((a, b) => b.label.length - a.label.length)
    .find(t => {
      const label = normalizeBracketGroup(t.label);
      return target.includes(label) || label.includes(target);
    });
  return bySubstring ? bySubstring.label : '';
}

function jiraItemToRow(item: any, taskTypes: TypeRow[], pointMappings: PointRow[]): Row {
  const ticketNo = item?.ticket_no !== undefined && item?.ticket_no !== null ? String(item.ticket_no).trim() : '';
  const url      = item?.url      !== undefined && item?.url      !== null ? String(item.url).trim()      : '';
  const summary  = item?.summary  !== undefined && item?.summary  !== null ? String(item.summary).trim()  : '';
  const status   = item?.status   !== undefined && item?.status   !== null ? String(item.status).trim()   : '';

  const rawPoints  = item?.task_points;
  const numPoints  = rawPoints !== undefined && rawPoints !== null && String(rawPoints).trim() !== '' && !isNaN(Number(rawPoints))
    ? Number(rawPoints) : null;
  // ต้อง match ค่าที่ตั้งไว้ใน Admin (TaskPointMapping) เป๊ะๆ เหมือน CSV import เดิม ไม่งั้น
  // <select> ในตารางจะโชว์ค่าที่ไม่มีใน option list — ถ้าไม่ match ปล่อยว่างให้ user เลือกเอง
  const taskPoint  = numPoints !== null && pointMappings.some(p => p.point === numPoints) ? numPoints : null;

  return {
    id:        crypto.randomUUID(),
    title:     summary,
    taskType:  matchTaskType(summary, taskTypes),
    ticketRef: ticketNo,
    taskPoint,
    squadId:   '',
    jiraTicketNo: ticketNo || null,
    jiraUrl:      isValidHttpUrl(url) ? url : null,
    jiraStatus:   status || null,
  };
}

function parseEpicBanner(parent: any): EpicBanner | null {
  if (!parent || typeof parent !== 'object') return null;
  const ticketNo = parent.ticket_no !== undefined && parent.ticket_no !== null ? String(parent.ticket_no).trim() : '';
  const url      = parent.url      !== undefined && parent.url      !== null ? String(parent.url).trim()      : '';
  const rawTotal = parent.total_task_points;
  const totalPoints = rawTotal !== undefined && rawTotal !== null && !isNaN(Number(rawTotal)) ? Number(rawTotal) : null;
  if (!ticketNo && !url) return null;
  return { ticketNo, url, totalPoints };
}

function parseJiraJson(
  text: string, taskTypes: TypeRow[], pointMappings: PointRow[],
): { rows: Row[]; epic: EpicBanner | null } {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('รูปแบบ JSON ไม่ตรงตามที่รองรับ');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('รูปแบบ JSON ไม่ตรงตามที่รองรับ');
  }

  const subTasks    = Array.isArray(parsed.parent_ticket?.sub_tasks) ? parsed.parent_ticket.sub_tasks : [];
  const linkedCases = Array.isArray(parsed.linked_test_cases_to_execute) ? parsed.linked_test_cases_to_execute : [];

  // parent_ticket ไม่มีเลย (มีแค่ linked_test_cases_to_execute) ก็ยัง import ได้ปกติ — ข้าม banner เฉยๆ
  if (subTasks.length === 0 && linkedCases.length === 0) {
    throw new Error('รูปแบบ JSON ไม่ตรงตามที่รองรับ — ไม่พบ sub_tasks หรือ linked_test_cases_to_execute');
  }

  const epic = parseEpicBanner(parsed.parent_ticket);
  const rows = [...subTasks, ...linkedCases].map((item: any) => jiraItemToRow(item, taskTypes, pointMappings));
  return { rows, epic };
}

function downloadTemplate() {
  const csv = 'title,squad,taskType,ticketRef,taskPoint\nตัวอย่างงาน 1,SQ1,[create test case],JIRA-101,2\nตัวอย่างงาน 2,SQ2,,,1\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'import-template.csv'; a.click();
  URL.revokeObjectURL(url);
}

async function parseFile(file: File, squads: Squad[], pointMappings: PointRow[]): Promise<Row[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  let rawRows: Record<string, any>[];

  if (ext === 'csv') {
    const Papa = (await import('papaparse')).default;
    const text = await file.text();
    rawRows = (Papa.parse(text, { header: true, skipEmptyLines: true }).data) as Record<string, any>[];
  } else {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }

  return rawRows.map(raw => {
    const squadName    = String(raw.squad ?? '').trim();
    const matchedSquad = squadName ? squads.find(s => s.name === squadName) : undefined;
    const rawPoint      = raw.taskPoint !== undefined && String(raw.taskPoint).trim() !== '' ? Number(raw.taskPoint) : null;
    const matchedPoint  = rawPoint !== null && pointMappings.some(p => p.point === rawPoint) ? rawPoint : null;
    return {
      id:        crypto.randomUUID(),
      title:     String(raw.title ?? '').trim(),
      taskType:  String(raw.taskType ?? '').trim(),
      ticketRef: String(raw.ticketRef ?? '').trim(),
      taskPoint: matchedPoint,
      squadId:   matchedSquad?.id ?? '',
      jiraTicketNo: null,
      jiraUrl:      null,
      jiraStatus:   null,
    };
  });
}

function exportCsv(rows: Row[], sprintLabel: string, squads: Squad[], pointMappings: PointRow[]) {
  const squadName = (id: string) => squads.find(s => s.id === id)?.name ?? '';
  const hoursFor   = (p: number | null) => pointMappings.find(m => m.point === p)?.hours ?? '';
  const header = 'title,squad,taskType,ticketRef,taskPoint,estimateHours';
  const lines = rows.map(r => [r.title, squadName(r.squadId), r.taskType, r.ticketRef, r.taskPoint ?? '', hoursFor(r.taskPoint)]
    .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [header, ...lines].join('\n') + '\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sprint-plan-${sprintLabel.trim() || 'untitled'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportClient({ squads }: { squads: Squad[] }) {
  const fileRef     = useRef<HTMLInputElement>(null);
  const jiraFileRef = useRef<HTMLInputElement>(null);

  const [pointMappings, setPointMappings] = useState<PointRow[]>([]);
  const [taskTypes,     setTaskTypes]     = useState<TypeRow[]>([]);
  const [configLoading, setConfigLoading] = useState(true);

  // Jira JSON import panel
  const [jiraPanelOpen, setJiraPanelOpen] = useState(false);
  const [jiraJsonText,  setJiraJsonText]  = useState('');
  const [jiraJsonError, setJiraJsonError] = useState('');
  const [epicBanner,    setEpicBanner]    = useState<EpicBanner | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/task-point-mapping').then(r => r.json()),
      fetch('/api/admin/task-type-options').then(r => r.json()),
    ]).then(([pm, tt]) => { setPointMappings(pm); setTaskTypes(tt); setConfigLoading(false); });
  }, []);

  const [sprintLabel, setSprintLabel] = useState('');
  const [rows, setRows]               = useState<Row[]>([]);
  const [parsing, setParsing]         = useState(false);
  const [importing, setImporting]     = useState(false);
  const [importDone, setImportDone]   = useState(0);

  function addRow() {
    setRows(prev => [...prev, newRow()]);
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
  }

  function patchRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  async function handleFile(f: File) {
    setParsing(true);
    const parsed = await parseFile(f, squads, pointMappings);
    setRows(prev => [...prev, ...parsed]);
    setParsing(false);
  }

  function applyJiraJson(text: string) {
    try {
      const { rows: newRows, epic } = parseJiraJson(text, taskTypes, pointMappings);
      setRows(prev => [...prev, ...newRows]);
      if (epic) setEpicBanner(epic);
      setJiraJsonError('');
      setJiraJsonText('');
    } catch (err: any) {
      setJiraJsonError(err?.message || 'รูปแบบ JSON ไม่ตรงตามที่รองรับ');
    }
  }

  async function handleJiraJsonFile(f: File) {
    const text = await f.text();
    applyJiraJson(text);
  }

  function hoursOf(r: Row): number | null {
    if (r.taskPoint === null) return null;
    return pointMappings.find(p => p.point === r.taskPoint)?.hours ?? null;
  }

  const totalTasks = rows.length;
  const totalPoint = rows.reduce((s, r) => s + (r.taskPoint ?? 0), 0);
  const totalHours = rows.reduce((s, r) => s + (hoursOf(r) ?? 0), 0);
  const invalidCount = rows.filter(r => !isRowValid(r)).length;
  const canImport = rows.length > 0 && invalidCount === 0 && !importing;

  const pointColorCls  = totalPoint < 13 ? 'text-danger' : totalPoint <= 21 ? 'text-success' : 'text-warning';
  const pointBorderCls = totalPoint < 13 ? 'border-danger/40' : totalPoint <= 21 ? 'border-success/40' : 'border-warning/40';
  const hoursColorCls  = totalHours < 80 ? 'text-danger' : totalHours === 80 ? 'text-success' : 'text-warning';
  const hoursBorderCls = totalHours < 80 ? 'border-danger/40' : totalHours === 80 ? 'border-success/40' : 'border-warning/40';
  // Overall Velocity = point ต่อ estimate-hour ที่วางแผนไว้ — คำนวณจากข้อมูลในตารางเองล้วนๆ
  // (ไม่ใช้ Actual Man-Hour เพราะยังไม่มีความหมายตอน import งานยังไม่เริ่มทำ)
  const overallVelocity = totalHours > 0 ? totalPoint / totalHours : 0;

  async function doImport() {
    if (!canImport) return;
    setImporting(true);
    const res = await fetch('/api/tasks/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        fileName: sprintLabel.trim() || 'import',
        rows: rows.map(r => ({
          title:         r.title.trim(),
          squadId:       r.squadId || undefined,
          taskType:      r.taskType || undefined,
          taskPoint:     r.taskPoint,
          estimateHours: hoursOf(r) ?? undefined,
          jiraTicketNo:  r.jiraTicketNo || undefined,
          jiraUrl:       r.jiraUrl || undefined,
          jiraStatus:    r.jiraStatus || undefined,
        })),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setImportDone(data.count);
      setRows([]);
      setEpicBanner(null);
    }
    setImporting(false);
  }

  const inputCls = 'w-full bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2 py-1.5 rounded-[3px] focus:outline-none focus:border-accent';

  return (
    <div className="px-7 py-6 pb-16">
      <p className="text-[19px] font-semibold text-txt-primary mb-1">Import งานจากไฟล์</p>
      <p className="text-[13px] text-txt-secondary mb-5">
        เพิ่มแถวสด หรืออัปโหลด CSV/Excel เพื่อสร้างงานหลายรายการพร้อมกัน — งานจะไปอยู่ใน "งานทั้งหมด" รอดึงเข้าบอร์ดทีหลัง
      </p>

      {/* Success banner */}
      {importDone > 0 && (
        <div className="flex flex-col gap-1 bg-success-bg border border-success/30 text-success text-[12.5px] px-3 py-2.5 rounded-[3px] mb-5 leading-relaxed">
          <span>✓ Import สำเร็จ {importDone} งาน</span>
          <span className="text-txt-secondary">
            งานอยู่ใน{' '}
            <a href="/tasks" className="text-accent underline">งานทั้งหมด</a>
            {' '}แล้ว — เลือกงานแล้วกด "📥 ดึงเข้าบอร์ด" เพื่อ assign และตั้ง estimate ได้เลย
          </span>
        </div>
      )}

      {configLoading ? (
        <p className="text-[13px] text-txt-secondary">กำลังโหลดค่า Task Point / Task Type จาก Admin Panel...</p>
      ) : (
        <>
          {/* Sprint label — free text, ไม่ผูก Sprint entity จริง ใช้แค่โชว์บนหัวตารางและ export CSV */}
          <div className="flex items-center gap-2 mb-4">
            <label className="text-[12.5px] text-txt-secondary whitespace-nowrap">Sprint</label>
            <input
              type="text"
              value={sprintLabel}
              onChange={e => setSprintLabel(e.target.value)}
              placeholder="เช่น Sprint 45 (สำหรับวางแผนเฉยๆ ไม่ผูกกับ Sprint จริงในระบบ)"
              className="w-[320px] bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2.5 py-1.5 rounded-[3px] focus:outline-none focus:border-accent"
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <button
              onClick={addRow}
              className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-3 py-[7px] rounded-[3px] transition-colors"
            >
              + Add Task
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
              className="bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-3 py-[7px] rounded-[3px] hover:bg-surface-3 transition-colors disabled:opacity-50"
            >
              {parsing ? 'กำลัง parse ไฟล์...' : '📤 Upload CSV/Excel'}
            </button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
            <button
              onClick={() => { setJiraPanelOpen(o => !o); setJiraJsonError(''); }}
              className={`text-[12.5px] px-3 py-[7px] rounded-[3px] transition-colors border ${
                jiraPanelOpen ? 'bg-accent-bg border-accent/40 text-accent' : 'bg-surface-2 border-app-border text-txt-primary hover:bg-surface-3'
              }`}
            >
              📋 วาง JSON จาก Jira
            </button>
            <button
              onClick={() => exportCsv(rows, sprintLabel, squads, pointMappings)}
              disabled={rows.length === 0}
              className="bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-3 py-[7px] rounded-[3px] hover:bg-surface-3 transition-colors disabled:opacity-50"
            >
              ⬇ Export CSV
            </button>
            <button
              onClick={downloadTemplate}
              className="text-[11.5px] text-txt-secondary bg-surface-2 border border-app-border px-2.5 py-[7px] rounded-[3px] hover:text-txt-primary transition-colors"
            >
              ดาวน์โหลด template
            </button>
          </div>

          {/* Jira JSON import panel */}
          {jiraPanelOpen && (
            <div className="bg-surface-1 border border-app-border rounded-[4px] p-3.5 mb-4">
              <p className="text-[12px] text-txt-secondary mb-2">
                วาง JSON จาก Jira ที่นี่ (รองรับโครงสร้าง <code className="text-[11px]">parent_ticket</code> +{' '}
                <code className="text-[11px]">linked_test_cases_to_execute</code>) หรืออัปโหลดไฟล์ .json
              </p>
              <textarea
                rows={6}
                value={jiraJsonText}
                onChange={e => { setJiraJsonText(e.target.value); if (jiraJsonError) setJiraJsonError(''); }}
                placeholder='{"parent_ticket": {...}, "linked_test_cases_to_execute": [...]}'
                className="w-full bg-surface-2 border border-app-border text-txt-primary text-[12px] font-mono px-2.5 py-2 rounded-[3px] focus:outline-none focus:border-accent resize-y"
              />
              {jiraJsonError && <p className="text-[11.5px] text-danger mt-1.5">{jiraJsonError}</p>}
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  onClick={() => applyJiraJson(jiraJsonText)}
                  disabled={!jiraJsonText.trim()}
                  className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-3 py-[7px] rounded-[3px] transition-colors disabled:opacity-50"
                >
                  นำเข้าจาก JSON
                </button>
                <button
                  onClick={() => jiraFileRef.current?.click()}
                  className="bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-3 py-[7px] rounded-[3px] hover:bg-surface-3 transition-colors"
                >
                  📤 Upload .json
                </button>
                <input ref={jiraFileRef} type="file" accept=".json" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleJiraJsonFile(f); e.target.value = ''; }} />
              </div>
            </div>
          )}

          {/* Epic banner — อ้างอิงเฉยๆ ไม่สร้างเป็น task */}
          {epicBanner && (
            <div className="flex items-center justify-between gap-2 bg-accent-bg border border-accent/30 text-[12.5px] text-txt-primary px-3 py-2.5 rounded-[3px] mb-4">
              <span>
                📎 Epic:{' '}
                {isValidHttpUrl(epicBanner.url) ? (
                  <a href={epicBanner.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                    {epicBanner.ticketNo || epicBanner.url}
                  </a>
                ) : (
                  <span className="font-medium">{epicBanner.ticketNo || '—'}</span>
                )}
                {epicBanner.totalPoints !== null && <> · เป้าหมาย {epicBanner.totalPoints} pts</>}
              </span>
              <button onClick={() => setEpicBanner(null)} className="text-txt-muted hover:text-txt-primary text-[12px] flex-shrink-0">✕</button>
            </div>
          )}

          {/* Summary bar — แยกกล่องชัดเจนต่อ metric */}
          <div className="mb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface-1 border border-app-border rounded-[4px] px-4 py-3">
                <div className="text-[11px] text-txt-muted uppercase tracking-wide mb-1">Total Tasks</div>
                <div className="text-[20px] font-semibold text-txt-primary">{totalTasks}</div>
              </div>
              <div className={`bg-surface-1 border rounded-[4px] px-4 py-3 ${pointBorderCls}`}>
                <div className="text-[11px] text-txt-muted uppercase tracking-wide mb-1">Total Task Point</div>
                <div className={`text-[20px] font-semibold ${pointColorCls}`}>{totalPoint}</div>
              </div>
              <div className={`bg-surface-1 border rounded-[4px] px-4 py-3 ${hoursBorderCls}`}>
                <div className="text-[11px] text-txt-muted uppercase tracking-wide mb-1">Total Estimate Man-Hour</div>
                <div className={`text-[20px] font-semibold ${hoursColorCls}`}>{totalHours} ชม.</div>
              </div>
              <div className="bg-surface-1 border border-app-border rounded-[4px] px-4 py-3">
                <div className="text-[11px] text-txt-muted uppercase tracking-wide mb-1">Overall Velocity</div>
                <div className="text-[20px] font-semibold text-txt-primary">{overallVelocity.toFixed(2)} <span className="text-[12px] font-normal text-txt-muted">pt/ชม.</span></div>
              </div>
            </div>
            {invalidCount > 0 && (
              <div className="mt-2 text-[12px] text-danger">
                ▲ {invalidCount} แถวยังไม่ครบ (ต้องมี Story/Task Name และ Task Point) — แก้ให้ครบก่อนกด Import
              </div>
            )}
          </div>

          {/* Editable table */}
          {rows.length > 0 && (
            <div className="overflow-x-auto mb-5">
              <table className="w-full border-collapse bg-surface-1 border border-app-border rounded-[4px] overflow-hidden">
                <thead>
                  <tr className="border-b border-app-border">
                    {['Story/Task Name', 'Task Type', 'Jira/Ticket Ref', 'Jira Status', 'Task Point', 'Estimate Man-Hour', 'Squad', ''].map(h => (
                      <th key={h} className="text-left text-[11.5px] font-medium text-txt-muted uppercase tracking-wide px-3 py-2.5 border-b border-app-border whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const valid = isRowValid(row);
                    const hrs = hoursOf(row);
                    return (
                      <tr key={row.id} className={`border-b border-app-border last:border-none ${!valid ? 'bg-danger/5' : ''}`}>
                        <td className="px-3 py-2 min-w-[200px]">
                          <input type="text" value={row.title} placeholder="ชื่องาน (จำเป็น)"
                            onChange={e => patchRow(row.id, { title: e.target.value })}
                            className={inputCls} />
                        </td>
                        <td className="px-3 py-2 min-w-[220px]">
                          <select value={row.taskType} onChange={e => patchRow(row.id, { taskType: e.target.value })} className={inputCls}>
                            <option value="">— เลือก —</option>
                            {taskTypes.map(t => <option key={t.id} value={t.label}>{t.label}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 min-w-[140px]">
                          <input type="text" value={row.ticketRef} placeholder="เช่น JIRA-123"
                            onChange={e => patchRow(row.id, { ticketRef: e.target.value })}
                            className={inputCls} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {row.jiraStatus ? (
                            <span className="text-[10.5px] font-medium px-2 py-0.5 rounded-full bg-surface-2 border border-app-border text-txt-secondary">
                              {row.jiraStatus}
                            </span>
                          ) : (
                            <span className="text-txt-muted text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 min-w-[130px]">
                          <select
                            value={row.taskPoint ?? ''}
                            onChange={e => patchRow(row.id, { taskPoint: e.target.value === '' ? null : Number(e.target.value) })}
                            className={`${inputCls} ${row.taskPoint === null ? 'border-danger/50' : ''}`}
                          >
                            <option value="">— เลือก —</option>
                            {pointMappings.map(p => <option key={p.id} value={p.point}>{p.point} pt</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-[12.5px] text-txt-secondary whitespace-nowrap">
                          {hrs !== null ? `${hrs} ชม.` : '—'}
                        </td>
                        <td className="px-3 py-2 min-w-[130px]">
                          <select value={row.squadId} onChange={e => patchRow(row.id, { squadId: e.target.value })} className={inputCls}>
                            <option value="">— ไม่ระบุ —</option>
                            {squads.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => removeRow(row.id)}
                            className="text-danger border border-danger/40 bg-danger-bg text-[11.5px] px-2.5 py-1.5 rounded-[3px] hover:bg-danger hover:text-white transition-colors"
                          >
                            ลบ
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rows.length === 0 && (
            <div className="border border-dashed border-app-border rounded-[4px] p-9 text-center mb-5">
              <p className="text-[13px] text-txt-secondary">ยังไม่มีงานในตาราง — กด "+ Add Task" หรือ "📤 Upload CSV/Excel" เพื่อเริ่ม</p>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={doImport}
              disabled={!canImport}
              className="bg-accent text-white text-[13px] px-4 py-2 rounded-[3px] font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {importing ? 'กำลัง import...' : `Import ${totalTasks} งาน`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
