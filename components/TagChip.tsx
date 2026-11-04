'use client';

// components/TagChip.tsx — chip ของ Tag (Epic / Story / อื่นๆ) ตาม design-reference/tags-design.html
// - แยกชนิดด้วยตัวอักษร EPIC / STORY / TAG (ไม่ใช่สีอย่างเดียว — ตาบอดสีก็แยกได้)
// - มี url → <a target="_blank"> + ↗, ไม่มี url → ไม่ใช่ลิงก์
// - กด chip บนการ์ด/แถวตาราง ต้องไม่เปิด detail และไม่เริ่มลากการ์ด (stopPropagation ทั้ง pointerdown + click)
// - archived → จางลง

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { TAG_KIND_LABEL, type TagLite } from '@/lib/tags';

const KIND_CLASS = { EPIC: 'tag-chip-epic', STORY: 'tag-chip-story', OTHER: 'tag-chip-other' } as const;

const stop = (e: SyntheticEvent) => e.stopPropagation();
/** กัน dnd-kit / onClick ของการ์ดแม่ — ใส่ทั้ง pointer, mouse, touch, key */
const STOP_HANDLERS = {
  onPointerDown: stop,
  onMouseDown: stop,
  onTouchStart: stop,
  onClick: stop,
  onKeyDown: stop,
};

type TagChipProps = {
  tag: Pick<TagLite, 'name' | 'kind' | 'url' | 'isArchived'>;
  /** แสดงปุ่ม × — เรียกตอนกดเอา Tag ออก */
  onRemove?: () => void;
  removeDisabled?: boolean;
  /** false = ไม่ทำเป็นลิงก์ แม้มี url (เช่น ใน TagPicker / preview) */
  linkable?: boolean;
  /** แสดง ↗ แม้ไม่ทำเป็นลิงก์ (ใช้ใน preview ของ modal สร้าง Tag) */
  showArrow?: boolean;
  className?: string;
};

export default function TagChip({ tag, onRemove, removeDisabled, linkable = true, showArrow, className = '' }: TagChipProps) {
  const cls = `tag-chip ${KIND_CLASS[tag.kind]}${tag.isArchived ? ' tag-chip-archived' : ''} ${className}`;
  const kindLabel = TAG_KIND_LABEL[tag.kind];
  const title = `${kindLabel} · ${tag.name}${tag.isArchived ? ' (Archived)' : ''}${tag.url ? `\n${tag.url}` : ''}`;
  const isLink = linkable && !!tag.url;
  const arrow = isLink || (showArrow && !!tag.url) ? ' ↗' : '';

  const inner = (
    <>
      <span className="tag-chip-kind">{kindLabel}</span>
      <span className="tag-chip-name">{tag.name}{arrow}</span>
    </>
  );

  const removeBtn = onRemove && (
    <button
      type="button"
      className="tag-chip-x"
      aria-label={`เอา Tag ${tag.name} ออก`}
      title="เอา Tag นี้ออก"
      disabled={removeDisabled}
      {...STOP_HANDLERS}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (!removeDisabled) onRemove(); }}
    >×</button>
  );

  // มีปุ่ม × → ห่อด้วย span แล้ววางลิงก์ไว้ข้างใน (ห้ามซ้อน <button> ใน <a>)
  if (isLink) {
    if (removeBtn) {
      return (
        <span className={cls} title={title} {...STOP_HANDLERS}>
          <a href={tag.url!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-[5px] min-w-0 text-inherit no-underline" {...STOP_HANDLERS}>
            {inner}
          </a>
          {removeBtn}
        </span>
      );
    }
    return (
      <a href={tag.url!} target="_blank" rel="noopener noreferrer" className={cls} title={title} {...STOP_HANDLERS}>
        {inner}
      </a>
    );
  }
  return (
    <span className={cls} title={title}>
      {inner}
      {removeBtn}
    </span>
  );
}

/**
 * รายการ chip บนการ์ด/ตาราง — โชว์สูงสุด `max` อัน (default 2) ที่เหลือเป็น "+N"
 * hover "+N" = tooltip รายชื่อ, click = popover โชว์ chip ทั้งหมด (กดลิงก์ได้)
 */
export function TagChipList({ tags: tagsProp, max = 2, className = '' }: { tags?: TagLite[] | null; max?: number; className?: string }) {
  const tags = tagsProp ?? [];
  // popover ลอยด้วย position:fixed ผ่าน portal — การ์ดใน My Board เป็น overflow-hidden จะตัด popover ทิ้ง
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const open = pos !== null;
  const ref = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggle() {
    if (open) { setPos(null); return; }
    const b = ref.current?.getBoundingClientRect();
    if (!b) return;
    setPos({ left: Math.max(8, Math.min(b.left, window.innerWidth - 330)), top: b.bottom + 4 });
  }

  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;

  return (
    <span className={`inline-flex flex-wrap items-center gap-[5px] min-w-0 ${className}`}>
      {shown.map(t => <TagChip key={t.id} tag={t} />)}
      {rest > 0 && (
        <span ref={ref} className="relative inline-flex" {...STOP_HANDLERS}>
          <button
            type="button"
            className="tag-chip tag-chip-other cursor-pointer border-0"
            title={tags.slice(max).map(t => `${TAG_KIND_LABEL[t.kind]} · ${t.name}`).join('\n')}
            aria-expanded={open}
            aria-label={`ดู Tag ทั้งหมด ${tags.length} อัน`}
            {...STOP_HANDLERS}
            onClick={(e) => { e.stopPropagation(); toggle(); }}
          >+{rest}</button>
          {pos && createPortal(
            <span
              ref={panelRef}
              style={{ position: 'fixed', left: pos.left, top: pos.top }}
              className="pop-in z-[60] flex flex-col items-start gap-1.5 min-w-[180px] max-w-[320px] p-2 rounded-lg border border-app-border bg-surface-2 shadow-xl"
              {...STOP_HANDLERS}
            >
              {tags.map(t => <TagChip key={t.id} tag={t} />)}
            </span>,
            document.body,
          )}
        </span>
      )}
    </span>
  );
}
