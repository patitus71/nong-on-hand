import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import Link from 'next/link';
import NavTabs from './NavTabs';
import LogoutButton from './LogoutButton';

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export default async function Topbar() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  const firstName = user?.name?.split(' ')[0] ?? 'User';
  const squadHref = user?.squadId ? `/squads/${user.squadId}` : '/squads';
  const retroHref = user?.squadId ? `/squads/${user.squadId}/retro` : '/squads';

  return (
    <header className="flex items-center justify-between px-7 py-4 border-b border-app-border sticky top-0 bg-app-bg z-10">
      <div className="flex items-center">
        <Link href="/" className="flex items-center gap-2.5">
          <div
            className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#6d8cff,#4a63c9)' }}
          >
            TB
          </div>
          <span className="text-sm font-semibold text-txt-primary">Task Board</span>
        </Link>
        <NavTabs squadHref={squadHref} retroHref={retroHref} role={user?.role ?? ''} showMyBoard={user?.role !== 'QA_MANAGER'} />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-[13px] text-txt-secondary">
          <span>สวัสดี, {firstName}</span>
          <div className="w-[26px] h-[26px] rounded-full bg-accent-bg text-accent text-[11px] font-semibold flex items-center justify-center">
            {initials(user?.name ?? 'U')}
          </div>
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
