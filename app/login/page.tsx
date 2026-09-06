'use client';

import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(false);
    setLoading(true);

    const form = e.currentTarget;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    const res = await signIn('credentials', { username, password, redirect: false });
    setLoading(false);

    if (!res?.ok) {
      setError(true);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-app-bg flex items-center justify-center">
      <div className="w-full max-w-[420px] bg-surface-1 border border-app-border rounded-[2px] px-[30px] py-[34px] shadow-[0_1px_1px_rgba(10,46,98,.05),0_6px_14px_-6px_rgba(10,46,98,.18),inset_0_1px_0_rgba(255,255,255,.9)]">

        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-[18px]">
          <div className="w-8 h-8 rounded-[3px] flex items-center justify-center text-[13px] font-bold text-white bg-accent">
            TB
          </div>
          <span className="text-base font-semibold text-txt-primary">Task Board</span>
        </div>

        <h1 className="text-lg font-semibold text-txt-primary mb-1">เข้าสู่ระบบ</h1>
        <p className="text-[13px] text-txt-secondary mb-[18px]">กรอก username และ password ของ squad คุณ</p>

        {error && (
          <div className="flex items-center gap-1.5 bg-danger-bg text-danger text-[12.5px] px-2.5 py-2 rounded-[3px] mb-3.5">
            ⚠ Username หรือ Password ไม่ถูกต้อง
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-[18px] flex flex-col gap-1.5">
            <label className="text-[12.5px] text-txt-secondary">ชื่อผู้ใช้ · Username</label>
            <input
              name="username"
              type="text"
              placeholder="เช่น member1"
              required
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-sm px-3 py-[11px] rounded-[3px] focus:outline-none focus:border-accent"
            />
          </div>
          <div className="mb-[18px] flex flex-col gap-1.5">
            <label className="text-[12.5px] text-txt-secondary">รหัสผ่าน · Password</label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              required
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-sm px-3 py-[11px] rounded-[3px] focus:outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm py-3 rounded-[3px] border border-accent transition-colors"
          >
            {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <div className="mt-3.5 pt-3.5 border-t border-[#DEE3E9] text-[11.5px] text-txt-muted leading-[1.7]">
          ตัวอย่างบัญชีทดสอบ (จาก seed data):<br />
          <span className="text-txt-secondary font-medium">admin</span>{' / '}
          <span className="text-txt-secondary font-medium">sqlead1</span>{' / '}
          <span className="text-txt-secondary font-medium">member1</span>{' / '}
          <span className="text-txt-secondary font-medium">qalead1</span>{' / '}
          <span className="text-txt-secondary font-medium">qaeng1</span><br />
          รหัสผ่านทุกคน: <span className="text-txt-secondary font-medium">password123</span>
        </div>
      </div>
    </main>
  );
}
