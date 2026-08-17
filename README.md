# Task Board App — Starter Scaffold

โปรเจกต์เริ่มต้นสำหรับ Web App จัดการงานแบบ Kanban (คล้าย Jira) พร้อม role-based board
และระบบ log เวลาทำงานที่คำนวณ OT อัตโนมัติ

## สิ่งที่มีให้แล้ว
- `prisma/schema.prisma` — data model ครบ (User, Squad, Board, Lane, Task, TimeLog)
- `prisma/seed.ts` — ข้อมูลตัวอย่าง (admin, sqlead1, member1 / password: `password123`)
- `lib/timeCalc.ts` — ฟังก์ชันคำนวณเวลาทำงานจริง + OT (ทดสอบแล้วตาม `lib/timeCalc.examples.md`)
- `lib/importTasks.ts` — validate แถวข้อมูล + เงื่อนไข pull-into-board และ assign ให้ QA_ENGINEER
- `lib/auth.ts` — NextAuth config (JWT, 30 นาที inactivity timeout)
- `lib/rbac.ts` — role guard, last-admin guard, squad-scoping, grayed-out-role pattern
- `middleware.ts` — guard เส้นทาง `/admin/**`
- `import-template.csv` — ตัวอย่างไฟล์ import งานจำนวนมาก
- `.env.example` — ตัวแปรที่ต้องตั้งค่า
- `package.json` — dependency ที่ต้องใช้ (Next.js, Prisma, NextAuth, dnd-kit, Tailwind)

## สิ่งที่ยังต้องสร้างต่อ (แนะนำให้ Claude Code ช่วยทำต่อ)
1. `app/layout.tsx`, `app/globals.css`, Tailwind config
2. `lib/auth.ts` — NextAuth config (CredentialsProvider เช็ค username/passwordHash)
3. `app/api/auth/[...nextauth]/route.ts`
4. หน้า UI หลัก:
   - `app/tasks/page.tsx` — ดูงานทั้งหมด (table/filter)
   - `app/squads/[squadId]/page.tsx` — งานของแต่ละ SQ
   - `app/my-board/page.tsx` — Kanban ส่วนตัว ลากวางด้วย `@dnd-kit`, ปุ่มสร้าง/ลบ/เรียงเลน
   - `app/admin/page.tsx` — Admin จัดการ role/squad
   - Middleware เช็ค role เพื่อแยก view ต่อ role
5. Component สำหรับ log เวลา (ปุ่ม "เริ่มทำ" / "จบงาน" หรือกรอกเวลาย้อนหลัง) ที่เรียก `calcWorkedTime`
6. **Retro (Retrospective)** — เพิ่ม model แล้วใน schema (`Retro`, `RetroItem`, `RetroVote`)
   - `app/squads/[squadId]/retro/page.tsx` — สร้าง retro ใหม่ต่อ squad (เช่น "Retro Sprint 12")
   - บอร์ด 3 คอลัมน์: Went well / To improve / Action items — สมาชิกเพิ่มการ์ดได้ ระบุ authorId อัตโนมัติจาก session
   - ปุ่มโหวตการ์ด (unique ต่อ user+item กันโหวตซ้ำ ผ่าน `@@unique([retroItemId, userId])`)
   - การ์ดใน category `ACTION_ITEM` เลือก "ผู้รับผิดชอบ" (`ownerId`) ได้ และกดปุ่ม "แปลงเป็นงาน" เพื่อสร้าง `Task` จริงแล้วผูกกลับผ่าน `linkedTaskId` — ทำให้ action item ไปโผล่ในบอร์ดงานปกติและ track ต่อได้
   - ปิด retro ได้ (`status: CLOSED`, ตั้ง `closedAt`) เพื่อดู retro เก่าย้อนหลังแบบ read-only

