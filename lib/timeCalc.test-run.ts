// Quick sanity-check runner — run with: npx tsx lib/timeCalc.test-run.ts
import { calcWorkedTime } from './timeCalc';

const D = '2026-08-21T';

const cases = [
  { label: '15:00-16:18 (ไม่คาบพักเที่ยง)', s: D+'15:00:00', e: D+'16:18:00', expN: 78,  expOT: 0   },
  { label: '11:00-14:00 (คาบพักเที่ยงจริง)',  s: D+'11:00:00', e: D+'14:00:00', expN: 120, expOT: 0   },
  { label: '09:00-20:00 (เกิน 18:00)',         s: D+'09:00:00', e: D+'20:00:00', expN: 480, expOT: 120 },
];

let allPass = true;
for (const c of cases) {
  const r   = calcWorkedTime(new Date(c.s), new Date(c.e));
  const ok  = r.normalMinutes === c.expN && r.otMinutes === c.expOT;
  if (!ok) allPass = false;
  console.log(
    (ok ? '✓ PASS' : '✗ FAIL'), c.label,
    '| got normal:', r.normalMinutes, 'OT:', r.otMinutes,
    '| expected normal:', c.expN, 'OT:', c.expOT,
  );
}

if (!allPass) {
  console.error('\nบางเคสไม่ผ่าน!');
  process.exit(1);
} else {
  console.log('\nทุกเคสผ่าน ✓');
}
