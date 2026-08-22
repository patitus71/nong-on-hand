'use client';

import { useState } from 'react';
import Link from 'next/link';
import { initials, avatarColor, renderReportMarkdown, markdownToPlainText } from '@/lib/ui';


function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}

type RetroItemData = {
  id: string;
  content: string;
  category: string;
  author: { id: string; name: string } | null;
  voteCount: number;
  hasVoted: boolean;
  linkedTaskId: string | null;
};

type RetroData = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
  squadName: string;
  items: RetroItemData[];
};

type DashboardPersonRow = {
  name: string;
  thisWeekTasks: number;
  thisWeekNormalMin: number;
  thisWeekOtMin: number;
  prevWeekTasks: number;
  prevWeekNormalMin: number;
  prevWeekOtMin: number;
};
type DashboardData = { rows: DashboardPersonRow[]; hasPrevWeek: boolean };

// Pie chart ใน export modal — SVG วนตามสัดส่วนงานต่อคน
const PIE_COLORS = ['#6d8cff', '#4fbf7a', '#e3a83e', '#f26b6b', '#a78bfa', '#38bdf8', '#fb923c', '#34d399'];

function PieChart({ rows }: { rows: DashboardPersonRow[] }) {
  const total = rows.reduce((s, r) => s + r.thisWeekTasks, 0);
  if (total === 0) return null;
  const cx = 60, cy = 60, r = 50;
  let angle = -Math.PI / 2;
  const slices: React.ReactNode[] = [];
  rows.forEach((row, i) => {
    if (row.thisWeekTasks === 0) return;
    const slice = (row.thisWeekTasks / total) * 2 * Math.PI;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(angle + slice);
    const y2 = cy + r * Math.sin(angle + slice);
    const large = slice > Math.PI ? 1 : 0;
    slices.push(
      <path key={i}
        d={`M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`}
        fill={PIE_COLORS[i % PIE_COLORS.length]}
        stroke="var(--surface-1)" strokeWidth="1"
      />
    );
    angle += slice;
  });
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ flexShrink: 0 }}>
      {slices}
    </svg>
  );
}

const COLS = [
  { key: 'WENT_WELL',   label: 'Went well',    cls: 'text-success'  },
  { key: 'TO_IMPROVE',  label: 'To improve',   cls: 'text-warning'  },
  { key: 'ACTION_ITEM', label: 'Action items', cls: 'text-accent'   },
] as const;

type ColKey = typeof COLS[number]['key'];

