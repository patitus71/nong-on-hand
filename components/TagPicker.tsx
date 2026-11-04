'use client';

// components/TagPicker.tsx — กล่องเลือก Tag (หลายอัน) ตัวเดียวที่ใช้ทุกหน้า:
// Task detail, สร้างงานใน "SQ ของฉัน", สร้างการ์ดใน "บอร์ดของฉัน", import
// - แสดง chip ที่เลือกแล้ว + × + ปุ่ม "+ เพิ่ม Tag" → dropdown มีช่องค้นหา จัดกลุ่ม Epic / Story / อื่นๆ
// - ตัวเลือกแสดงเฉพาะ Tag ที่ไม่ archived — ยกเว้นอันที่ติดอยู่แล้ว (ยังเห็นและเอาออกได้)
// - สร้าง Tag ใหม่ไม่ได้ (เฉพาะ ADMIN ที่ Admin Panel → Tags)
// - component นี้ไม่ยิง API บันทึกเอง — แจ้ง onChange ให้หน้าแม่ตัดสินใจ (บันทึกทันที หรือส่งไปพร้อมฟอร์ม)

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TagChip from '@/components/TagChip';
import { TAG_KIND_GROUP_LABEL, TAG_KINDS, type TagLite } from '@/lib/tags';

// ─── รายการ Tag ฝั่ง client: โชว์ของที่จำไว้ทันที แล้วโหลดของล่าสุดเบื้องหลังทุกครั้งที่เปิด ───
// (stale-while-revalidate — เปิดไวและไม่พลาด Tag ที่ ADMIN เพิ่งสร้าง)
// inflight กันหลาย picker ในหน้าเดียวยิงซ้ำพร้อมกัน
let lastTags: TagLite[] | null = null;
let inflight: Promise<TagLite[]> | null = null;