7. **Task ↔ Retro (two-way link)** — ความสัมพันธ์เป็นสองทางอยู่แล้วใน schema (`Task.retroItems` <-> `RetroItem.linkedTask`)
   - บน task card เพิ่มปุ่ม "มีปัญหา" ที่ set `hasIssue = true` และกรอก `issueNote` สั้นๆ
   - task ที่ `hasIssue = true` ให้ขึ้น badge สีแดง/ไอคอนเตือนบนบอร์ด (ทุกมุมมอง: my-board, squad board, all tasks)
   - ปุ่ม "ส่งเข้า retro" จาก task card → สร้าง `RetroItem` ใหม่ category `TO_IMPROVE` ใน retro ที่ `status: OPEN` ของ squad นั้น พร้อม prefill เนื้อหาจาก `issueNote` และ set `linkedTaskId` ชี้กลับมาที่ task นี้ทันที
   - บน task detail page แสดง section "พูดถึงใน retro" โดย query `task.retroItems` — เห็นได้ว่างานนี้เคยถูกพูดถึงใน retro รอบไหนบ้าง กี่ครั้ง กลายเป็นปัญหาซ้ำๆ หรือเปล่า
   - ถ้าไม่มี retro ที่ `OPEN` อยู่ในตอนนั้น ให้ fallback เป็นสร้าง retro ใหม่อัตโนมัติ หรือแจ้งให้ผู้ใช้ไปเปิด retro ก่อน (ตัดสินใจตาม UX ที่ต้องการ)

8. **Import งานจำนวนมาก (CSV/Excel) + QA_LEAD pull-in flow**
   - เพิ่ม role `QA_LEAD` และ `QA_ENGINEER` แล้วใน schema (นอกเหนือจาก ADMIN/SQ_LEAD/MEMBER เดิม)
   - `app/tasks/import/page.tsx` — หน้าอัปโหลดไฟล์ (Admin/SQ_LEAD/QA_LEAD ใช้ได้) รองรับ `.csv` (parse ด้วย `papaparse`) และ `.xlsx` (parse ด้วย `xlsx`/SheetJS) — ดูตัวอย่างคอลัมน์ที่ `import-template.csv`
   - Flow: parse ไฟล์ → validate ทุกแถวด้วย `lib/importTasks.ts` (`validateRow`) → โชว์ preview + error ก่อน confirm → สร้าง `ImportBatch` แล้ว bulk create `Task` (`source: "IMPORTED"`, `laneId: null`, `assigneeId: null`)
   - งานที่ import แล้วจะโผล่ในหน้า **"งานทั้งหมด"** ทันที (ยังไม่อยู่ในบอร์ดของใคร เพราะ `laneId` เป็น null)
   - **QA_LEAD** มองเห็นงานใน "งานทั้งหมด" ที่ `squadId` ตรงกับ squad ตัวเอง (หรือยังไม่ระบุ squad) แล้วกดปุ่ม **"ดึงเข้าบอร์ด"** → เช็คสิทธิ์ด้วย `canPullIntoBoard()` → set `laneId` เป็นเลนเริ่มต้นของบอร์ด squad ตัวเอง และ set `pulledIntoBoardAt = now()`
   - หลังดึงเข้าบอร์ดแล้ว QA_LEAD กรอก **estimate** (`estimatedMinutes`) และเลือกผู้รับผิดชอบจาก dropdown ที่ filter เฉพาะ user ที่เป็น `QA_ENGINEER` ใน squad เดียวกัน — validate ด้วย `canAssignTaskTo()` ก่อนบันทึกกัน assign ข้าม squad ผิดพลาด
   - หน้า "งานทั้งหมด" ควรมี badge บอกว่างานไหน `source: IMPORTED` และงานไหนยังไม่ถูกดึงเข้าบอร์ด (`pulledIntoBoardAt: null`) เพื่อให้ QA_LEAD หาได้ง่าย

## Auth & Roles (อ้างอิงจาก qa-assist)

