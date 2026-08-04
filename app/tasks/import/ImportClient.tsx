'use client';

import { useRef, useState } from 'react';
import { validateRow } from '@/lib/importTasks';

type Squad = { id: string; name: string };

type ParsedRow = {
  index:          number;
  title:          string;
  description?:   string;
  squad?:         string;
  squadId?:       string;
  estimateHours?: number;
  errors:         string[];
};

function downloadTemplate() {
  const csv = 'title,description,squad,estimateHours\nตัวอย่างงาน 1,รายละเอียด,SQ1,2\nตัวอย่างงาน 2,,SQ2,4\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'import-template.csv'; a.click();
  URL.revokeObjectURL(url);
}

async function parseFile(file: File, squads: Squad[]): Promise<ParsedRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  let rawRows: Record<string, any>[];

  if (ext === 'csv') {
    const Papa = (await import('papaparse')).default;
    const text = await file.text();
    rawRows = (Papa.parse(text, { header: true, skipEmptyLines: true }).data) as Record<string, any>[];
  } else {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }

  return rawRows.map((raw, i) => {
    const errors = validateRow(raw, i);
    const squadName = String(raw.squad ?? '').trim();
    const matchedSquad = squadName ? squads.find(s => s.name === squadName) : undefined;
    if (squadName && !matchedSquad) errors.push(`แถวที่ ${i + 1}: ไม่พบ squad "${squadName}"`);
    return {
      index:         i,
      title:         String(raw.title ?? '').trim(),
      description:   String(raw.description ?? '').trim() || undefined,
      squad:         squadName || undefined,
      squadId:       matchedSquad?.id,
      estimateHours: raw.estimateHours ? Number(raw.estimateHours) : undefined,
      errors,
    };
  });
}

