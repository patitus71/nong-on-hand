import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const sq1 = await prisma.squad.upsert({
    where: { name: "SQ1" },
    update: {},
    create: { name: "SQ1" },
  });
  const sq2 = await prisma.squad.upsert({
    where: { name: "SQ2" },
    update: {},
    create: { name: "SQ2" },
  });

  // Squad 0 — floating pool สำหรับ helper ที่ช่วยงานข้าม squad
  const sq0 = await prisma.squad.upsert({
    where: { name: "Squad 0" },
    update: {},
    create: { name: "Squad 0", isFloatingPool: true },
  });

  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
      name: "Admin User",
      role: "ADMIN",
    },
  });

  // QA_LEAD ผูก squad บังคับ — เทียบเท่า SQ_LEAD เดิม
  const qaLead = await prisma.user.upsert({
    where: { username: "qalead1" },
    update: {},
    create: {
      username: "qalead1",
      passwordHash,
      name: "QA Lead SQ1",
      role: "QA_LEAD",
      squadId: sq1.id,
    },
  });

  // QA_MANAGER ไม่ผูก squad (ดูได้ทุก squad)
  const qaManager = await prisma.user.upsert({
    where: { username: "qamanager1" },
    update: {},
    create: {
      username: "qamanager1",
      passwordHash,
      name: "QA Manager",
      role: "QA_MANAGER",
      squadId: null,
    },
  });

  const qaEngineer = await prisma.user.upsert({
    where: { username: "qaeng1" },
    update: {},
    create: {
      username: "qaeng1",
      passwordHash,
      name: "QA Engineer SQ1",
      role: "QA_ENGINEER",
      squadId: sq1.id,
    },
  });

  // helper0 — QA_ENGINEER สังกัด Squad 0 (floating pool) ช่วยงานได้ทุก squad
  const helper0 = await prisma.user.upsert({
    where: { username: "helper0" },
    update: {},
    create: {
      username: "helper0",
      passwordHash,
      name: "Floating Helper",
      role: "QA_ENGINEER",
      squadId: sq0.id,
    },
  });

  // สร้างบอร์ดส่วนตัวของ QA Engineer พร้อมเลนเริ่มต้น
  const board = await prisma.board.create({
    data: {
      name: "My Board",
      type: "PERSONAL",
      ownerId: qaEngineer.id,
      lanes: {
        create: [
          { name: "To Do", order: 0 },
          { name: "In Progress", order: 1 },
          { name: "Review", order: 2 },
          { name: "Done", order: 3 },
        ],
      },
    },
    include: { lanes: true },
  });

  await prisma.task.create({
    data: {
      title: "ตัวอย่างงานแรก",
      description: "สร้างจาก seed script",
      squadId: sq1.id,
      assigneeId: qaEngineer.id,
      laneId: board.lanes[0].id,
    },
  });

  console.log("Seed data created:", {
    admin: admin.username,
    qaLead: qaLead.username,
    qaManager: qaManager.username,
    qaEngineer: qaEngineer.username,
    helper0: helper0.username,
  });
  console.log("Default password for all users: password123");
  console.log(`Squads created: ${sq1.name}, ${sq2.name}, ${sq0.name} (floating pool)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
