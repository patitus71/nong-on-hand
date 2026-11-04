'use client';

// components/TagFilterBar.tsx — แถบกรองการ์ดตาม Tag (Squad Board / บอร์ดของฉัน / งานทั้งหมด)
// ตาม design-reference/tags-design.html แท็บ 4:
// - เลือกได้หลาย Tag, logic = ตรงอย่างน้อย 1 Tag
// - การ์ดที่ไม่ตรง "จางลง" (TAG_FILTER_DIM_CLASS) ไม่ซ่อน + แสดง "แสดง X จาก Y ใบ"
// - เก็บใน URL query (?tags=id1,id2) ด้วย history.replaceState — ไม่ reload หน้า / ไม่ยิง server ใหม่
//   (ไม่ persist ลง DB)

import { useCallback, useEffect, useMemo, useState } from 'react';
import TagPicker from '@/components/TagPicker';
import type { TagLite } from '@/lib/tags';

export const TAG_FILTER_PARAM = 'tags';
/** class ของการ์ด/แถวที่ไม่ตรงตัวกรอง */
export const TAG_FILTER_DIM_CLASS = 'opacity-25 transition-opacity';

function readIdsFromUrl(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = new URLSearchParams(window.location.search).get(TAG_FILTER_PARAM);
  return raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function writeIdsToUrl(ids: string[]) {
  const url = new URL(window.location.href);
  if (ids.length > 0) url.searchParams.set(TAG_FILTER_PARAM, ids.join(','));
  else url.searchParams.delete(TAG_FILTER_PARAM);
  window.history.replaceState(window.history.state, '', url.toString());
}

/**
 * state ของตัวกรอง + sync กับ URL
 * `matches(tags)` = true ถ้าไม่ได้กรอง หรือการ์ดมี Tag ที่เลือกอย่างน้อย 1 อัน
 */
export function useTagFilter() {
  const [ids, setIdsState] = useState<string[]>([]);
  useEffect(() => { setIdsState(readIdsFromUrl()); }, []);

  const setIds = useCallback((next: string[]) => {
    setIdsState(next);
    writeIdsToUrl(next);
  }, []);

  const selected = useMemo(() => new Set(ids), [ids]);
  const active = ids.length > 0;
  const matches = useCallback(
    (tags: { id: string }[] | undefined | null) => !active || (tags ?? []).some(t => selected.has(t.id)),
    [active, selected],
  );
  return { ids, setIds, active, matches };
}

/** รวม Tag ที่อยู่บนการ์ดทั้งหมดในหน้า (ไม่ซ้ำ) — ใช้เป็นตัวเลือกของตัวกรอง */
export function collectTags(items: { tags?: TagLite[] }[]): TagLite[] {
  const map = new Map<string, TagLite>();
  for (const it of items) for (const t of it.tags ?? []) if (!map.has(t.id)) map.set(t.id, t);
  return Array.from(map.values());
}

export default function TagFilterBar({
  available, filter, shown, total, unit = 'ใบ', className = '',
}: {
  /** Tag ที่อยู่บนการ์ดในหน้านั้น (จาก collectTags) */
  available: TagLite[];
  filter: ReturnType<typeof useTagFilter>;
  shown: number;
  total: number;
  unit?: string;
  className?: string;
}) {
  // Tag ที่เลือกไว้ใน URL แต่ไม่มีบนการ์ดหน้านี้แล้ว → ยังโชว์ให้เอาออกได้ (ชื่อไม่รู้ ใช้ placeholder)
  const value = useMemo<TagLite[]>(() => filter.ids.map(id =>
    available.find(t => t.id === id) ?? { id, name: '(ไม่มีบนบอร์ดนี้)', kind: 'OTHER', url: null, isArchived: true },
  ), [filter.ids, available]);

  if (available.length === 0 && !filter.active) return null;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      <span className="text-[12.5px] text-txt-secondary">กรอง Tag:</span>
      <TagPicker
        value={value}
        onChange={next => filter.setIds(next.map(t => t.id))}
        options={available}
        addLabel={filter.active ? '+ Tag อื่น' : '+ เลือก Tag'}
        showFooter={false}
        chipsLinkable={false}
      />
      {filter.active && (
        <button type="button" onClick={() => filter.setIds([])} className="text-[12px] text-txt-secondary hover:text-txt-primary underline">
          ล้างตัวกรอง
        </button>
      )}
      <div className="flex-1" />
      {filter.active && <span className="text-[12px] text-txt-muted">แสดง {shown} จาก {total} {unit}</span>}
    </div>
  );
}
