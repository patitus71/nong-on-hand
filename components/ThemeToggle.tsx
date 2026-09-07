'use client';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export default function ThemeToggle() {
  // null until mounted — avoids a hydration mismatch against the inline
  // FOUC-prevention script in layout.tsx, which sets the real value pre-paint
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    setTheme(stored ?? (systemPrefersDark() ? 'dark' : 'light'));
  }, []);

  function toggle() {
    const next: Theme = (theme ?? 'light') === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
      className="w-[26px] h-[26px] flex items-center justify-center rounded-[3px] text-txt-secondary hover:text-txt-primary hover:bg-surface-2 transition-colors text-[14px]"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
