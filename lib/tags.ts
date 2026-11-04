// lib/tags.ts
// ของกลางเรื่อง Tag (Epic / Story / อื่นๆ) — ไฟล์นี้ต้อง "pure" (ไม่ import prisma)
// เพราะ component ฝั่ง client ก็ใช้ validateTagUrl / label เดียวกันเพื่อ validate ก่อนส่ง

export type TagKind = 'EPIC' | 'STORY' | 'OTHER';
export const TAG_KINDS: TagKind[] = ['EPIC', 'STORY', 'OTHER'];

/** ตัวอักษรบน chip — แยกชนิดด้วยตัวอักษร ไม่ใช่สีอย่างเดียว */
export const TAG_KIND_LABEL: Record<TagKind, string> = { EPIC: 'EPIC', STORY: 'STORY', OTHER: 'TAG' };
/** ชื่อกลุ่มใน TagPicker / radio ใน modal */
export const TAG_KIND_GROUP_LABEL: Record<TagKind, string> = { EPIC: 'Epic', STORY: 'Story', OTHER: 'อื่นๆ' };

export const TAG_NAME_MAX = 100;
export const TAG_URL_MAX = 2000;

/** รูปแบบ tag ที่ส่งไปให้การ์ด/ตาราง — select แค่นี้ ห้ามดึงเกิน */
export type TagLite = { id: string; name: string; kind: TagKind; url: string | null; isArchived: boolean };

/** ใช้ใน prisma select/include ทุกจุดที่แสดง tag (ไม่ต้อง import Prisma type ให้ไฟล์นี้ยัง pure) */
export const TAG_SELECT = { id: true, name: true, kind: true, url: true, isArchived: true } as const;

/** ใส่ใน `include` / `select` ของ task query: `{ ...TASK_TAGS_INCLUDE }` — 1 query ต่อ batch ไม่ใช่ต่อ task (กัน N+1) */
export const TASK_TAGS_INCLUDE = {
  tags: { select: { tag: { select: TAG_SELECT } }, orderBy: { createdAt: 'asc' as const } },
};

/** แปลง `task.tags` (แถว TaskTag) เป็น TagLite[] */
export function flattenTaskTags(rows: { tag: TagLite }[] | undefined | null): TagLite[] {
  return (rows ?? []).map(r => r.tag);
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Deeplink ของ Tag: trim ก่อนเสมอ, ค่าว่าง = null, อนุญาตเฉพาะ http:/https:
 * (ปฏิเสธ javascript:, data:, vbscript:, file: ฯลฯ — กัน XSS เวลาเอาไปใส่ <a href>)
 */
export function validateTagUrl(raw: unknown): ValidationResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Deeplink ต้องเป็นข้อความ' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > TAG_URL_MAX) return { ok: false, error: `Deeplink ยาวเกิน ${TAG_URL_MAX} ตัวอักษร` };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Deeplink ไม่ถูกต้อง — ต้องเป็น URL เต็ม เช่น https://jira.company.com/browse/SR-12345' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Deeplink รองรับเฉพาะ http:// และ https:// เท่านั้น' };
  }
  return { ok: true, value: trimmed };
}

export function validateTagName(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'กรุณากรอกชื่อ Tag' };
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { ok: false, error: 'กรุณากรอกชื่อ Tag' };
  if (trimmed.length > TAG_NAME_MAX) return { ok: false, error: `ชื่อ Tag ยาวเกิน ${TAG_NAME_MAX} ตัวอักษร` };
  return { ok: true, value: trimmed };
}

export function validateTagKind(raw: unknown): ValidationResult<TagKind> {
  if (typeof raw === 'string' && (TAG_KINDS as string[]).includes(raw)) return { ok: true, value: raw as TagKind };
  return { ok: false, error: 'ชนิด Tag ต้องเป็น Epic, Story หรือ อื่นๆ' };
}

/** tagIds จาก request body: ต้องเป็น array ของ string — ตัดซ้ำให้ */
export function parseTagIds(raw: unknown, max = 50): ValidationResult<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.some(x => typeof x !== 'string' || !x)) {
    return { ok: false, error: 'tagIds ต้องเป็นรายการ id ของ Tag' };
  }
  const unique = Array.from(new Set(raw as string[]));
  if (unique.length > max) return { ok: false, error: `ติด Tag ได้สูงสุด ${max} อันต่อ ticket` };
  return { ok: true, value: unique };
}

export function duplicateTagMessage(name: string, kind: TagKind): string {
  return `มี Tag ชื่อ "${name}" ชนิด ${TAG_KIND_GROUP_LABEL[kind]} อยู่แล้ว — ใช้ชื่ออื่น หรือแก้ไข/กู้คืน Tag เดิมแทน`;
}

// ─── Import: จับคู่ Epic จาก Jira JSON กับ Tag ที่ ADMIN สร้างไว้ (ไม่สร้าง Tag ใหม่เอง) ─────────

export type JiraEpicRef = { key: string; summary: string; url: string | null };

function normalizeUrlForMatch(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return null;
  }
}

function lastPathSegment(raw: string | null | undefined): string | null {
  const n = normalizeUrlForMatch(raw);
  return n ? (n.split('/').pop() ?? null) : null;
}

/**
 * หา Tag ที่ตรงกับ Epic — ลำดับความมั่นใจ:
 * 1) url ตรงกัน (ไม่สน query/#/ตัวพิมพ์/ทับท้าย) — Tag ชนิด EPIC ก่อน
 * 2) ปลาย url ของ Tag เป็น key ของ Epic (เช่น .../browse/SR-66149)
 * 3) ชื่อ Tag = summary หรือ key ของ Epic (ไม่สนตัวพิมพ์)
 * ใช้เฉพาะ Tag ที่ไม่ archived
 */
export function findTagForEpic(epic: JiraEpicRef, tags: TagLite[]): TagLite | null {
  const active = tags.filter(t => !t.isArchived);
  const byKindFirst = (list: TagLite[]) => list.find(t => t.kind === 'EPIC') ?? list[0] ?? null;

  const epicUrl = normalizeUrlForMatch(epic.url);
  if (epicUrl) {
    const hit = byKindFirst(active.filter(t => normalizeUrlForMatch(t.url) === epicUrl));
    if (hit) return hit;
  }
  const key = epic.key.trim().toLowerCase();
  if (key) {
    const hit = byKindFirst(active.filter(t => lastPathSegment(t.url) === key));
    if (hit) return hit;
  }
  const names = [epic.summary, epic.key].map(s => s.trim().toLowerCase()).filter(Boolean);
  if (names.length > 0) {
    const hit = byKindFirst(active.filter(t => names.includes(t.name.trim().toLowerCase())));
    if (hit) return hit;
  }
  return null;
}
