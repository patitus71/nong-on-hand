/**
 * seed-test-tasks.ts — สร้างงานตัวอย่างสำหรับทดสอบ delete feature
 * รัน: npm run seed:test
 *
 * สร้าง:
 *   - 3 งาน pending-import (IMPORTED + pulledIntoBoardAt=null) ใน SQ1 และ SQ2
 *   - 2 งาน flaggedForDeletion=true ใน SQ1 และ SQ2
 *   - 2 งานปกติที่อยู่บนบอร์ดแล้ว (ลบได้เฉพาะ ADMIN)
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const sq1 = await prisma.squad.findUnique({ where: { name: "SQ1" } });
  const sq2 = await prisma.squad.findUnique({ where: { name: "SQ2" } });
  const qaLead = await prisma.user.findUnique({ where: { username: "qalead1" } });
  const qaEng  = await prisma.user.findUnique({ where: { username: "qaeng1" } });
  const qaMgr  = await prisma.user.findUnique({ where: { username: "qamanager1" } });

  if (!sq1 || !sq2 || !qaLead || !qaEng || !qaMgr) {
    console.error("❌ ไม่พบ base data — รัน `npm run seed` ก่อน");
    process.exit(1);
  }

  // ── Pending-import tasks (checkbox ติ๊กได้, ลบได้โดย ADMIN/QA_LEAD) ──────────
  const pi1 = await prisma.task.create({
    data: {
      title:       "[TEST] งาน pending-import SQ1 — ลบได้โดย ADMIN/QA_LEAD",
      description: "source=IMPORTED, pulledIntoBoardAt=null",
      source:      "IMPORTED",
      squadId:     sq1.id,
    },
  });
  const pi2 = await prisma.task.create({
    data: {
      title:       "[TEST] งาน pending-import SQ2 — ลบได้โดย ADMIN เท่านั้น (QA_LEAD SQ1 ลบไม่ได้)",
      source:      "IMPORTED",
      squadId:     sq2.id,
    },
  });
  const pi3 = await prisma.task.create({
    data: {
      title:       "[TEST] งาน pending-import SQ1 (มี assignee) — checkbox เปิด, ลบได้",
      source:      "IMPORTED",
      squadId:     sq1.id,
      assigneeId:  qaEng.id,
    },
  });

  // ── Flagged-for-deletion tasks (ลบได้โดย ADMIN / QA_LEAD SQ1 / QA_MANAGER) ──
  // หา board SQ1 เพื่อเอา laneId ให้ task ดูเหมือนอยู่บนบอร์ด
  const sq1Board = await prisma.board.findFirst({ where: { owner: { squadId: sq1.id }, type: "SQUAD" } });
  const sq1Lane  = sq1Board ? await prisma.lane.findFirst({ where: { boardId: sq1Board.id } }) : null;

  const fl1 = await prisma.task.create({
    data: {
      title:               "[TEST] งาน flagged SQ1 — ลบได้โดย ADMIN/QA_LEAD/QA_MANAGER",
      source:              "MANUAL",
      squadId:             sq1.id,
      assigneeId:          qaEng.id,
      laneId:              sq1Lane?.id ?? null,
      pulledIntoBoardAt:   new Date(),
      flaggedForDeletion:  true,
      deletionFlagNote:    "ดูเหมือนเป็น ticket ซ้ำ",
      deletionFlaggedById: qaLead.id,
      deletionFlaggedAt:   new Date(),
    },
  });
  const fl2 = await prisma.task.create({
    data: {
      title:               "[TEST] งาน flagged SQ2 — ลบได้โดย ADMIN/QA_MANAGER เท่านั้น (QA_LEAD SQ1 ลบไม่ได้)",
      source:              "IMPORTED",
      squadId:             sq2.id,
      pulledIntoBoardAt:   new Date(),
      flaggedForDeletion:  true,
      deletionFlagNote:    "scope ผิด squad",
      deletionFlaggedById: qaMgr.id,
      deletionFlaggedAt:   new Date(),
    },
  });

  // ── งานปกติ (อยู่บนบอร์ดแล้ว ไม่ flagged) ── ADMIN ลบจากเมนูได้, role อื่น disabled ──
  const nm1 = await prisma.task.create({
    data: {
      title:             "[TEST] งานปกติ SQ1 (อยู่บนบอร์ด) — ADMIN ลบได้, QA_LEAD เมนู disabled",
      source:            "MANUAL",
      squadId:           sq1.id,
      assigneeId:        qaEng.id,
      laneId:            sq1Lane?.id ?? null,
      pulledIntoBoardAt: new Date(),
    },
  });
  const nm2 = await prisma.task.create({
    data: {
      title:             "[TEST] งานปกติ ไม่มี squad — ADMIN ลบได้เท่านั้น",
      source:            "MANUAL",
    },
  });

  console.log("\n✅ สร้าง test tasks สำเร็จ:");
  console.log("  Pending-import:", [pi1.id, pi2.id, pi3.id].map(id => id.slice(0,8)).join(", "));
  console.log("  Flagged:       ", [fl1.id, fl2.id].map(id => id.slice(0,8)).join(", "));
  console.log("  Normal:        ", [nm1.id, nm2.id].map(id => id.slice(0,8)).join(", "));
  console.log("\nทดสอบ role ต่างๆ:");
  console.log("  ADMIN (admin)         — ลบได้ทุกงาน เมนู enable ทุกแถว");
  console.log("  QA_LEAD SQ1 (qalead1) — ลบได้ pi1, pi3, fl1 เท่านั้น (SQ1 + pending/flagged)");
  console.log("  QA_MANAGER (qamanager1) — ลบได้ fl1, fl2 เท่านั้น (flagged เท่านั้น)");
  console.log("  QA_ENGINEER (qaeng1)  — ไม่เห็นเมนู ⋯ เลย");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
