'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavTabs({
  squadHref,
  retroHref,
  role,
  showMyBoard,
}: {
  squadHref: string;
  retroHref: string;
  role: string;
  showMyBoard: boolean;
}) {
  const path = usePathname();

  const tabs = [
    ...(role === 'ADMIN' ? [{ label: 'Admin Panel', href: '/admin', active: path.startsWith('/admin') }] : []),
    { label: 'งานทั้งหมด', href: '/tasks',    active: path.startsWith('/tasks') },
    { label: 'SQ ของฉัน',  href: squadHref,   active: path.startsWith('/squads') && !path.includes('/retro') },
    ...(showMyBoard ? [{ label: 'บอร์ดของฉัน', href: '/my-board', active: path.startsWith('/my-board') }] : []),
    { label: 'Retro',       href: retroHref,   active: path.includes('/retro') },
  ];

  return (
    <nav className="flex gap-1 ml-6">
      {tabs.map(tab => (
        <Link
          key={tab.label}
          href={tab.href}
          className={`text-[13px] px-3 py-1.5 rounded-md transition-colors ${
            tab.active
              ? 'bg-surface-2 text-txt-primary'
              : 'text-txt-secondary hover:text-txt-primary'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
