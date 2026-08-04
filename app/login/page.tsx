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
      <div className="w-full max-w-[380px] bg-surface-1 border border-app-border rounded-[14px] px-7 py-8">

        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-7">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#6d8cff,#4a63c9)' }}
          >
            TB
          </div>
          <span className="text-base font-semibold text-txt-primary">Task Board</span>
        </div>

        <h1 className="text-lg font-semibold text-txt-primary mb-1">เข้าสู่ระบบ</h1>
        <p className="text-[13px] text-txt-secondary mb-6">กรอก username และ password ของ squad คุณ</p>

        {error && (
          <div className="flex items-center gap-1.5 bg-danger-bg text-danger text-[12.5px] px-2.5 py-2 rounded-md mb-3.5">
            ⚠ Username หรือ Password ไม่ถูกต้อง
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-3.5">
            <label className="block text-[12.5px] text-txt-secondary mb-1.5">Username</label>
            <input
              name="username"
              type="text"
              placeholder="เช่น member1"
              required
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-sm px-3 py-2.5 rounded-lg focus:outline-none focus:border-accent"
            />
          </div>
          <div className="mb-3.5">
            <label className="block text-[12.5px] text-txt-secondary mb-1.5">Password</label>
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              required
              className="w-full bg-surface-2 border border-app-border text-txt-primary text-sm px-3 py-2.5 rounded-lg focus:outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm py-[11px] rounded-lg mt-1.5 transition-colors"
          >
            {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-app-border text-[11.5px] text-txt-muted leading-relaxed">
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