export function fetchActiveTags(): Promise<TagLite[]> {
  if (inflight) return inflight;
  inflight = fetch('/api/tags', { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) throw new Error((await r.text()) || 'โหลดรายการ Tag ไม่สำเร็จ');
      const rows = (await r.json()) as TagLite[];
      lastTags = rows;
      return rows;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** เรียกหลัง ADMIN สร้าง/แก้/archive Tag — ทิ้งของที่จำไว้ */
export function invalidateTagCache() { lastTags = null; }

type TagPickerProps = {
  /** Tag ที่ติดอยู่ตอนนี้ (รวม archived ที่ติดอยู่แล้วด้วย) */
  value: TagLite[];
  onChange: (next: TagLite[]) => void;
  /** read-only: แสดงแค่ chip ไม่มี × / ปุ่มเพิ่ม */
  disabled?: boolean;
  /** กำลังบันทึก — ปิดการแก้ชั่วคราว */
  busy?: boolean;
  /** 'inline' = ตามหน้า Task detail, 'field' = กล่องมีขอบแบบช่องกรอกในฟอร์มสร้างงาน */
  variant?: 'inline' | 'field';
  /** ข้อความเมื่อยังไม่มี Tag และเป็น read-only */
  emptyText?: string;
  className?: string;
  /**
   * รายการตัวเลือกที่กำหนดเอง (เช่น ตัวกรองบนบอร์ด = Tag ที่อยู่บนการ์ดในหน้านั้น) — ไม่ยิง /api/tags
   * และแสดงทุกตัวที่ส่งมา (รวม archived) — ไม่ส่ง = ดึง Tag ที่ใช้งานอยู่จาก /api/tags (ติด Tag ให้ ticket)
   */
  options?: TagLite[];
  /** ข้อความปุ่มเปิด dropdown (default "+ เพิ่ม Tag") */
  addLabel?: string;
  /** แสดง footer "ไม่เจอ Tag? ให้ ADMIN สร้าง" (default true) */
  showFooter?: boolean;
  /** chip ที่เลือกแล้วเป็นลิงก์ไป deeplink ได้ (default true) */
  chipsLinkable?: boolean;
};

export default function TagPicker({
  value, onChange, disabled, busy, variant = 'inline', emptyText = '— ยังไม่มี Tag', className = '',
  options: fixedOptions, addLabel = '+ เพิ่ม Tag', showFooter = true, chipsLinkable = true,
}: TagPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<TagLite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // dropdown ลอยด้วย position:fixed ผ่าน portal — ไม่โดนตัดโดยกล่องแม่ที่ overflow-hidden (เช่น เลนใน My Board)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const listId = useId();

  const selectedIds = useMemo(() => new Set(value.map(t => t.id)), [value]);

  // ส่ง options มาเอง → ใช้ตรงๆ ไม่ยิง API (อ่านผ่าน ref เพื่อไม่ให้ effect ตอนเปิด dropdown รันซ้ำทุก render)
  const hasFixedOptions = useRef(false);
  hasFixedOptions.current = !!fixedOptions;
  const effectiveOptions = fixedOptions ?? options;

  const load = useCallback(() => {
    setLoadError(null);
    if (hasFixedOptions.current) return;
    if (lastTags) setOptions(lastTags); // โชว์ของเดิมทันที
    fetchActiveTags()
      .then(setOptions)
      .catch((e: Error) => { if (!lastTags) setLoadError(e.message); }); // มีของเดิมโชว์อยู่แล้ว → ไม่ต้องขึ้น error
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    setTimeout(() => searchRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey, true); };
  }, [open, load]);

  // คำนวณตำแหน่ง dropdown จากปุ่ม — พลิกขึ้นด้านบนถ้าที่ด้านล่างไม่พอ, ตามติดตอน scroll/resize
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const PANEL_W = 320, GAP = 6, MARGIN = 8, IDEAL_H = 400;
    const place = () => {
      const b = buttonRef.current?.getBoundingClientRect();
      if (!b) return;
      const left = Math.max(MARGIN, Math.min(b.left, window.innerWidth - PANEL_W - MARGIN));
      const below = window.innerHeight - b.bottom - GAP - MARGIN;
      const above = b.top - GAP - MARGIN;
      if (below >= Math.min(IDEAL_H, 240) || below >= above) {
        setPos({ left, top: b.bottom + GAP, maxH: Math.max(160, below) });
      } else {
        setPos({ left, bottom: window.innerHeight - b.top + GAP, maxH: Math.max(160, above) });
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  // ตัวเลือก = Tag ที่ใช้งานอยู่ + Tag ที่ติดอยู่แล้วแต่ archived (ให้ยังเอาออกได้)
  const groups = useMemo(() => {
    const merged = new Map<string, TagLite>();
    for (const t of effectiveOptions ?? []) merged.set(t.id, t);
    for (const t of value) if (!merged.has(t.id)) merged.set(t.id, t);
    const q = query.trim().toLowerCase();
    const list = Array.from(merged.values())
      .filter(t => fixedOptions || !t.isArchived || selectedIds.has(t.id))
      .filter(t => !q || t.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    return TAG_KINDS.map(kind => ({ kind, items: list.filter(t => t.kind === kind) })).filter(g => g.items.length > 0);
  }, [effectiveOptions, value, query, selectedIds, fixedOptions]);

  const toggle = (tag: TagLite) => {
    if (busy) return;
    onChange(selectedIds.has(tag.id) ? value.filter(t => t.id !== tag.id) : [...value, tag]);
  };
  const remove = (id: string) => { if (!busy) onChange(value.filter(t => t.id !== id)); };

  const boxCls = variant === 'field'
    ? 'px-2 py-[7px] min-h-[38px] rounded-md border border-app-border bg-surface-2'
    : '';

  return (
    <div ref={rootRef} className={`relative flex flex-wrap items-center gap-1.5 ${boxCls} ${className}`}>
      {value.map(t => (
        <TagChip key={t.id} tag={t} linkable={chipsLinkable} onRemove={disabled ? undefined : () => remove(t.id)} removeDisabled={busy} />
      ))}
      {disabled && value.length === 0 && <span className="text-xs text-txt-muted">{emptyText}</span>}

      {!disabled && (
        <button
          ref={buttonRef}
          type="button"
          disabled={busy}
          aria-expanded={open}
          aria-controls={listId}
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          className="text-xs px-2.5 py-[3px] rounded-full border border-dashed border-txt-muted text-txt-secondary bg-transparent hover:border-accent hover:text-accent disabled:opacity-50 cursor-pointer"
        >{addLabel}</button>
      )}

      {open && !disabled && pos && createPortal(
        <div
          ref={panelRef}
          id={listId}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: Math.min(pos.maxH, 400) }}
          className="pop-in z-[60] w-[320px] flex flex-col rounded-[10px] border border-app-border bg-surface-2 p-2 shadow-[0_10px_30px_rgba(0,0,0,.35)]"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหา Tag..."
            className="w-full mb-1 px-2.5 py-2 text-[13px] rounded-md border border-app-border bg-surface-1 text-txt-primary outline-none focus:border-accent"
          />
          <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-multiselectable="true">
            {loadError && (
              <div className="px-2 py-3 text-xs text-danger">
                {loadError} <button type="button" className="underline" onClick={() => load()}>ลองใหม่</button>
              </div>
            )}
            {!loadError && effectiveOptions === null && <div className="px-2 py-3 text-xs text-txt-muted">กำลังโหลด...</div>}
            {!loadError && effectiveOptions !== null && groups.length === 0 && (
              <div className="px-2 py-3 text-xs text-txt-muted">{query.trim() ? `ไม่พบ Tag ที่ตรงกับ "${query.trim()}"` : 'ยังไม่มี Tag ให้เลือก'}</div>
            )}
            {groups.map(g => (
              <div key={g.kind}>
                <div className="px-2 pt-2 pb-1 text-[10.5px] uppercase tracking-[.05em] text-txt-muted">{TAG_KIND_GROUP_LABEL[g.kind]}</div>
                {g.items.map(t => {
                  const checked = selectedIds.has(t.id);
                  return (
                    <label
                      key={t.id}
                      role="option"
                      aria-selected={checked}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-surface-3 ${busy ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggle(t)} className="w-4 h-4 accent-[rgb(var(--accent))] shrink-0 cursor-pointer" />
                      <TagChip tag={t} linkable={false} />
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          {showFooter && (
            <div className="mt-1.5 border-t border-app-border px-2 pt-2 pb-1 text-[11.5px] text-txt-muted">
              ไม่เจอ Tag ที่ต้องการ? ให้ <b>ADMIN</b> สร้างที่ Admin Panel → Tags
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
