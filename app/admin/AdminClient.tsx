'use client';

import { useEffect, useRef, useState } from 'react';
import { initials, avatarColor } from '@/lib/ui';

type UserRow = {
  id: string; name: string; username: string;
  role: string; active: boolean; squadId: string | null;
  squad: { name: string } | null;
  isLastAdmin: boolean;
};

type NotifSettings = {
  standupAutoSendEnabled: boolean;
  standupSendTime: string | null;
  eodAutoSendEnabled: boolean;
  eodSendTime: string | null;
};

type SquadRow = {
  id: string;
  name: string;
  isFloatingPool: boolean;
  _count: { users: number };
  notificationSettings: NotifSettings | null;
};

const ALL_ROLES = ['ADMIN', 'QA_LEAD', 'QA_MANAGER', 'QA_ENGINEER'] as const;

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  QA_LEAD: 'QA Lead',
  QA_MANAGER: 'QA Manager',
  QA_ENGINEER: 'QA Engineer',
};

function noSquadRole(role: string) {
  return role === 'ADMIN' || role === 'QA_MANAGER';
}

function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789#$%';
  let pw = '';
  for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

type Props = { actorRole: string; actorId: string };

export default function AdminClient({ actorRole, actorId }: Props) {
  const [activeTab, setActiveTab] = useState<'users' | 'squads'>('users');

  // ── Squads (shared between tabs) ─────────────────────────────
  const [squads, setSquads] = useState<SquadRow[]>([]);
  useEffect(() => {
    fetch('/api/admin/squads').then(r => r.json()).then(setSquads);
  }, []);

  // ── Users state ──────────────────────────────────────────────
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/users').then(r => r.json()).then(setUsers).finally(() => setLoadingUsers(false));
  }, []);

  async function updateUser(userId: string, patch: { role?: string; active?: boolean; squadId?: string | null }) {
    setSaving(userId);
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...patch }),
    });
    if (res.ok) {
      const updated = await res.json();
      // re-calc isLastAdmin
      setUsers(prev => {
        const next = prev.map(u => u.id === userId ? { ...u, ...updated } : u);
        const adminCount = next.filter(u => u.role === 'ADMIN' && u.active).length;
        return next.map(u => ({ ...u, isLastAdmin: u.role === 'ADMIN' && adminCount === 1 }));
      });
    } else {
      alert(await res.text());
    }
    setSaving(null);
  }

  // role change — auto-clear squad when switching to no-squad role
  function handleRoleChange(userId: string, newRole: string) {
    const patch: { role: string; squadId?: null } = { role: newRole };
    if (noSquadRole(newRole)) patch.squadId = null;
    updateUser(userId, patch);
  }

  // ── Rename user (inline) ──────────────────────────────────────
  const [editingNameId,  setEditingNameId]  = useState<string | null>(null);
  const [editingName,    setEditingName]    = useState('');
  const [nameSaving,     setNameSaving]     = useState(false);
  const [nameError,      setNameError]      = useState('');

  function openEditName(u: UserRow) {
    setEditingNameId(u.id); setEditingName(u.name); setNameError('');
  }

  async function saveUserName(userId: string) {
    if (!editingName.trim()) { setNameError('ชื่อต้องไม่ว่าง'); return; }
    setNameSaving(true); setNameError('');
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name: editingName.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, name: updated.name } : u));
      setEditingNameId(null);
    } else {
      setNameError(await res.text());
    }
    setNameSaving(false);
  }

  // ── Delete user ───────────────────────────────────────────────
  const [deleteTarget,    setDeleteTarget]    = useState<UserRow | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteError,     setDeleteError]     = useState('');

  async function submitDeleteUser() {
    if (!deleteTarget) return;
    setDeleteConfirming(true);
    setDeleteError('');
    const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' });
    if (res.ok) {
      setUsers(prev => {
        const next = prev.filter(u => u.id !== deleteTarget.id);
        const adminCount = next.filter(u => u.role === 'ADMIN' && u.active).length;
        return next.map(u => ({ ...u, isLastAdmin: u.role === 'ADMIN' && adminCount === 1 }));
      });
      setDeleteTarget(null);
    } else {
      setDeleteError(await res.text());
    }
    setDeleteConfirming(false);
  }

  // ── Reset password ────────────────────────────────────────────
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [password, setPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState('');
  const pwInputRef = useRef<HTMLInputElement>(null);

  function openReset(user: UserRow) {
    setResetTarget(user); setPassword(genPassword()); setResetError('');
    setTimeout(() => pwInputRef.current?.select(), 50);
  }

  async function submitReset() {
    if (!resetTarget || password.length < 6) { setResetError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    setResetSaving(true); setResetError('');
    const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) setResetTarget(null); else setResetError(await res.text());
    setResetSaving(false);
  }

  // ── Add User ──────────────────────────────────────────────────
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', role: 'QA_ENGINEER', squadId: '' });
  const [addingUser, setAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');

  function openAddUser() {
    setNewUser({ name: '', username: '', password: genPassword(), role: 'QA_ENGINEER', squadId: '' });
    setAddUserError(''); setShowAddUser(true);
  }

  async function submitAddUser() {
    setAddingUser(true); setAddUserError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newUser,
        squadId: noSquadRole(newUser.role) ? null : (newUser.squadId || null),
      }),
    });
    if (res.ok) {
      const created = await res.json();
      setUsers(prev => {
        const next = [...prev, created];
        const adminCount = next.filter(u => u.role === 'ADMIN' && u.active).length;
        return next
          .map(u => ({ ...u, isLastAdmin: u.role === 'ADMIN' && adminCount === 1 }))
          .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
      });
      setShowAddUser(false);
    } else {
      setAddUserError(await res.text());
    }
    setAddingUser(false);
  }

  // ── Squads tab state ─────────────────────────────────────────
  const [loadingSquads, setLoadingSquads] = useState(false);
  const [editingSquadId, setEditingSquadId] = useState<string | null>(null);
  const [editingSquadName, setEditingSquadName] = useState('');
  const [squadSaving, setSquadSaving] = useState(false);
  const [squadError, setSquadError] = useState('');
  const [deleteSquadTarget, setDeleteSquadTarget] = useState<SquadRow | null>(null);
  const [deletingSquad, setDeletingSquad] = useState(false);
  const [deleteSquadError, setDeleteSquadError] = useState('');
  const [showAddSquad, setShowAddSquad] = useState(false);
  const [newSquadName, setNewSquadName] = useState('');
  const [addingSquad, setAddingSquad] = useState(false);
  const [addSquadError, setAddSquadError] = useState('');

  useEffect(() => {
    if (activeTab !== 'squads') return;
    setLoadingSquads(true);
    fetch('/api/admin/squads').then(r => r.json()).then(data => { setSquads(data); setLoadingSquads(false); });
  }, [activeTab]);

  async function saveSquadName() {
    if (!editingSquadId || !editingSquadName.trim()) return;
    setSquadSaving(true); setSquadError('');
    const res = await fetch(`/api/admin/squads/${editingSquadId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editingSquadName.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSquads(sq => sq.map(s => s.id === editingSquadId ? updated : s));
      setEditingSquadId(null);
    } else { setSquadError(await res.text()); }
    setSquadSaving(false);
  }

  async function toggleFloatingPool(squadId: string, current: boolean) {
    const res = await fetch(`/api/admin/squads/${squadId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFloatingPool: !current }),
    });
    if (res.ok) {
      const updated = await res.json();
      setSquads(sq => sq.map(s => s.id === squadId ? { ...s, isFloatingPool: updated.isFloatingPool } : s));
    }
  }

  // ── Notification settings modal ──────────────────────────────
  const [notifTarget, setNotifTarget] = useState<SquadRow | null>(null);
  const [notifForm, setNotifForm] = useState<NotifSettings & { standupSendTime: string; eodSendTime: string }>({
    standupAutoSendEnabled: false, standupSendTime: '',
    eodAutoSendEnabled:     false, eodSendTime: '',
  });
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifError,  setNotifError]  = useState('');
  const [applyingAll, setApplyingAll] = useState(false);

  function openNotif(sq: SquadRow) {
    const ns = sq.notificationSettings;
    setNotifForm({
      standupAutoSendEnabled: ns?.standupAutoSendEnabled ?? false,
      standupSendTime:        ns?.standupSendTime ?? '',
      eodAutoSendEnabled:     ns?.eodAutoSendEnabled ?? false,
      eodSendTime:            ns?.eodSendTime ?? '',
    });
    setNotifError('');
    setNotifTarget(sq);
  }

  async function saveNotif() {
    if (!notifTarget) return;
    if (notifForm.standupAutoSendEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(notifForm.standupSendTime)) {
      setNotifError('Standup: รูปแบบเวลาไม่ถูกต้อง (HH:MM 24h)'); return;
    }
    if (notifForm.eodAutoSendEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(notifForm.eodSendTime)) {
      setNotifError('EOD: รูปแบบเวลาไม่ถูกต้อง (HH:MM 24h)'); return;
    }
    setNotifSaving(true); setNotifError('');
    const res = await fetch(`/api/admin/squads/${notifTarget.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationSettings: {
          standupAutoSendEnabled: notifForm.standupAutoSendEnabled,
          standupSendTime:        notifForm.standupAutoSendEnabled ? notifForm.standupSendTime : null,
          eodAutoSendEnabled:     notifForm.eodAutoSendEnabled,
          eodSendTime:            notifForm.eodAutoSendEnabled ? notifForm.eodSendTime : null,
        },
      }),
    });
    if (res.ok) {
      const updated = await res.json() as SquadRow;
      setSquads(prev => prev.map(s => s.id === notifTarget.id ? updated : s));
      setNotifTarget(null);
    } else {
      setNotifError(await res.text());
    }
    setNotifSaving(false);
  }

  // ใช้เวลา standup/EOD ในฟอร์มปัจจุบัน กับทุก squad พร้อมกัน (bulk apply)
  async function applyNotifToAllSquads() {
    if (!confirm('ตั้งค่านี้จะ overwrite เวลา standup/EOD ของทุก squad ทันที (รวมค่าที่เคยตั้งไว้แยกต่างหาก) ยืนยันไหม?')) return;
    if (notifForm.standupAutoSendEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(notifForm.standupSendTime)) {
      setNotifError('Standup: รูปแบบเวลาไม่ถูกต้อง (HH:MM 24h)'); return;
    }
    if (notifForm.eodAutoSendEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(notifForm.eodSendTime)) {
      setNotifError('EOD: รูปแบบเวลาไม่ถูกต้อง (HH:MM 24h)'); return;
    }
    setApplyingAll(true); setNotifError('');
    const applied: NotifSettings = {
      standupAutoSendEnabled: notifForm.standupAutoSendEnabled,
      standupSendTime:        notifForm.standupAutoSendEnabled ? notifForm.standupSendTime : null,
      eodAutoSendEnabled:     notifForm.eodAutoSendEnabled,
      eodSendTime:            notifForm.eodAutoSendEnabled ? notifForm.eodSendTime : null,
    };
    const res = await fetch('/api/admin/squads/notification-settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(applied),
    });
    if (res.ok) {
      setSquads(prev => prev.map(s => ({ ...s, notificationSettings: applied })));
      setNotifTarget(null);
    } else {
      setNotifError(await res.text());
    }
    setApplyingAll(false);
  }

  async function addSquad() {
    if (!newSquadName.trim()) return;
    setAddingSquad(true); setAddSquadError('');
    const res = await fetch('/api/admin/squads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newSquadName.trim() }),
    });
    if (res.ok) {
      const created = await res.json();
      setSquads(sq => [...sq, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewSquadName(''); setShowAddSquad(false);
    } else { setAddSquadError(await res.text()); }
    setAddingSquad(false);
  }

  // ── Styles ────────────────────────────────────────────────────
  const tabCls = (active: boolean) =>
    `text-[13px] px-4 py-2 rounded-t-lg border border-app-border transition-colors ${
      active
        ? 'bg-surface-1 text-txt-primary border-b-surface-1 -mb-px relative z-10'
        : 'bg-surface-2 text-txt-secondary hover:text-txt-primary border-b-app-border'
    }`;

  const selCls = 'bg-surface-2 border border-app-border text-txt-primary text-[12.5px] px-2 py-1.5 rounded-md focus:outline-none focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="px-7 py-6 pb-16">
      <h1 className="text-[19px] font-semibold text-txt-primary mb-1">Admin Panel</h1>
      <p className="text-[13px] text-txt-secondary mb-5">จัดการผู้ใช้ role และ squad</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-0 border-b border-app-border">
        <button className={tabCls(activeTab === 'users')}  onClick={() => setActiveTab('users')}>ผู้ใช้</button>
        <button className={tabCls(activeTab === 'squads')} onClick={() => setActiveTab('squads')}>Squads</button>
      </div>

      {/* ── Users tab ──────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="pt-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-txt-secondary">ผู้ใช้ทั้งหมดในระบบ</p>
            <button
              onClick={openAddUser}
              className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-3.5 py-2 rounded-lg transition-colors"
            >
              + เพิ่ม User
            </button>
          </div>

          {loadingUsers ? (
            <p className="text-txt-muted text-[13px]">กำลังโหลด...</p>
          ) : (
            <div className="overflow-hidden border border-app-border rounded-[10px]">
              <table className="w-full border-collapse bg-surface-1">
                <thead>
                  <tr className="border-b border-app-border">
                    {['ผู้ใช้', 'Role', 'Squad', 'ใช้งานอยู่', 'รหัสผ่าน', ...(actorRole === 'ADMIN' ? [''] : [])].map(h => (
                      <th key={h} className="text-left text-[11.5px] font-medium text-txt-muted uppercase tracking-wide px-3.5 py-2.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const av = avatarColor(u.name);
                    const isNoSquad = noSquadRole(u.role);
                    return (
                      <tr key={u.id} className={`border-b border-app-border last:border-0 ${!u.active ? 'opacity-55' : ''}`}>
                        {/* Name */}
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-[22px] h-[22px] rounded-full text-[9.5px] font-semibold flex items-center justify-center flex-shrink-0 self-start mt-0.5"
                              style={{ background: av.bg, color: av.fg }}>
                              {initials(u.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              {editingNameId === u.id ? (
                                <div className="flex items-center gap-1.5">
                                  <input
                                    autoFocus
                                    value={editingName}
                                    onChange={e => { setEditingName(e.target.value); setNameError(''); }}
                                    onKeyDown={e => { if (e.key === 'Enter') saveUserName(u.id); if (e.key === 'Escape') setEditingNameId(null); }}
                                    className="bg-surface-2 border border-accent text-txt-primary text-[12.5px] px-2 py-1 rounded-md focus:outline-none w-36"
                                  />
                                  <button
                                    onClick={() => saveUserName(u.id)}
                                    disabled={nameSaving}
                                    className="text-[11px] bg-accent text-white px-2 py-1 rounded-md disabled:opacity-50"
                                  >
                                    {nameSaving ? '...' : 'บันทึก'}
                                  </button>
                                  <button
                                    onClick={() => setEditingNameId(null)}
                                    className="text-[11px] text-txt-muted hover:text-txt-primary"
                                  >
                                    ✕
                                  </button>
                                  {nameError && <span className="text-[10.5px] text-danger">{nameError}</span>}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group">
                                  <div className="text-[13px] text-txt-primary leading-tight">{u.name}</div>
                                  <button
                                    onClick={() => openEditName(u)}
                                    className="text-[10px] text-txt-muted opacity-0 group-hover:opacity-100 transition-opacity px-1 hover:text-accent"
                                    title="แก้ไขชื่อ"
                                  >
                                    ✎
                                  </button>
                                </div>
                              )}
                              <div className="text-[11px] text-txt-muted">{u.username}</div>
                            </div>
                            {u.isLastAdmin && (
                              <span className="text-[9.5px] bg-warning-bg text-warning px-1.5 py-0.5 rounded-full whitespace-nowrap">Admin คนสุดท้าย</span>
                            )}
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-3.5 py-2.5">
                          <select
                            value={u.role}
                            disabled={saving === u.id}
                            onChange={e => handleRoleChange(u.id, e.target.value)}
                            className={selCls}
                          >
                            {ALL_ROLES.map(r => (
                              <option key={r} value={r} disabled={actorRole !== 'ADMIN' && r === 'ADMIN'}>
                                {ROLE_LABEL[r]}{actorRole !== 'ADMIN' && r === 'ADMIN' ? ' (ไม่มีสิทธิ์)' : ''}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Squad */}
                        <td className="px-3.5 py-2.5">
                          <select
                            value={u.squadId ?? ''}
                            disabled={saving === u.id || isNoSquad}
                            title={isNoSquad ? 'Role นี้ไม่ผูก Squad' : ''}
                            onChange={e => updateUser(u.id, { squadId: e.target.value || null })}
                            className={selCls}
                          >
                            <option value="">— ไม่ระบุ —</option>
                            {squads.map(sq => (
                              <option key={sq.id} value={sq.id}>{sq.name}</option>
                            ))}
                          </select>
                        </td>

                        {/* Active */}
                        <td className="px-3.5 py-2.5">
                          <button
                            onClick={() => updateUser(u.id, { active: !u.active })}
                            disabled={saving === u.id || (u.isLastAdmin && u.active)}
                            title={u.isLastAdmin && u.active ? 'ไม่สามารถปิด Admin คนสุดท้ายได้' : ''}
                            className={`w-[34px] h-[18px] rounded-full relative transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${u.active ? 'bg-success' : 'bg-surface-3'}`}
                          >
                            <span className={`w-[14px] h-[14px] rounded-full bg-white absolute top-[2px] transition-all ${u.active ? 'left-[18px]' : 'left-[2px]'}`} />
                          </button>
                        </td>

                        {/* Reset password */}
                        <td className="px-3.5 py-2.5">
                          <button
                            onClick={() => openReset(u)}
                            className="bg-surface-2 border border-app-border text-txt-secondary text-[11.5px] px-2.5 py-1.5 rounded-md hover:bg-surface-3 hover:text-txt-primary transition-colors"
                          >
                            ตั้งรหัสผ่านใหม่
                          </button>
                        </td>

                        {/* Delete user — ADMIN only */}
                        {actorRole === 'ADMIN' && (
                          <td className="px-3.5 py-2.5">
                            <button
                              onClick={() => { setDeleteTarget(u); setDeleteError(''); }}
                              disabled={saving === u.id || u.isLastAdmin || u.id === actorId}
                              title={
                                u.id === actorId ? 'ไม่สามารถลบบัญชีตัวเองได้' :
                                u.isLastAdmin    ? 'ไม่สามารถลบ Admin คนสุดท้ายได้' : ''
                              }
                              className="text-danger border border-danger/40 bg-danger-bg text-[11.5px] px-2.5 py-1.5 rounded-md hover:bg-danger hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              🗑 ลบ
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[11.5px] text-txt-muted mt-3.5 leading-relaxed">
            * ปิดสวิตช์ "ใช้งานอยู่" = user จะ login ไม่ได้ทันที แต่ข้อมูลเดิมไม่ถูกลบ<br />
            * กด "🗑 ลบ" = soft-delete — user หายออกจากระบบถาวร แต่งานที่เคย assign ยังอยู่ครบ<br />
            * ระบบจะไม่ยอมให้ลด role ปิดใช้งาน หรือลบ Admin คนสุดท้ายในระบบ
          </p>
        </div>
      )}

      {/* ── Squads tab ─────────────────────────────────────────── */}
      {activeTab === 'squads' && (
        <div className="pt-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-txt-secondary">รายการ Squad ทั้งหมดในระบบ</p>
            <button
              onClick={() => { setShowAddSquad(true); setNewSquadName(''); setAddSquadError(''); }}
              className="bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-3.5 py-2 rounded-lg transition-colors"
            >
              + เพิ่ม Squad
            </button>
          </div>

          {loadingSquads ? (
            <p className="text-txt-muted text-[13px]">กำลังโหลด...</p>
          ) : (
            <div className="overflow-hidden border border-app-border rounded-[10px]">
              <table className="w-full border-collapse bg-surface-1">
                <thead>
                  <tr className="border-b border-app-border">
                    {['ชื่อ Squad', 'Floating Pool', 'สมาชิก', 'LINE Auto-Send', ''].map(h => (
                      <th key={h} className="text-left text-[11.5px] font-medium text-txt-muted uppercase tracking-wide px-3.5 py-2.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {squads.map(sq => (
                    <tr key={sq.id} className="border-b border-app-border last:border-0">
                      <td className="px-3.5 py-2.5 w-full">
                        {editingSquadId === sq.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus value={editingSquadName}
                              onChange={e => setEditingSquadName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveSquadName(); if (e.key === 'Escape') setEditingSquadId(null); }}
                              className="bg-surface-2 border border-accent text-txt-primary text-[13px] px-2.5 py-1.5 rounded-md focus:outline-none w-40"
                            />
                            {squadError && <span className="text-[11.5px] text-danger">{squadError}</span>}
                          </div>
                        ) : (
                          <span className="text-[13px] text-txt-primary font-medium">{sq.name}</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <button
                          onClick={() => toggleFloatingPool(sq.id, sq.isFloatingPool)}
                          title={sq.isFloatingPool ? 'คลิกเพื่อปิด Floating Pool' : 'คลิกเพื่อเปิด Floating Pool'}
                          className={`text-[11.5px] px-2.5 py-1 rounded-full border transition-colors ${
                            sq.isFloatingPool
                              ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                              : 'bg-surface-2 border-app-border text-txt-muted hover:border-accent/40 hover:text-accent'
                          }`}
                        >
                          {sq.isFloatingPool ? 'เปิดอยู่' : 'ปิดอยู่'}
                        </button>
                      </td>
                      <td className="px-3.5 py-2.5 text-[13px] text-txt-secondary whitespace-nowrap">{sq._count.users} คน</td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <button
                          onClick={() => openNotif(sq)}
                          className="text-[11.5px] px-2.5 py-1 rounded-full border transition-colors bg-surface-2 border-app-border text-txt-muted hover:border-accent/40 hover:text-accent"
                          title="ตั้งค่า LINE auto-send"
                        >
                          {sq.notificationSettings
                            ? (() => {
                                const ns = sq.notificationSettings;
                                const sd = ns.standupAutoSendEnabled ? `SD ${ns.standupSendTime}` : null;
                                const ed = ns.eodAutoSendEnabled     ? `EOD ${ns.eodSendTime}`    : null;
                                return [sd, ed].filter(Boolean).join(' · ') || '—';
                              })()
                            : '—'}
                        </button>
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        {editingSquadId === sq.id ? (
                          <div className="flex gap-2">
                            <button onClick={saveSquadName} disabled={squadSaving || !editingSquadName.trim()}
                              className="bg-accent hover:bg-accent-hover text-white text-[11.5px] px-2.5 py-1.5 rounded-md disabled:opacity-50 transition-colors">
                              {squadSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                            </button>
                            <button onClick={() => setEditingSquadId(null)} disabled={squadSaving}
                              className="bg-surface-2 border border-app-border text-txt-secondary text-[11.5px] px-2.5 py-1.5 rounded-md hover:bg-surface-3 transition-colors">
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button onClick={() => { setEditingSquadId(sq.id); setEditingSquadName(sq.name); setSquadError(''); }}
                              className="text-[11.5px] text-txt-secondary hover:text-txt-primary border border-app-border bg-surface-2 hover:bg-surface-3 px-2.5 py-1.5 rounded-md transition-colors">
                              ✎ แก้ไขชื่อ
                            </button>
                            <button
                              onClick={() => { setDeleteSquadTarget(sq); setDeleteSquadError(''); }}
                              className="text-danger border border-danger/40 bg-danger-bg text-[11.5px] px-2.5 py-1.5 rounded-md hover:bg-danger hover:text-white transition-colors"
                            >
                              🗑 ลบ
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {squads.length === 0 && (
                    <tr><td colSpan={3} className="px-3.5 py-6 text-center text-[13px] text-txt-muted">ยังไม่มี Squad</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Modal: Delete squad ──────────────────────────────── */}
      {deleteSquadTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[380px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-danger mb-1">🗑 ลบ Squad นี้?</h3>
            <p className="text-[12.5px] text-txt-secondary mb-3 leading-relaxed">
              ยืนยันการลบ <span className="font-semibold text-txt-primary">{deleteSquadTarget.name}</span>
            </p>
            <p className="text-[12px] text-warning bg-warning-bg px-3 py-2 rounded-lg mb-4 leading-relaxed">
              ⚠ ลบได้เฉพาะ Squad ที่ไม่มีสมาชิกและไม่มีงานค้างอยู่เท่านั้น
            </p>
            {deleteSquadError && (
              <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-lg mb-3">{deleteSquadError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteSquadTarget(null)}
                disabled={deletingSquad}
                className="px-4 py-2 text-[12.5px] text-txt-muted border border-app-border rounded-lg hover:bg-surface-2 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={async () => {
                  setDeletingSquad(true); setDeleteSquadError('');
                  const res = await fetch(`/api/admin/squads/${deleteSquadTarget.id}`, { method: 'DELETE' });
                  if (res.ok) {
                    setSquads(prev => prev.filter(s => s.id !== deleteSquadTarget.id));
                    setDeleteSquadTarget(null);
                  } else {
                    setDeleteSquadError(await res.text());
                  }
                  setDeletingSquad(false);
                }}
                disabled={deletingSquad}
                className={`bg-danger border border-danger text-white text-[12.5px] font-medium px-4 py-2 rounded-lg hover:bg-[#d94848] transition-colors disabled:opacity-50 ${deletingSquad ? 'btn-loading' : ''}`}
              >
                ยืนยันลบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Delete user ───────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[380px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-danger mb-1">🗑 ลบผู้ใช้นี้?</h3>
            <p className="text-[12.5px] text-txt-secondary mb-3 leading-relaxed">
              ยืนยันการลบ <span className="font-semibold text-txt-primary">{deleteTarget.name}</span>{' '}
              ({deleteTarget.username}) — role: {ROLE_LABEL[deleteTarget.role]}
            </p>
            <p className="text-[12px] text-warning bg-warning-bg px-3 py-2 rounded-lg mb-4 leading-relaxed">
              ⚠ user จะหายออกจากระบบทันที — login ไม่ได้อีก แต่งานที่เคย assign ให้ยังอยู่ครบ
            </p>
            {deleteError && (
              <p className="text-[12px] text-danger bg-danger-bg px-3 py-2 rounded-lg mb-3">{deleteError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteConfirming}
                className="px-4 py-2 text-[12.5px] text-txt-muted border border-app-border rounded-lg hover:bg-surface-2 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={submitDeleteUser}
                disabled={deleteConfirming}
                className={`bg-danger border border-danger text-white text-[12.5px] font-medium px-4 py-2 rounded-lg hover:bg-[#d94848] transition-colors disabled:opacity-50 ${deleteConfirming ? 'btn-loading' : ''}`}
              >
                ยืนยันลบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Reset password ─────────────────────────────── */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[360px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-1">ตั้งรหัสผ่านใหม่</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">สำหรับ {resetTarget.name} ({resetTarget.username})</p>
            <label className="block text-[12px] text-txt-secondary mb-1.5">รหัสผ่านใหม่</label>
            <input ref={pwInputRef} type="text" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="อย่างน้อย 6 ตัวอักษร"
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13.5px] px-2.5 py-2.5 rounded-lg focus:outline-none focus:border-accent mb-1" />
            <button onClick={() => setPassword(genPassword())} className="text-[11.5px] text-accent hover:underline mb-3">🎲 สุ่มรหัสผ่านให้</button>
            <p className="text-[11px] text-txt-muted mb-4">ระบบจะ hash ด้วย bcrypt ก่อนบันทึก — ไม่มีการเก็บรหัสผ่านแบบข้อความล้วน</p>
            {resetError && <p className="text-[12px] text-danger mb-3">{resetError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setResetTarget(null)} disabled={resetSaving}
                className="px-4 py-2 text-[12.5px] text-txt-muted border border-app-border rounded-lg transition-colors">ยกเลิก</button>
              <button onClick={submitReset} disabled={resetSaving || password.length < 6}
                className={`bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${resetSaving ? 'btn-loading' : ''}`}>
                บันทึกรหัสผ่านใหม่
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Add User ───────────────────────────────────── */}
      {showAddUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[400px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-4">เพิ่ม User ใหม่</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-[12px] text-txt-secondary mb-1">ชื่อ-นามสกุล</label>
                <input type="text" value={newUser.name} placeholder="ชื่อที่แสดงในระบบ"
                  onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))}
                  className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent" />
              </div>

              <div>
                <label className="block text-[12px] text-txt-secondary mb-1">Username</label>
                <input type="text" value={newUser.username} placeholder="ใช้สำหรับ login"
                  onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                  className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent" />
              </div>

              <div>
                <label className="block text-[12px] text-txt-secondary mb-1">รหัสผ่านเริ่มต้น</label>
                <div className="flex gap-2">
                  <input type="text" value={newUser.password} placeholder="อย่างน้อย 6 ตัวอักษร"
                    onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                    className="flex-1 bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent" />
                  <button onClick={() => setNewUser(u => ({ ...u, password: genPassword() }))}
                    className="text-[11.5px] text-accent border border-app-border bg-surface-2 hover:bg-surface-3 px-2.5 py-2 rounded-lg transition-colors">
                    🎲 สุ่ม
                  </button>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-[12px] text-txt-secondary mb-1">Role</label>
                  <select value={newUser.role}
                    onChange={e => setNewUser(u => ({ ...u, role: e.target.value, squadId: noSquadRole(e.target.value) ? '' : u.squadId }))}
                    className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent">
                    {ALL_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </div>

                <div className="flex-1">
                  <label className="block text-[12px] text-txt-secondary mb-1">
                    Squad {!noSquadRole(newUser.role) && <span className="text-danger">*</span>}
                  </label>
                  <select value={newUser.squadId}
                    disabled={noSquadRole(newUser.role)}
                    title={noSquadRole(newUser.role) ? 'Role นี้ไม่ผูก Squad' : ''}
                    onChange={e => setNewUser(u => ({ ...u, squadId: e.target.value }))}
                    className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13px] px-2.5 py-2 rounded-lg focus:outline-none focus:border-accent disabled:opacity-50 disabled:cursor-not-allowed">
                    <option value="">— ไม่ระบุ —</option>
                    {squads.map(sq => <option key={sq.id} value={sq.id}>{sq.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {addUserError && <p className="text-[12px] text-danger mt-3">{addUserError}</p>}

            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowAddUser(false)} disabled={addingUser}
                className="px-4 py-2 text-[12.5px] text-txt-muted border border-app-border rounded-lg transition-colors">ยกเลิก</button>
              <button onClick={submitAddUser} disabled={addingUser || !newUser.name.trim() || !newUser.username.trim() || newUser.password.length < 6}
                className={`bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${addingUser ? 'btn-loading' : ''}`}>
                สร้าง User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: LINE Notification Settings ────────────────── */}
      {notifTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[380px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-1">LINE Auto-Send</h3>
            <p className="text-[12.5px] text-txt-secondary mb-4">{notifTarget.name}</p>

            <div className="space-y-4">
              {/* Standup */}
              <div className="bg-surface-2 rounded-lg px-3.5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12.5px] font-medium text-txt-primary">Standup</span>
                  <button
                    onClick={() => setNotifForm(f => ({ ...f, standupAutoSendEnabled: !f.standupAutoSendEnabled }))}
                    className={`w-[34px] h-[18px] rounded-full relative transition-colors ${notifForm.standupAutoSendEnabled ? 'bg-success' : 'bg-surface-3'}`}
                  >
                    <span className={`w-[14px] h-[14px] rounded-full bg-white absolute top-[2px] transition-all ${notifForm.standupAutoSendEnabled ? 'left-[18px]' : 'left-[2px]'}`} />
                  </button>
                </div>
                {notifForm.standupAutoSendEnabled && (
                  <div>
                    <label className="block text-[11px] text-txt-muted mb-1">เวลาส่ง (ICT, รูปแบบ HH:MM)</label>
                    <input
                      type="text"
                      value={notifForm.standupSendTime}
                      onChange={e => setNotifForm(f => ({ ...f, standupSendTime: e.target.value }))}
                      placeholder="09:00"
                      maxLength={5}
                      className="w-full bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-1.5 rounded-md focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>

              {/* EOD */}
              <div className="bg-surface-2 rounded-lg px-3.5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12.5px] font-medium text-txt-primary">EOD Summary</span>
                  <button
                    onClick={() => setNotifForm(f => ({ ...f, eodAutoSendEnabled: !f.eodAutoSendEnabled }))}
                    className={`w-[34px] h-[18px] rounded-full relative transition-colors ${notifForm.eodAutoSendEnabled ? 'bg-success' : 'bg-surface-3'}`}
                  >
                    <span className={`w-[14px] h-[14px] rounded-full bg-white absolute top-[2px] transition-all ${notifForm.eodAutoSendEnabled ? 'left-[18px]' : 'left-[2px]'}`} />
                  </button>
                </div>
                {notifForm.eodAutoSendEnabled && (
                  <div>
                    <label className="block text-[11px] text-txt-muted mb-1">เวลาส่ง (ICT, รูปแบบ HH:MM)</label>
                    <input
                      type="text"
                      value={notifForm.eodSendTime}
                      onChange={e => setNotifForm(f => ({ ...f, eodSendTime: e.target.value }))}
                      placeholder="18:00"
                      maxLength={5}
                      className="w-full bg-surface-1 border border-app-border text-txt-primary text-[13px] px-2.5 py-1.5 rounded-md focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>
            </div>

            <p className="text-[11px] text-txt-muted mt-3 leading-relaxed">
              หมายเหตุ: คำสั่ง LINE (<span className="font-mono">/standup all on HH:MM</span>, <span className="font-mono">/eod all on HH:MM</span>) ตั้งให้ทุก squad พร้อมกันเท่านั้น — ตั้งเฉพาะ squad นี้ squad เดียวได้ที่นี่เท่านั้น
            </p>

            <button
              onClick={applyNotifToAllSquads}
              disabled={notifSaving || applyingAll}
              className={`w-full mt-3 text-[12px] text-accent border border-accent/30 rounded-lg py-1.5 hover:bg-accent/10 disabled:opacity-50 transition-colors ${applyingAll ? 'btn-loading' : ''}`}
            >
              ใช้เวลานี้กับทุก Squad
            </button>
            <p className="text-[10.5px] text-txt-muted mt-1 leading-relaxed">
              overwrite การตั้งค่า standup/EOD ของทุก squad ด้วยค่าในฟอร์มนี้ทันที
            </p>

            {notifError && <p className="text-[12px] text-danger mt-2">{notifError}</p>}

            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setNotifTarget(null)} disabled={notifSaving || applyingAll}
                className="px-4 py-2 text-[12.5px] text-txt-muted border border-app-border rounded-lg hover:bg-surface-2 transition-colors">
                ยกเลิก
              </button>
              <button onClick={saveNotif} disabled={notifSaving || applyingAll}
                className={`bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${notifSaving ? 'btn-loading' : ''}`}>
                บันทึก (squad นี้เท่านั้น)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Add Squad ──────────────────────────────────── */}
      {showAddSquad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55">
          <div className="bg-surface-1 border border-app-border rounded-xl p-5 w-[340px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-txt-primary mb-4">เพิ่ม Squad ใหม่</h3>
            <label className="block text-[12px] text-txt-secondary mb-1.5">ชื่อ Squad</label>
            <input autoFocus type="text" value={newSquadName} placeholder="เช่น SQ3"
              onChange={e => setNewSquadName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addSquad(); if (e.key === 'Escape') setShowAddSquad(false); }}
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-[13.5px] px-2.5 py-2.5 rounded-lg focus:outline-none focus:border-accent" />
            {addSquadError && <p className="text-[11.5px] text-danger mt-1">{addSquadError}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowAddSquad(false)} disabled={addingSquad}
                className="px-4 py-2 text-[12.5px] text-txt-muted border border-app-border rounded-lg transition-colors">ยกเลิก</button>
              <button onClick={addSquad} disabled={addingSquad || !newSquadName.trim()}
                className={`bg-accent hover:bg-accent-hover text-white text-[12.5px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors ${addingSquad ? 'btn-loading' : ''}`}>
                สร้าง Squad
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