export default function RetroBoardClient({
  squadId, squadName, userId, canExport, retros: initRetros,
}: {
  squadId: string;
  squadName: string;
  userId: string;
  canExport: boolean;
  retros: RetroData[];
}) {
  const [retros, setRetros]           = useState(initRetros);
  const [selectedId, setSelectedId]   = useState<string | null>(
    initRetros.find(r => r.status === 'OPEN')?.id ?? initRetros[0]?.id ?? null
  );
  const [creating, setCreating]       = useState(false);
  const [newTitle, setNewTitle]       = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [closing, setClosing]         = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [addContent, setAddContent]   = useState<Record<ColKey, string>>({
    WENT_WELL: '', TO_IMPROVE: '', ACTION_ITEM: '',
  });

  // Export state
  const [showExport,      setShowExport]      = useState(false);
  const [exporting,       setExporting]       = useState(false);
  const [exportMarkdown,  setExportMarkdown]  = useState<string | null>(null);
  const [exportError,     setExportError]     = useState('');
  const [exportDashboard, setExportDashboard] = useState<DashboardData | null>(null);
  const [copied,          setCopied]          = useState(false);

  const selectedRetro  = retros.find(r => r.id === selectedId) ?? null;
  const hasOpenRetro   = retros.some(r => r.status === 'OPEN');

  function updateSelected(updater: (r: RetroData) => RetroData) {
    setRetros(prev => prev.map(r => r.id === selectedId ? updater(r) : r));
  }

  async function createRetro(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreateSaving(true);
    const res = await fetch('/api/retro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ squadId, title: newTitle.trim() }),
    });
    if (res.ok) {
      const data = await res.json();
      const newRetro: RetroData = {
        id: data.id, title: data.title, status: data.status,
        createdAt: data.createdAt, closedAt: null, squadName, items: [],
      };
      setRetros(prev => [newRetro, ...prev]);
      setSelectedId(newRetro.id);
      setCreating(false);
      setNewTitle('');
    }
    setCreateSaving(false);
  }

  async function closeRetro() {
    if (!selectedRetro) return;
    setClosing(true);
    const res = await fetch(`/api/retro/${selectedRetro.id}/close`, { method: 'PATCH' });
    if (res.ok) {
      const data = await res.json();
      updateSelected(r => ({ ...r, status: 'CLOSED', closedAt: data.closedAt ?? new Date().toISOString() }));
    }
    setClosing(false);
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    const res = await fetch(`/api/retro/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const remaining = retros.filter(r => r.id !== id);
      setRetros(remaining);
      if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
      setConfirmDeleteId(null);
    }
    setDeleting(false);
  }

  async function addCard(col: ColKey) {
    if (!selectedRetro) return;
    const content = addContent[col].trim();
    if (!content) return;
    const res = await fetch(`/api/retro/${selectedRetro.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: col, content }),
    });
    if (res.ok) {
      const data = await res.json();
      const newItem: RetroItemData = {
        id: data.id, content: data.content, category: data.category,
        author: data.author ? { id: userId, name: data.author.name } : null,
        voteCount: 0, hasVoted: false, linkedTaskId: null,
      };
      updateSelected(r => ({ ...r, items: [...r.items, newItem] }));
      setAddContent(prev => ({ ...prev, [col]: '' }));
    }
  }

  async function toggleVote(itemId: string) {
    if (!selectedRetro) return;
    updateSelected(r => ({
      ...r,
      items: r.items.map(item =>
        item.id === itemId
          ? { ...item, hasVoted: !item.hasVoted, voteCount: item.hasVoted ? item.voteCount - 1 : item.voteCount + 1 }
          : item
      ),
    }));
    await fetch(`/api/retro/${selectedRetro.id}/items/${itemId}/vote`, { method: 'POST' });
  }

  async function convertToTask(itemId: string) {
    if (!selectedRetro) return;
    const res = await fetch(`/api/retro/${selectedRetro.id}/items/${itemId}/convert`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      updateSelected(r => ({
        ...r,
        items: r.items.map(item => item.id === itemId ? { ...item, linkedTaskId: data.taskId } : item),
      }));
    }
  }

  async function openExport() {
    if (!selectedRetro) return;
    setExportMarkdown(null);
    setExportError('');
    setShowExport(true);
    setExporting(true);
    const res = await fetch('/api/reports/weekly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        squadId,
        weekStart: selectedRetro.createdAt,
        weekEnd:   selectedRetro.closedAt ?? new Date().toISOString(),
        retroId:   selectedRetro.id,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setExportMarkdown(data.contentMarkdown);
      setExportDashboard(data.dashboard ?? null);
    } else {
      setExportError(await res.text());
    }
    setExporting(false);
  }

  function downloadMarkdown() {
    if (!exportMarkdown || !selectedRetro) return;
    const blob = new Blob([exportMarkdown], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `retro-report-${selectedRetro.title.replace(/\s+/g, '-')}.md`;
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

  return (
    <div className="max-w-[1320px] mx-auto px-7 py-[22px] pb-16 flex gap-5">

      {/* ── Sidebar: retro list ── */}
      <div className="w-52 flex-none">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold text-txt-primary">Retro</span>
          {canExport && !hasOpenRetro && !creating && (
            <button
              onClick={() => setCreating(true)}
              className="text-[12px] text-accent hover:text-accent-hover font-medium"
            >
              + ใหม่
            </button>
          )}
        </div>

        {creating && (
          <form onSubmit={createRetro} className="mb-3">
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="ชื่อ Retro..."
              className="w-full bg-surface-2 border border-accent text-txt-primary text-[12px] px-2.5 py-1.5 rounded-md focus:outline-none mb-1.5"
            />
            <div className="flex gap-1.5">
              <button type="submit" disabled={createSaving || !newTitle.trim()}
                className="flex-1 bg-accent text-white text-[11.5px] py-1 rounded-md disabled:opacity-50">
                สร้าง
              </button>
              <button type="button" onClick={() => { setCreating(false); setNewTitle(''); }}
                className="text-txt-muted text-[11.5px] px-2 hover:text-txt-secondary">
                ยกเลิก
              </button>
            </div>
          </form>
        )}

        <div className="space-y-0.5">
          {retros.length === 0 && !creating && (
            <p className="text-[12px] text-txt-muted px-1">ยังไม่มี Retro</p>
          )}
          {retros.map(r => {
            const isSelected = r.id === selectedId;
            const isOpen     = r.status === 'OPEN';
            return (
              <div key={r.id}>
                <div
                  onClick={() => { setSelectedId(r.id); setConfirmDeleteId(null); }}
                  className={`group relative flex flex-col gap-0.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors border
                    ${isSelected
                      ? 'bg-accent/10 border-accent/30'
                      : 'hover:bg-surface-2 border-transparent'
                    }`}
                >
                  <span className="text-[12.5px] font-medium text-txt-primary leading-tight pr-5 truncate" title={r.title}>
                    {r.title}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {isOpen
                      ? <span className="text-[10px] text-success font-medium">● Open</span>
                      : <span className="text-[10px] text-txt-muted">● Closed</span>
                    }
                    <span className="text-[10px] text-txt-muted">{fmtDate(r.createdAt)}</span>
                  </div>
                  {canExport && (
                    <button
                      title="ลบ Retro นี้"
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(confirmDeleteId === r.id ? null : r.id); }}
                      className="absolute top-2 right-2 text-[12px] text-txt-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {confirmDeleteId === r.id && (
                  <div className="flex items-center gap-2 px-3 py-2 mx-1 mb-0.5 bg-surface-2 border border-app-border rounded-md">
                    <span className="text-[11px] text-txt-secondary flex-1">ลบ &ldquo;{r.title}&rdquo;?</span>
                    <button
                      onClick={() => handleDelete(r.id)}
                      disabled={deleting}
                      className="text-[11px] text-danger font-semibold disabled:opacity-50 hover:underline"
                    >
                      ลบ
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-[11px] text-txt-muted hover:text-txt-secondary"
                    >
                      ยกเลิก
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main board ── */}
      <div className="flex-1 min-w-0">
        {!selectedRetro ? (
          <div className="flex items-center justify-center h-48 text-[13px] text-txt-muted">
            {retros.length === 0 ? 'กด "+ ใหม่" เพื่อสร้าง Retro แรก' : 'เลือก Retro จากรายการทางซ้าย'}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2.5">
              <div className="flex items-center gap-2.5">
                <h1 className="text-[19px] font-semibold text-txt-primary">{selectedRetro.title}</h1>
                {selectedRetro.status === 'OPEN'
                  ? <span className="text-[11px] bg-success-bg text-success px-2.5 py-[3px] rounded-full font-medium">● Open</span>
                  : <span className="text-[11px] bg-surface-2 text-txt-muted px-2.5 py-[3px] rounded-full font-medium">● Closed</span>
                }
              </div>
              <div className="flex items-center gap-2">
                {canExport && selectedRetro.status === 'CLOSED' && (
                  <button
                    onClick={openExport}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-md hover:bg-[#2a2e3a] transition-colors"
                  >
                    📄 Export Report
                  </button>
                )}
                {selectedRetro.status === 'OPEN' && (
                  <button onClick={closeRetro} disabled={closing}
                    className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-md hover:bg-[#2a2e3a] disabled:opacity-50 transition-colors">
                    ปิด Retro นี้
                  </button>
                )}
              </div>
            </div>

            <p className="text-[12.5px] text-txt-secondary mb-5">
              {squadName} · เริ่มเมื่อ {fmtDate(selectedRetro.createdAt)}
              {selectedRetro.closedAt && ` · ปิดเมื่อ ${fmtDate(selectedRetro.closedAt)}`}
            </p>

            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {COLS.map(col => {
                const colItems = selectedRetro.items.filter(i => i.category === col.key);
                const isOpen   = selectedRetro.status === 'OPEN';
                return (
                  <div key={col.key} className="bg-surface-1 border border-app-border rounded-[12px] p-3">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-[13.5px] font-semibold ${col.cls}`}>{col.label}</span>
                      <span className="text-[11px] text-txt-muted">{colItems.length}</span>
                    </div>

                    {colItems.map(item => (
                      <RetroCard
                        key={item.id}
                        item={item}
                        colKey={col.key}
                        isOpen={isOpen}
                        onVote={() => toggleVote(item.id)}
                        onConvert={() => convertToTask(item.id)}
                      />
                    ))}

                    {isOpen && (
                      <input
                        value={addContent[col.key]}
                        onChange={e => setAddContent(prev => ({ ...prev, [col.key]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCard(col.key); } }}
                        placeholder="+ เพิ่มการ์ด..."
                        className="w-full bg-surface-2 border border-dashed border-app-border text-txt-primary text-[12.5px] px-2.5 py-[9px] rounded-lg focus:outline-none mt-1 placeholder:text-txt-muted"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Export modal ── */}
      {showExport && selectedRetro && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={e => { if (e.target === e.currentTarget) setShowExport(false); }}
        >
          <div className="bg-surface-1 border border-app-border rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
              <div>
                <h2 className="text-[15px] font-semibold text-txt-primary">📄 Export Report</h2>
                <p className="text-[12px] text-txt-muted mt-0.5">
                  {selectedRetro.title} · {fmtDate(selectedRetro.createdAt)}
                  {' → '}
                  {selectedRetro.closedAt ? fmtDate(selectedRetro.closedAt) : 'ปัจจุบัน'}
                </p>
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
                  {/* Dashboard Overview */}
                  {exportDashboard && exportDashboard.rows.length > 0 && (
                    <div style={{ marginBottom: 20, padding: 14, background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--app-border)' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt-primary)', marginBottom: 10 }}>Dashboard — สรุปภาพรวม</p>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                        {/* ตาราง */}
                        <div style={{ flex: 1, overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', padding: '5px 8px', background: 'var(--surface-3, var(--bg))', color: 'var(--txt-secondary)', border: '1px solid var(--app-border)', whiteSpace: 'nowrap' }}>คน</th>
                                {exportDashboard.hasPrevWeek && <th style={{ textAlign: 'right', padding: '5px 8px', background: 'var(--surface-3, var(--bg))', color: 'var(--txt-secondary)', border: '1px solid var(--app-border)', whiteSpace: 'nowrap' }}>ก่อน (งาน)</th>}
                                <th style={{ textAlign: 'right', padding: '5px 8px', background: 'var(--surface-3, var(--bg))', color: 'var(--txt-secondary)', border: '1px solid var(--app-border)', whiteSpace: 'nowrap' }}>นี้ (งาน)</th>
                                {exportDashboard.hasPrevWeek && <th style={{ textAlign: 'right', padding: '5px 8px', background: 'var(--surface-3, var(--bg))', color: 'var(--txt-secondary)', border: '1px solid var(--app-border)', whiteSpace: 'nowrap' }}>Δ</th>}
                                <th style={{ textAlign: 'left', padding: '5px 8px', background: 'var(--surface-3, var(--bg))', color: 'var(--txt-secondary)', border: '1px solid var(--app-border)' }}>Legend</th>
                              </tr>
                            </thead>
                            <tbody>
                              {exportDashboard.rows.map((r, i) => {
                                const improved = exportDashboard.hasPrevWeek && r.thisWeekTasks > r.prevWeekTasks;
                                const delta = exportDashboard.hasPrevWeek
                                  ? (r.prevWeekTasks === 0
                                    ? (r.thisWeekTasks > 0 ? '+' + r.thisWeekTasks : '—')
                                    : (r.thisWeekTasks >= r.prevWeekTasks ? '+' : '') + (r.thisWeekTasks - r.prevWeekTasks) + ' (' + Math.round(((r.thisWeekTasks - r.prevWeekTasks) / r.prevWeekTasks) * 100) + '%)')
                                  : null;
                                return (
                                  <tr key={r.name} style={{ background: improved ? 'rgba(79,191,122,.08)' : undefined }}>
                                    <td style={{ padding: '5px 8px', border: '1px solid var(--app-border)', color: 'var(--txt-primary)' }}>{r.name}</td>
                                    {exportDashboard.hasPrevWeek && <td style={{ padding: '5px 8px', border: '1px solid var(--app-border)', color: 'var(--txt-muted)', textAlign: 'right' }}>{r.prevWeekTasks}</td>}
                                    <td style={{ padding: '5px 8px', border: '1px solid var(--app-border)', color: 'var(--txt-primary)', fontWeight: 600, textAlign: 'right' }}>{r.thisWeekTasks}</td>
                                    {exportDashboard.hasPrevWeek && <td style={{ padding: '5px 8px', border: '1px solid var(--app-border)', color: improved ? 'var(--success)' : 'var(--txt-muted)', textAlign: 'right' }}>{delta}</td>}
                                    <td style={{ padding: '5px 8px', border: '1px solid var(--app-border)' }}>
                                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], marginRight: 4 }} />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {/* Pie chart */}
                        <PieChart rows={exportDashboard.rows} />
                      </div>
                    </div>
                  )}
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
                  <span className="text-[11.5px] text-txt-muted ml-auto">บันทึกลง DB แล้ว</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RetroCard({ item, colKey, isOpen, onVote, onConvert }: {
  item: RetroItemData;
  colKey: ColKey;
  isOpen: boolean;
  onVote: () => void;
  onConvert: () => void;
}) {
  const av = item.author ? avatarColor(item.author.name) : null;

  return (
    <div className="bg-surface-2 border border-app-border rounded-lg p-[11px] mb-2">
      {item.linkedTaskId && colKey === 'TO_IMPROVE' && (
        <Link href={`/tasks/${item.linkedTaskId}`}
          className="flex items-center gap-1 text-[11px] text-accent mb-2 hover:underline">
          🔗 ดูงานที่เชื่อมโยง
        </Link>
      )}

      <p className="text-[13px] text-txt-primary leading-relaxed mb-2">{item.content}</p>

      {colKey === 'ACTION_ITEM' ? (
        <div className="flex items-center justify-between mt-1.5">
          {item.author && av ? (
            <div className="flex items-center gap-1.5 text-[11px] text-txt-secondary">
              <span className="w-[17px] h-[17px] rounded-full text-[8.5px] font-semibold flex items-center justify-center"
                style={{ background: av.bg, color: av.fg }}>
                {initials(item.author.name)}
              </span>
              รับผิดชอบ: {item.author.name.split(' ')[0]}
            </div>
          ) : <span />}
          {isOpen && (
            item.linkedTaskId ? (
              <Link href={`/tasks/${item.linkedTaskId}`} className="text-[10.5px] text-accent hover:underline">ดูงาน →</Link>
            ) : (
              <button onClick={onConvert}
                className="text-[10.5px] text-txt-secondary px-2 py-1 rounded-md hover:text-txt-primary transition-colors"
                style={{ background: 'var(--surface-3)', border: 'none', cursor: 'pointer' }}>
                แปลงเป็นงาน
              </button>
            )
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          {item.author && av ? (
            <div className="flex items-center gap-1.5 text-[11px] text-txt-secondary">
              <span className="w-[17px] h-[17px] rounded-full text-[8.5px] font-semibold flex items-center justify-center"
                style={{ background: av.bg, color: av.fg }}>
                {initials(item.author.name)}
              </span>
              {item.author.name.split(' ')[0]}
            </div>
          ) : <span />}
          <button
            onClick={isOpen ? onVote : undefined}
            className={`flex items-center gap-1 text-[11.5px] px-2.5 py-[3px] rounded-full transition-colors ${
              item.hasVoted ? 'bg-accent-bg text-accent' : 'text-txt-secondary'
            }`}
            style={!item.hasVoted
              ? { background: 'var(--surface-3)', border: 'none', cursor: isOpen ? 'pointer' : 'default' }
              : { border: 'none', cursor: isOpen ? 'pointer' : 'default' }}
          >
            ▲ {item.voteCount}
          </button>
        </div>
      )}
    </div>
  );
}
