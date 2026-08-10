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

// แปลง markdown output ของ generateWeeklyReportMarkdown / generatePersonalReportMarkdown เป็น HTML
export function renderReportMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;

  function inlineHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/_(✅[^_]*)_/g, '<span style="color:var(--success)">$1</span>')
      .replace(/_(⚠[^_]*)_/g, '<span style="color:var(--warning)">$1</span>')
      .replace(/_\(▲ (\d+)\)_/g, '<span style="color:var(--accent)">(▲ $1)</span>')
      .replace(/_(.+?)_/g, '<em>$1</em>');
  }

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('# ')) {
      out.push(`<h1 style="font-size:18px;font-weight:700;color:var(--txt-primary);margin:0 0 4px">${inlineHtml(line.slice(2))}</h1>`);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      out.push(`<h2 style="font-size:14px;font-weight:600;color:var(--txt-primary);margin:18px 0 6px;border-bottom:1px solid var(--app-border);padding-bottom:4px">${inlineHtml(line.slice(3))}</h2>`);
      i++; continue;
    }
    if (line.startsWith('### ')) {
      out.push(`<h3 style="font-size:12.5px;font-weight:600;color:var(--txt-secondary);margin:10px 0 4px">${inlineHtml(line.slice(4))}</h3>`);
      i++; continue;
    }
    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) { tableLines.push(lines[i]); i++; }
      const parseRow = (r: string) => r.split('|').slice(1, -1).map(c => c.trim());
      const headers = parseRow(tableLines[0]);
      const body    = tableLines.slice(2);
      let html = '<div style="overflow-x:auto;margin:8px 0"><table style="width:100%;border-collapse:collapse;font-size:12px">';
      html += '<thead><tr>' + headers.map(h =>
        `<th style="text-align:left;padding:6px 10px;background:var(--surface-2);color:var(--txt-secondary);border:1px solid var(--app-border);white-space:nowrap">${inlineHtml(h)}</th>`
      ).join('') + '</tr></thead><tbody>';
      for (const row of body) {
        html += '<tr>' + parseRow(row).map(c =>
          `<td style="padding:6px 10px;border:1px solid var(--app-border);color:var(--txt-primary);vertical-align:top">${inlineHtml(c)}</td>`
        ).join('') + '</tr>';
      }
      html += '</tbody></table></div>';
      out.push(html); continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(`<li style="margin:2px 0;color:var(--txt-primary)">${inlineHtml(lines[i].slice(2))}</li>`);
        i++;
      }
      out.push(`<ul style="margin:4px 0 8px 16px;padding:0">${items.join('')}</ul>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(`<p style="margin:4px 0;font-size:12.5px;color:var(--txt-primary)">${inlineHtml(line)}</p>`);
    i++;
  }
  return out.join('\n');
}

export function laneBadgeCls(name: string | null): string {
  if (!name) return 'bg-surface-2 text-txt-muted';
  const l = name.toLowerCase();
  if (l.includes('done'))     return 'bg-success-bg text-success';
  if (l.includes('progress')) return 'bg-accent-bg text-accent';
  if (l.includes('review'))   return 'bg-warning-bg text-warning';
  return 'bg-surface-2 text-txt-secondary';
}
