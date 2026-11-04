'use client';

// Admin Panel → แท็บ Tags (ADMIN เท่านั้น — หน้า /admin redirect role อื่นออก และทุก API เช็ค 403 ซ้ำ)
// ตาม design-reference/tags-design.html แท็บ 1: ตาราง Tag / Deeplink / Ticket / สถานะ / จัดการ
// ไม่มีการลบ Tag ที่มี ticket ผูก — ใช้ Archive / กู้คืน; ลบจริงได้เฉพาะ Tag ที่มี 0 ticket (สร้างผิด)

import { useCallback, useEffect, useMemo, useState } from 'react';
import TagChip from '@/components/TagChip';
import { invalidateTagCache } from '@/components/TagPicker';
import {
  TAG_KIND_GROUP_LABEL, TAG_KIND_LABEL, TAG_KINDS, validateTagName, validateTagUrl, type TagKind, type TagLite,
} from '@/lib/tags';

type TagRow = TagLite & { ticketCount: number; createdAt: string; updatedAt: string };
type Filter = 'active' | 'archived' | 'all';

const btnSm = 'text-[12px] px-2.5 py-1 rounded-[3px] border border-app-border bg-surface-2 text-txt-primary hover:bg-surface-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const btnPrimary = 'bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-3.5 py-2 rounded-[3px] transition-colors disabled:opacity-50';
const btnCancel = 'px-4 py-2 text-[12.5px] text-txt-muted border border-app-border rounded-[3px] hover:bg-surface-2 transition-colors';
const inputCls = 'w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-[3px] focus:outline-none focus:border-accent';

