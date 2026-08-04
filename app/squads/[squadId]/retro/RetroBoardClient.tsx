'use client';

import { useState } from 'react';
import Link from 'next/link';
import { initials, avatarColor } from '@/lib/ui';

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
  squadName: string;
  items: RetroItemData[];
};

const COLS = [
  { key: 'WENT_WELL',   label: 'Went well',    cls: 'text-success'  },
  { key: 'TO_IMPROVE',  label: 'To improve',   cls: 'text-warning'  },
  { key: 'ACTION_ITEM', label: 'Action items', cls: 'text-accent'   },
] as const;

type ColKey = typeof COLS[number]['key'];

export default function RetroBoardClient({
  squadId, squadName, userId, userName, retro: initRetro,
}: {
  squadId: string;
  squadName: string;
  userId: string;
  userName: string;
  retro: RetroData | null;
}) {
  const [retro, setRetro]           = useState(initRetro);
  const [creating, setCreating]     = useState(false);
  const [newTitle, setNewTitle]     = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [closing, setClosing]       = useState(false);
  const [addContent, setAddContent] = useState<Record<ColKey, string>>({
    WENT_WELL: '', TO_IMPROVE: '', ACTION_ITEM: '',
  });

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
      setRetro({ id: data.id, title: data.title, status: data.status, createdAt: data.createdAt, squadName, items: [] });
      setCreating(false);
      setNewTitle('');
    }
    setCreateSaving(false);
  }

  async function closeRetro() {
    if (!retro) return;
    setClosing(true);
    const res = await fetch(`/api/retro/${retro.id}/close`, { method: 'PATCH' });
    if (res.ok) setRetro(r => r ? { ...r, status: 'CLOSED' } : r);
    setClosing(false);
  }

  async function addCard(col: ColKey) {
    if (!retro) return;
    const content = addContent[col].trim();
    if (!content) return;
    const res = await fetch(`/api/retro/${retro.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: col, content }),
    });
    if (res.ok) {
      const data = await res.json();
      const newItem: RetroItemData = {
        id:           data.id,
        content:      data.content,
        category:     data.category,
        author:       data.author ? { id: userId, name: data.author.name } : null,
        voteCount:    0,
        hasVoted:     false,
        linkedTaskId: null,
      };
      setRetro(r => r ? { ...r, items: [...r.items, newItem] } : r);
      setAddContent(prev => ({ ...prev, [col]: '' }));
    }
  }

  async function toggleVote(itemId: string) {
    if (!retro) return;
    setRetro(r => r ? {
      ...r,
      items: r.items.map(item =>
        item.id === itemId
          ? { ...item, hasVoted: !item.hasVoted, voteCount: item.hasVoted ? item.voteCount - 1 : item.voteCount + 1 }
          : item
      ),
    } : r);
    await fetch(`/api/retro/${retro.id}/items/${itemId}/vote`, { method: 'POST' });
  }

  async function convertToTask(itemId: string) {
    if (!retro) return;
    const res = await fetch(`/api/retro/${retro.id}/items/${itemId}/convert`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setRetro(r => r ? {
        ...r,
        items: r.items.map(item => item.id === itemId ? { ...item, linkedTaskId: data.taskId } : item),
      } : r);
    }
  }

  // ── No open retro ──────────────────────────────────────────────────────────
  if (!retro) {
    return (
      <div className="max-w-[1180px] mx-auto px-7 py-8">
        <h1 className="text-[19px] font-semibold text-txt-primary mb-1">{squadName}</h1>
        <p className="text-[12.5px] text-txt-secondary mb-6">ยังไม่มี Retro ที่เปิดอยู่</p>
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="bg-accent text-white text-[13px] px-4 py-2 rounded-md font-medium hover:bg-accent-hover transition-colors"
          >
            + สร้าง Retro ใหม่
          </button>
        ) : (
          <form onSubmit={createRetro} className="flex items-center gap-2 max-w-sm">
            <input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="ชื่อ Retro เช่น Retro Sprint 12"
              className="flex-1 bg-surface-2 border border-accent text-txt-primary text-[13px] px-3 py-2 rounded-md focus:outline-none"
            />
            <button type="submit" disabled={createSaving || !newTitle.trim()}
              className="bg-accent text-white text-[13px] px-3 py-2 rounded-md disabled:opacity-50">
              สร้าง
            </button>
            <button type="button" onClick={() => setCreating(false)}
              className="text-txt-muted text-[13px] px-2 py-2 hover:text-txt-secondary">
              ยกเลิก
            </button>
          </form>
        )}
      </div>
    );
  }

  // ── Retro board ────────────────────────────────────────────────────────────
  const diffDays = Math.floor((Date.now() - new Date(retro.createdAt).getTime()) / 86400000);
  const diffStr  = diffDays === 0 ? 'วันนี้' : diffDays === 1 ? 'เมื่อวาน' : `${diffDays} วันก่อน`;

  return (
    <div className="max-w-[1180px] mx-auto px-7 py-[22px] pb-16">
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[19px] font-semibold text-txt-primary">{retro.title}</h1>
          {retro.status === 'OPEN'
            ? <span className="text-[11px] bg-success-bg text-success px-2.5 py-[3px] rounded-full font-medium">● Open</span>
            : <span className="text-[11px] bg-surface-2 text-txt-muted px-2.5 py-[3px] rounded-full font-medium">● Closed</span>
          }
        </div>
        {retro.status === 'OPEN' && (
          <button onClick={closeRetro} disabled={closing}
            className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3 py-[7px] rounded-md hover:bg-[#2a2e3a] disabled:opacity-50 transition-colors">
            ปิด Retro นี้
          </button>
        )}
      </div>
      <p className="text-[12.5px] text-txt-secondary mb-5">{retro.squadName} · เริ่มเมื่อ {diffStr}</p>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {COLS.map(col => {
          const colItems = retro.items.filter(i => i.category === col.key);
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
                  isOpen={retro.status === 'OPEN'}
                  onVote={() => toggleVote(item.id)}
                  onConvert={() => convertToTask(item.id)}
                />
              ))}

              {retro.status === 'OPEN' && (
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
              <Link href={`/tasks/${item.linkedTaskId}`} className="text-[10.5px] text-accent hover:underline">
                ดูงาน →
              </Link>
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
            style={!item.hasVoted ? { background: 'var(--surface-3)', border: 'none', cursor: isOpen ? 'pointer' : 'default' } : { border: 'none', cursor: isOpen ? 'pointer' : 'default' }}
          >
            ▲ {item.voteCount}
          </button>
        </div>
      )}
    </div>
  );
}