export default function ImportClient({ squads }: { squads: Squad[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile]           = useState<File | null>(null);
  const [rows, setRows]           = useState<ParsedRow[]>([]);
  const [parsing, setParsing]     = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(0);

  async function handleFile(f: File) {
    setFile(f); setRows([]); setParsing(true); setImportDone(0);
    setRows(await parseFile(f, squads));
    setParsing(false);
  }

  async function doImport() {
    if (!file || importing) return;
    const valid = rows.filter(r => r.errors.length === 0);
    if (valid.length === 0) return;
    setImporting(true);
    const res = await fetch('/api/tasks/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        fileName: file.name,
        rows: valid.map(r => ({
          title:         r.title,
          description:   r.description,
          squadId:       r.squadId,
          estimateHours: r.estimateHours,
        })),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setImportDone(data.count);
      setFile(null); setRows([]);
    }
    setImporting(false);
  }

  const errorCount = rows.filter(r => r.errors.length > 0).length;
  const validCount = rows.filter(r => r.errors.length === 0).length;
  const allErrors  = rows.flatMap(r => r.errors);

  return (
    <div className="max-w-[960px] mx-auto px-7 py-6 pb-16">
      <p className="text-[19px] font-semibold text-txt-primary mb-1">Import งานจากไฟล์</p>
      <p className="text-[13px] text-txt-secondary mb-5">
        อัปโหลด CSV หรือ Excel เพื่อสร้างงานหลายรายการพร้อมกัน — งานจะไปอยู่ใน "งานทั้งหมด" รอดึงเข้าบอร์ดทีหลัง
      </p>

      {/* Success banner */}
      {importDone > 0 && (
        <div className="flex flex-col gap-1 bg-success-bg border border-success/30 text-success text-[12.5px] px-3 py-2.5 rounded-lg mb-5 leading-relaxed">
          <span>✓ Import สำเร็จ {importDone} งาน</span>
          <span className="text-txt-secondary">
            งานอยู่ใน{' '}
            <a href="/tasks" className="text-accent underline">งานทั้งหมด</a>
            {' '}แล้ว — เลือกงานแล้วกด "📥 ดึงเข้าบอร์ด" เพื่อ assign และตั้ง estimate ได้เลย
          </span>
        </div>
      )}

      {/* Dropzone */}
      {!file && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className="border border-dashed border-app-border rounded-[12px] p-9 text-center cursor-pointer mb-5 hover:border-accent hover:bg-[#161a26] transition-colors"
        >
          <div className="text-[26px] mb-2">⬆</div>
          <p className="text-[14px] font-medium text-txt-primary mb-1">ลากไฟล์มาวาง หรือคลิกเพื่อเลือกไฟล์</p>
          <p className="text-[12.5px] text-txt-muted">
            ต้องมีคอลัมน์ title (จำเป็น), description, squad, estimateHours (หน่วยชั่วโมง)
          </p>
          <div className="flex gap-1.5 justify-center mt-2.5">
            {['.csv', '.xlsx'].map(f => (
              <span key={f} className="text-[11px] bg-surface-2 text-txt-secondary px-2.5 py-[3px] rounded-full">{f}</span>
            ))}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); downloadTemplate(); }}
              className="text-[11px] bg-surface-2 text-txt-secondary px-2.5 py-[3px] rounded-full hover:text-txt-primary transition-colors"
            >
              ดาวน์โหลด template
            </button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

      {/* File preview */}
      {(file || parsing) && (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-[13px]">
              <span>📄</span>
              <span className="font-medium text-txt-primary">{file?.name}</span>
              <span className="text-txt-muted text-[12px]">{rows.length} แถว</span>
            </div>
            <button
              onClick={() => { setFile(null); setRows([]); setImportDone(0); }}
              className="text-[12px] text-txt-secondary bg-surface-2 border border-app-border px-2.5 py-[5px] rounded-md hover:bg-[#2a2e3a] transition-colors"
            >
              เปลี่ยนไฟล์
            </button>
          </div>

          {parsing && <p className="text-[12.5px] text-txt-secondary mb-4">กำลัง parse ไฟล์...</p>}

          {!parsing && errorCount > 0 && (
            <div className="flex items-start gap-2 bg-warning-bg border border-warning/30 rounded-lg px-3 py-2.5 text-[12.5px] text-warning mb-3.5">
              <span>⚠</span>
              <div>
                พบ {errorCount} แถวที่มีปัญหา — แถวเหล่านี้จะไม่ถูก import
                <ul className="mt-1 pl-4">
                  {allErrors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            </div>
          )}

          {!parsing && rows.length > 0 && (
            <table className="w-full border-collapse bg-surface-1 border border-app-border rounded-[10px] overflow-hidden mb-5">
              <thead>
                <tr className="border-b border-app-border">
                  {['', 'Title', 'Squad', 'Estimate', 'Description'].map(h => (
                    <th key={h} className="text-left text-[11.5px] font-medium text-txt-muted uppercase tracking-wide px-3 py-2.5 border-b border-app-border">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.index}
                    className={`border-b border-app-border last:border-none ${row.errors.length > 0 ? 'bg-danger/5' : ''}`}>
                    <td className="px-3 py-2.5 w-6">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${row.errors.length > 0 ? 'bg-danger' : 'bg-success'}`} />
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] text-txt-primary">
                      {row.title || <span className="text-danger italic">ไม่มีชื่อ</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.squad && (
                        <span className="text-[10.5px] bg-surface-2 text-txt-secondary px-2 py-[2px] rounded-full">{row.squad}</span>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 text-[12.5px] ${row.errors.some(e => e.includes('estimateHours')) ? 'text-danger' : 'text-txt-secondary'}`}>
                      {row.estimateHours ? `${row.estimateHours} ชม.` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-[12.5px] text-txt-secondary">{row.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!parsing && (
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setFile(null); setRows([]); }}
                className="bg-surface-2 border border-app-border text-txt-primary text-[13px] px-3.5 py-2 rounded-md hover:bg-[#2a2e3a] transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={doImport}
                disabled={importing || validCount === 0}
                className="bg-accent text-white text-[13px] px-3.5 py-2 rounded-md font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {importing
                  ? 'กำลัง import...'
                  : `Import ${validCount} งาน${errorCount > 0 ? ` (ข้าม ${errorCount} แถวที่ error)` : ''}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
