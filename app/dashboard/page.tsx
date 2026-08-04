import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import LogoutButton from '@/components/LogoutButton';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const user = session.user as any;

  return (
    <main className="min-h-screen bg-app-bg flex items-center justify-center">
      <div className="w-full max-w-sm bg-surface-1 border border-app-border rounded-[14px] px-7 py-8">
        <div className="flex items-center gap-2.5 mb-6">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#6d8cff,#4a63c9)' }}
          >
            TB
          </div>
          <span className="text-base font-semibold text-txt-primary">Task Board</span>
        </div>

        <p className="text-txt-secondary text-sm">ยินดีต้อนรับ</p>
        <p className="text-xl font-semibold text-txt-primary mt-1">{user.name}</p>
        <p className="text-xs text-txt-muted mt-1">
          Role: <span className="text-txt-secondary">{user.role}</span>
          {user.squadId && <> • Squad: <span className="text-txt-secondary">{user.squadId}</span></>}
        </p>

        <p className="text-xs text-accent mt-5">หน้า Tasks กำลังสร้างในขั้นถัดไป</p>

        <div className="mt-6 pt-4 border-t border-app-border">
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
