export function fmt(minutes: number): string | null {
  if (minutes === 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function avatarColor(name: string): { bg: string; fg: string } {
  const palette = [
    { bg: '#1c2340', fg: '#6d8cff' },
    { bg: '#153323', fg: '#4fbf7a' },
    { bg: '#3a2f1a', fg: '#e3a83e' },
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return palette[h % palette.length];
}

export function laneBadgeCls(name: string | null): string {
  if (!name) return 'bg-surface-2 text-txt-muted';
  const l = name.toLowerCase();
  if (l.includes('done'))     return 'bg-success-bg text-success';
  if (l.includes('progress')) return 'bg-accent-bg text-accent';
  if (l.includes('review'))   return 'bg-warning-bg text-warning';
  return 'bg-surface-2 text-txt-secondary';
}