export default function TagsTab() {
  const [rows, setRows] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState('');

  const [editTarget, setEditTarget] = useState<TagRow | 'new' | null>(null);
  const [moveTarget, setMoveTarget] = useState<TagRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TagRow | null>(null);

  const reload = useCallback(async () => {
    setLoadError('');
    const res = await fetch('/api/tags?includeArchived=1', { cache: 'no-store' });
    if (res.ok) setRows(await res.json());
    else setLoadError((await res.text()) || 'โหลดรายการ Tag ไม่สำเร็จ');
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /** หลังแก้อะไรก็ตาม: ล้าง cache ของ TagPicker + โหลดตารางใหม่ (ticketCount เปลี่ยนได้) */
  const afterMutation = useCallback(async () => { invalidateTagCache(); await reload(); }, [reload]);

  const counts = useMemo(() => ({
    active: rows.filter(r => !r.isArchived).length,
    archived: rows.filter(r => r.isArchived).length,
    all: rows.length,
  }), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(r => filter === 'all' || (filter === 'archived' ? r.isArchived : !r.isArchived))
      .filter(r => !q || r.name.toLowerCase().includes(q) || (r.url ?? '').toLowerCase().includes(q))
      .sort((a, b) => Number(a.isArchived) - Number(b.isArchived)
        || TAG_KINDS.indexOf(a.kind) - TAG_KINDS.indexOf(b.kind)
        || a.name.localeCompare(b.name, 'th'));
  }, [rows, filter, query]);

  async function setArchived(row: TagRow, isArchived: boolean) {
    setBusyId(row.id); setRowError('');
    const res = await fetch(`/api/tags/${row.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isArchived }),
    });
    if (res.ok) await afterMutation();
    else setRowError(await res.text());
    setBusyId(null);
  }

  const chipFilterCls = (on: boolean) =>
    `text-[12px] px-3 py-[5px] rounded-full border transition-colors ${on
      ? 'bg-accent-bg border-accent text-accent'
      : 'bg-surface-1 border-app-border text-txt-secondary hover:text-txt-primary'}`;

  return (
    <div className="pt-5">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="ค้นหา Tag..."
          className={`${inputCls} !w-60`}
        />
        <button className={chipFilterCls(filter === 'active')} onClick={() => setFilter('active')}>ใช้งานอยู่ ({counts.active})</button>
        <button className={chipFilterCls(filter === 'archived')} onClick={() => setFilter('archived')}>Archived ({counts.archived})</button>
        <button className={chipFilterCls(filter === 'all')} onClick={() => setFilter('all')}>ทั้งหมด ({counts.all})</button>
        <div className="flex-1" />
        <button className={btnPrimary} onClick={() => setEditTarget('new')}>+ สร้าง Tag ใหม่</button>
      </div>

      {rowError && <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-[3px] mb-3">{rowError}</p>}

      {loading ? (
        <p className="text-txt-muted text-[13px]">กำลังโหลด...</p>
      ) : loadError ? (
        <p className="text-[12.5px] text-danger">{loadError} <button className="underline" onClick={reload}>ลองใหม่</button></p>
      ) : (
        <div className="overflow-hidden border border-app-border rounded-[4px]">
          <table className="w-full border-collapse bg-surface-1">
            <thead>
              <tr className="border-b border-app-border">
                {['Tag', 'Deeplink', 'Ticket', 'สถานะ'].map(h => (
                  <th key={h} className="text-left text-[11.5px] font-medium text-txt-muted uppercase tracking-wide px-3.5 py-2.5">{h}</th>
                ))}
                <th className="text-right text-[11.5px] font-medium text-txt-muted uppercase tracking-wide px-3.5 py-2.5">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={5} className="px-3.5 py-6 text-center text-[13px] text-txt-muted">
                  {rows.length === 0 ? 'ยังไม่มี Tag — กด "+ สร้าง Tag ใหม่" เพื่อเริ่ม' : 'ไม่พบ Tag ที่ตรงกับเงื่อนไข'}
                </td></tr>
              )}
              {visible.map(r => {
                const busy = busyId === r.id;
                return (
                  <tr key={r.id} className={`border-b border-app-border last:border-0 ${r.isArchived ? 'bg-surface-2/40' : ''}`}>
                    <td className="px-3.5 py-2.5"><TagChip tag={r} linkable={false} /></td>
                    <td className="px-3.5 py-2.5 max-w-[280px]">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" title={r.url}
                          className={`block truncate text-[12px] hover:underline ${r.isArchived ? 'text-txt-muted' : 'text-accent'}`}>{r.url}</a>
                      ) : <span className="text-[12px] text-txt-muted">— ไม่มีลิงก์</span>}
                    </td>
                    <td className="px-3.5 py-2.5 text-[13px] text-txt-primary">{r.ticketCount}</td>
                    <td className="px-3.5 py-2.5">
                      {r.isArchived
                        ? <span className="text-[11.5px] px-2.5 py-[3px] rounded-full font-medium bg-surface-3 text-txt-muted">Archived</span>
                        : <span className="text-[11.5px] px-2.5 py-[3px] rounded-full font-medium bg-success-bg text-success">ใช้งานอยู่</span>}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        {!r.isArchived && (
                          <button className={btnSm} disabled={busy || r.ticketCount === 0}
                            title={r.ticketCount === 0 ? 'Tag นี้ยังไม่มี ticket ให้ย้าย' : undefined}
                            onClick={() => setMoveTarget(r)}>ย้าย ticket</button>
                        )}
                        <button className={btnSm} disabled={busy} onClick={() => setEditTarget(r)}>แก้ไข</button>
                        {r.isArchived ? (
                          <button className={`${btnSm} ${busy ? 'btn-loading' : ''}`} disabled={busy} onClick={() => setArchived(r, false)}>กู้คืน</button>
                        ) : (
                          <button className={`${btnSm} !text-danger ${busy ? 'btn-loading' : ''}`} disabled={busy} onClick={() => setArchived(r, true)}>Archive</button>
                        )}
                        {r.ticketCount === 0 && (
                          <button className={`${btnSm} !text-danger`} disabled={busy} title="ลบได้เพราะยังไม่มี ticket ผูก (สำหรับ Tag ที่สร้างผิด)"
                            onClick={() => setDeleteTarget(r)}>ลบ</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[12px] text-txt-secondary bg-accent-bg rounded-lg px-3 py-2.5 mt-3.5 leading-relaxed">
        💡 <b>Archive แทนการลบ</b> — ticket เก่ายังเห็น Tag เดิมเป็นประวัติ แต่ Tag ที่ archive แล้วจะไม่โผล่ในตัวเลือกตอนติด Tag ใหม่
        · แก้ลิงก์ที่ Tag ครั้งเดียว ทุก ticket ที่ผูกอยู่เปลี่ยนตามทันที
        · ปุ่ม <b>ลบ</b> มีเฉพาะ Tag ที่ยังไม่มี ticket ผูก (กรณีสร้างผิด)
        · เฉพาะ <b>ADMIN</b> เท่านั้นที่เห็นแท็บนี้
      </p>

      {editTarget && (
        <TagFormModal
          target={editTarget === 'new' ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => { setEditTarget(null); await afterMutation(); }}
        />
      )}
      {moveTarget && (
        <MoveModal
          from={moveTarget}
          destinations={rows.filter(r => !r.isArchived && r.id !== moveTarget.id)}
          onClose={() => setMoveTarget(null)}
          onDone={async () => { setMoveTarget(null); await afterMutation(); }}
        />
      )}
      {deleteTarget && (
        <DeleteModal
          tag={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={async () => { setDeleteTarget(null); await afterMutation(); }}
        />
      )}
    </div>
  );
}

// ─── Modal: สร้าง / แก้ไข Tag ──────────────────────────────────────────────────

function TagFormModal({ target, onClose, onSaved }: {
  target: TagRow | null; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(target?.name ?? '');
  const [kind, setKind] = useState<TagKind>(target?.kind ?? 'STORY');
  const [url, setUrl] = useState(target?.url ?? '');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');

  const nameCheck = validateTagName(name);
  const urlCheck = validateTagUrl(url);
  const canSave = nameCheck.ok && urlCheck.ok && !saving;

  async function submit() {
    setTouched(true);
    if (!nameCheck.ok || !urlCheck.ok) return;
    setSaving(true); setServerError('');
    const res = await fetch(target ? `/api/tags/${target.id}` : '/api/tags', {
      method: target ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameCheck.value, kind, url: urlCheck.value }),
    });
    if (res.ok) { await onSaved(); return; }
    setServerError((await res.text()) || 'บันทึกไม่สำเร็จ');
    setSaving(false);
  }

  return (
    <ModalShell onClose={saving ? undefined : onClose}>
      <h3 className="text-[16px] font-semibold text-txt-primary mb-1">{target ? 'แก้ไข Tag' : 'สร้าง Tag ใหม่'}</h3>
      <p className="text-[12.5px] text-txt-secondary mb-4">
        Tag ใช้ร่วมกันทุก Squad{target && target.ticketCount > 0 ? ` · แก้แล้วมีผลกับ ${target.ticketCount} ticket ที่ผูกอยู่ทันที` : ''}
      </p>

      <label className="block mb-3.5">
        <span className="block text-[12px] text-txt-secondary mb-1">ชื่อ Tag</span>
        <input autoFocus value={name} onChange={e => { setName(e.target.value); setServerError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="เช่น Checkout Promo Code" className={inputCls} maxLength={120} />
        {touched && !nameCheck.ok && <span className="block text-[11.5px] text-danger mt-1">{nameCheck.error}</span>}
      </label>

      <div className="mb-3.5">
        <span className="block text-[12px] text-txt-secondary mb-1">ชนิด</span>
        <div className="flex gap-2" role="radiogroup" aria-label="ชนิด Tag">
          {TAG_KINDS.map(k => (
            <button key={k} type="button" role="radio" aria-checked={kind === k}
              onClick={() => { setKind(k); setServerError(''); }}
              className={`flex-1 text-center text-[12.5px] py-2 rounded-md border transition-colors ${kind === k
                ? 'border-accent bg-accent-bg text-txt-primary'
                : 'border-app-border text-txt-secondary hover:text-txt-primary'}`}>
              {TAG_KIND_GROUP_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <label className="block mb-3.5">
        <span className="block text-[12px] text-txt-secondary mb-1">Deeplink <span className="text-txt-muted">(ไม่บังคับ)</span></span>
        <input value={url} onChange={e => { setUrl(e.target.value); setServerError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="https://jira.company.com/browse/SR-xxxxx" className={inputCls} />
        {(touched || url.trim()) && !urlCheck.ok
          ? <span className="block text-[11.5px] text-danger mt-1">{urlCheck.error}</span>
          : <span className="block text-[11.5px] text-txt-muted mt-1">รองรับเฉพาะ http:// และ https:// เท่านั้น</span>}
      </label>

      <div className="flex items-center gap-2.5 bg-surface-2 rounded-lg px-3 py-2.5 text-[12px] text-txt-secondary">
        ตัวอย่าง:
        <TagChip linkable={false} showArrow
          tag={{ name: nameCheck.ok ? nameCheck.value : (name.trim() || 'ชื่อ Tag'), kind, url: urlCheck.ok ? urlCheck.value : null, isArchived: false }} />
        <span className="text-txt-muted">({TAG_KIND_LABEL[kind]})</span>
      </div>

      {serverError && <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-[3px] mt-3">{serverError}</p>}

      <div className="flex justify-end gap-2 mt-5">
        <button className={btnCancel} onClick={onClose} disabled={saving}>ยกเลิก</button>
        <button className={`${btnPrimary} ${saving ? 'btn-loading' : ''}`} onClick={submit} disabled={!canSave && touched}>บันทึก</button>
      </div>
    </ModalShell>
  );
}

// ─── Modal: ย้าย ticket ไป Tag ใหม่ ─────────────────────────────────────────────

function MoveModal({ from, destinations, onClose, onDone }: {
  from: TagRow; destinations: TagRow[]; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [toTagId, setToTagId] = useState('');
  const [archiveFrom, setArchiveFrom] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const to = destinations.find(d => d.id === toTagId);

  async function submit() {
    if (!to) return;
    if (!confirming) { setConfirming(true); return; }
    setSaving(true); setError('');
    const res = await fetch(`/api/tags/${from.id}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTagId, archiveFrom }),
    });
    if (res.ok) { await onDone(); return; }
    setError((await res.text()) || 'ย้ายไม่สำเร็จ');
    setSaving(false); setConfirming(false);
  }

  return (
    <ModalShell onClose={saving ? undefined : onClose}>
      <h3 className="text-[16px] font-semibold text-txt-primary mb-1">ย้าย ticket ไป Tag ใหม่</h3>
      <p className="text-[12.5px] text-txt-secondary mb-4">ใช้ตอนขึ้น Sprint ใหม่ — ย้าย ticket ทั้งหมดจาก Tag เก่าไป Tag ใหม่ในคลิกเดียว</p>

      <div className="mb-3.5">
        <span className="block text-[12px] text-txt-secondary mb-1">จาก</span>
        <TagChip tag={from} linkable={false} /> <span className="text-[12px] text-txt-muted">· {from.ticketCount} ticket</span>
      </div>

      <label className="block mb-3.5">
        <span className="block text-[12px] text-txt-secondary mb-1">ไปที่</span>
        <select value={toTagId} onChange={e => { setToTagId(e.target.value); setConfirming(false); setError(''); }} className={inputCls} disabled={saving}>
          <option value="">เลือก Tag ปลายทาง...</option>
          {TAG_KINDS.map(k => {
            const opts = destinations.filter(d => d.kind === k);
            if (opts.length === 0) return null;
            return (
              <optgroup key={k} label={TAG_KIND_GROUP_LABEL[k]}>
                {opts.map(d => <option key={d.id} value={d.id}>{TAG_KIND_LABEL[d.kind]} · {d.name}</option>)}
              </optgroup>
            );
          })}
        </select>
        {destinations.length === 0 && <span className="block text-[11.5px] text-txt-muted mt-1">ยังไม่มี Tag ปลายทางที่ใช้งานอยู่ — สร้าง Tag ใหม่ก่อน</span>}
      </label>

      <label className="flex items-center gap-2 text-[12.5px] text-txt-secondary cursor-pointer">
        <input type="checkbox" checked={archiveFrom} disabled={saving}
          onChange={e => { setArchiveFrom(e.target.checked); setConfirming(false); }}
          className="w-4 h-4 accent-[rgb(var(--accent))]" />
        Archive Tag เดิมอัตโนมัติหลังย้ายเสร็จ
      </label>

      {confirming && to && (
        <p className="text-[12px] text-warning bg-warning-bg px-3 py-2 rounded-[3px] mt-3.5 leading-relaxed">
          ⚠ ยืนยันย้าย {from.ticketCount} ticket จาก &quot;{from.name}&quot; ไป &quot;{to.name}&quot;
          {archiveFrom ? ` แล้ว Archive "${from.name}"` : ''} — ticket ที่มี &quot;{to.name}&quot; อยู่แล้วจะไม่ถูกติดซ้ำ
        </p>
      )}
      {error && <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-[3px] mt-3">{error}</p>}

      <div className="flex justify-end gap-2 mt-5">
        <button className={btnCancel} onClick={confirming ? () => setConfirming(false) : onClose} disabled={saving}>
          {confirming ? 'ย้อนกลับ' : 'ยกเลิก'}
        </button>
        <button className={`${btnPrimary} ${saving ? 'btn-loading' : ''}`} onClick={submit} disabled={!to || saving}>
          {confirming ? `ยืนยันย้าย ${from.ticketCount} ticket` : `ย้าย ${from.ticketCount} ticket`}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Modal: ลบ Tag (เฉพาะ 0 ticket) ────────────────────────────────────────────

function DeleteModal({ tag, onClose, onDone }: { tag: TagRow; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSaving(true); setError('');
    const res = await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' });
    if (res.ok) { await onDone(); return; }
    setError((await res.text()) || 'ลบไม่สำเร็จ');
    setSaving(false);
  }

  return (
    <ModalShell onClose={saving ? undefined : onClose} width="w-[400px]">
      <h3 className="text-[15px] font-semibold text-danger mb-1">🗑 ลบ Tag นี้?</h3>
      <p className="text-[12.5px] text-txt-secondary mb-3 leading-relaxed flex items-center gap-2 flex-wrap">
        ยืนยันการลบ <TagChip tag={tag} linkable={false} />
      </p>
      <p className="text-[12px] text-warning bg-warning-bg px-3 py-2 rounded-[3px] mb-4 leading-relaxed">
        ⚠ ลบแล้วกู้คืนไม่ได้ — ใช้สำหรับ Tag ที่สร้างผิดและยังไม่มี ticket ผูกเท่านั้น ถ้าแค่เลิกใช้ให้กด Archive แทน
      </p>
      {error && <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-[3px] mb-3">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button className={btnCancel} onClick={onClose} disabled={saving}>ยกเลิก</button>
        <button onClick={submit} disabled={saving}
          className={`bg-danger border border-danger text-white text-[12.5px] font-medium px-4 py-2 rounded-[3px] transition-colors disabled:opacity-50 ${saving ? 'btn-loading' : ''}`}>
          ยืนยันลบ
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose, width = 'w-[460px]' }: { children: React.ReactNode; onClose?: () => void; width?: string }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55" onMouseDown={() => onClose?.()}>
      <div className={`bg-surface-1 border border-app-border rounded-[10px] p-[22px] ${width} max-w-[92vw] shadow-xl`} onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
