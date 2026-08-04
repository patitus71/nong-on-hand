# เริ่มโปรเจกต์ Task Board App

## บริบท
โปรเจกต์นี้เป็น scaffold เริ่มต้นของ Task Board App (Next.js 14 + Prisma + Supabase + NextAuth)
สำหรับทีม squad-based ที่มี role: ADMIN, SQ_LEAD, MEMBER, QA_LEAD, QA_ENGINEER

ก่อนเริ่มลงมือ ให้อ่านไฟล์เหล่านี้ให้ครบเพื่อเข้าใจภาพรวมทั้งหมดก่อน:
1. `README.md` — สรุปสิ่งที่มีให้แล้ว, สิ่งที่ต้องสร้างต่อ, และ flow ของทุกฟีเจอร์
2. `prisma/schema.prisma` — data model ทั้งหมด (User, Squad, Board, Lane, Task, TimeLog, Retro, RetroItem, RetroVote, ImportBatch)
3. `lib/timeCalc.ts` + `lib/timeCalc.examples.md` — logic คำนวณเวลาทำงาน + OT
4. `lib/rbac.ts` — role guard, last-admin guard, squad-scoping, grayed-out-role pattern, canResetPassword
5. `lib/importTasks.ts` — validate row + เงื่อนไข pull-into-board / assign QA_ENGINEER
6. `lib/auth.ts` และ `middleware.ts` — auth config ที่มีอยู่แล้ว
7. **โฟลเดอร์ `design-reference/`** — mockup HTML ของทุกหน้า ใช้เป็นต้นแบบหน้าตา UI แบบละเอียด
   (สี, spacing, typography, layout structure) ห้ามออกแบบใหม่เอง ให้ยึดตามนี้เป็นหลัก:
   - `login.html`
   - `tasks-page.html` (งานทั้งหมด)
   - `squad-board.html` (บอร์ดแต่ละ SQ)
   - `my-board.html` (Kanban ส่วนตัว ลากวางได้)
   - `task-detail.html` (รายละเอียดงาน + flag ปัญหา + ประวัติ retro)
   - `retro-board.html` (บอร์ด retro 3 คอลัมน์)
   - `import-and-pull.html` (import CSV/Excel + ดึงงานเข้าบอร์ด)
   - `admin-panel.html` (จัดการ user/role + reset password)

## สิ่งที่อยากให้ทำ ทำทีละขั้นตอน หยุดให้ผมทดสอบก่อนไปขั้นต่อไป

### ขั้นที่ 1 — ตั้งค่าโปรเจกต์ให้รันได้ก่อน
- `npm install`
- ช่วย copy `.env.example` เป็น `.env` แล้วบอกผมว่าต้องใส่ `DATABASE_URL` จาก Supabase ตรงไหน
- รอผมใส่ค่า `.env` เสร็จแล้วค่อยรัน `npx prisma migrate dev --name init` และ `npm run seed`
- ตรวจว่า seed สำเร็จ (เห็น user admin/sqlead1/member1/qalead1/qaeng1)

### ขั้นที่ 2 — Auth พื้นฐาน
- สร้าง `app/api/auth/[...nextauth]/route.ts` เชื่อมกับ `lib/auth.ts` ที่มีอยู่แล้ว
- สร้างหน้า `/login` ตามดีไซน์ใน `design-reference/login.html`
- ทดสอบ login ด้วย user ตัวอย่างให้ผมดูก่อน

### ขั้นที่ 3 — หน้า Tasks + Squad Board
- `app/tasks/page.tsx` ตาม `design-reference/tasks-page.html`
- `app/squads/[squadId]/page.tsx` ตาม `design-reference/squad-board.html`
- ต่อกับข้อมูลจริงจาก Prisma (ไม่ใช่ mock data แบบใน HTML)

### ขั้นที่ 4 — My Board (Kanban ลากวาง)
- `app/my-board/page.tsx` ตาม `design-reference/my-board.html`
- ใช้ `@dnd-kit` แทน native drag-and-drop ที่อยู่ใน mockup
- ต่อ drag-drop ให้ update `laneId`/`order` ใน DB จริงตอน drop
- ทำปุ่ม "+ เพิ่มเลน" ให้สร้าง `Lane` จริงใน DB

### ขั้นที่ 5 — Task detail + Retro
- `app/tasks/[taskId]/page.tsx` ตาม `design-reference/task-detail.html`
- ปุ่ม "มีปัญหา" + "ส่งเข้า retro" ตามที่อธิบายใน README หัวข้อ "Task ↔ Retro"
- `app/squads/[squadId]/retro/page.tsx` ตาม `design-reference/retro-board.html`
- ระบบโหวต + ปุ่ม "แปลงเป็นงาน" สำหรับ action item

### ขั้นที่ 6 — Import + QA_LEAD pull-in flow
- `app/tasks/import/page.tsx` ตาม `design-reference/import-and-pull.html`
- parse CSV ด้วย `papaparse`, Excel ด้วย `xlsx` (ทั้งคู่อยู่ใน package.json แล้ว)
- ทำ flow ดึงงานเข้าบอร์ด + estimate + assign QA_ENGINEER ตามที่ระบุใน README

### ขั้นที่ 7 — Admin Panel
- `app/admin/page.tsx` ตาม `design-reference/admin-panel.html`
- role dropdown แบบ grayed-out (`canAssignRole()`), toggle active, ปุ่มตั้งรหัสผ่านใหม่ (`canResetPassword()`)
- API routes ต้องเรียก `requireAdminOrSqLead()` + `assertNotLastAdmin()` ทุกครั้งตามที่ระบุใน README

## กติกาโดยรวม
- ทำทีละขั้นตอนตามลำดับข้างบน อย่าข้าม อย่าทำหลายขั้นพร้อมกัน
- จบแต่ละขั้น ให้สรุปสั้นๆ ว่าทำอะไรไปบ้าง แล้วรอผมทดสอบก่อนไปต่อ
- ถ้าเจอจุดที่ README หรือ schema ไม่ชัดเจน ให้ถามก่อนเดาเอง
- ยึด `design-reference/*.html` เป็นต้นแบบ UI แบบเป๊ะๆ (สี, ระยะห่าง, โครงสร้าง) ไม่ต้องออกแบบใหม่