- Login แบบ username/password (bcryptjs) ผ่าน `NextAuthOptions` ใน `lib/auth.ts`
- Session ใช้ NextAuth default (JWT, อายุ 30 วัน) — ไม่บังคับ inactivity timeout เพราะเป็น internal tool ไม่ต้องการ security posture เข้มขนาดนั้น
- Role ฝังอยู่ใน JWT โดยตรง ไม่ query DB ซ้ำทุก request — เร็วกว่า แต่หมายความว่าถ้า admin เปลี่ยน role ของใคร คนนั้นต้อง login ใหม่ถึงจะมีผล
- `middleware.ts` guard เส้นทาง `/admin/**` ให้เฉพาะ `ADMIN` และ `SQ_LEAD` (เทียบเท่า MANAGER ในระบบเดิม) route อื่นต้อง login ก่อนถึงเข้าได้
- **`lib/rbac.ts`** รวม pattern สำคัญที่ต้องใช้ซ้ำ:
  - `requireAdminOrSqLead()` / `requireRole()` — re-verify role ฝั่ง server ทุก API route ใต้ `/api/admin/**` (ห้ามพึ่ง middleware หรือซ่อนปุ่มฝั่ง UI อย่างเดียว)
  - `assertNotLastAdmin()` — **last-admin guard** กันไม่ให้ระบบเหลือ ADMIN 0 คน (เรียกก่อน demote/ปิดใช้งาน ADMIN คนใดก็ตาม)
  - `squadScopeFilter()` — ใช้กรอง query ให้ SQ_LEAD/QA_LEAD เห็นเฉพาะข้อมูลของ squad ตัวเอง (ADMIN เห็นทั้งหมด)
  - `canAssignRole()` — pattern **"grayed-out-but-visible"**: SQ_LEAD เห็นตัวเลือก "ADMIN" ในหน้า admin panel แต่กดเลือกไม่ได้ (ต้องเป็น ADMIN เท่านั้นที่ promote คนอื่นเป็น ADMIN)
- `User.active` (Boolean) — ปิดการใช้งาน user ได้โดยไม่ต้องลบข้อมูล (login ไม่ได้ถ้า `active: false`)

### สิ่งที่ต้องสร้างต่อสำหรับหน้า Admin Panel
- `app/admin/page.tsx` — tab "Users": ตาราง user + role dropdown ต่อแถว (ใช้ `canAssignRole()` เพื่อ gray-out ตัวเลือก ADMIN สำหรับ SQ_LEAD), toggle active, squad assignment
- ปุ่ม "ตั้งรหัสผ่านใหม่" ต่อแถว เปิด modal ให้กรอกรหัสผ่านใหม่ (หรือกดสุ่มให้) — เช็คสิทธิ์ด้วย `canResetPassword()` ก่อนเสมอ (กติกาเดียวกับ role: SQ_LEAD ตั้งให้ ADMIN ไม่ได้ ยกเว้นตั้งเอง)
- `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts` — ต้องเรียก `requireAdminOrSqLead()` และ `assertNotLastAdmin()` ก่อน update ทุกครั้ง
- `app/api/admin/users/[id]/password/route.ts` — endpoint แยกสำหรับตั้งรหัสผ่านใหม่ **ต้อง**:
  - เรียก `canResetPassword()` เช็คสิทธิ์ก่อนเสมอ (ห้ามพึ่งแค่ UI ซ่อนปุ่ม)
  - `bcrypt.hash()` รหัสผ่านก่อนบันทึกทุกครั้ง ห้ามเก็บ plain text แม้ชั่วคราว
  - ไม่ log รหัสผ่านลง console/audit log แม้ตอน debug
  - response กลับไปห้ามมี field รหัสผ่าน (แม้ hash แล้ว) ปนอยู่เด็ดขาด
- Redirect หลัง login: `ADMIN`/`SQ_LEAD` → `/admin`, role อื่น → `/dashboard` (ตาม pattern เดิม)

## วิธีเริ่มต้น


```bash
npm install
cp .env.example .env
# ใส่ DATABASE_URL จาก Supabase Project Settings > Database
npx prisma migrate dev --name init
npm run seed
npm run dev
```

## หมายเหตุเรื่อง OT
`lib/timeCalc.ts` ตอนนี้ตั้งไว้ว่า:
- เวลาทำงานปกติ = 09:00–18:00 จันทร์-ศุกร์
- นอกช่วงนี้ (ก่อน 9 โมง, หลัง 18:00, หรือเสาร์-อาทิตย์) = OT ทั้งหมด

ถ้าต้องการให้เสาร์-อาทิตย์ "ไม่นับเวลาเลย" แทนที่จะเป็น OT ให้แจ้ง Claude Code ปรับ
เงื่อนไข `isWeekend` ในฟังก์ชัน `calcWorkedTime` ให้ `continue` ข้ามวันนั้นแทน
