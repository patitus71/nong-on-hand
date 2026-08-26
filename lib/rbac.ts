// lib/rbac.ts
// รวม guard functions สำหรับ 4-role system: ADMIN | QA_LEAD | QA_MANAGER | QA_ENGINEER
// หลักการ: middleware กันหน้าบ้าน แต่ทุก API route ต้องเช็คซ้ำฝั่ง server เสมอ

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type SessionUser = {
  id: string;
  role: "ADMIN" | "QA_LEAD" | "QA_MANAGER" | "QA_ENGINEER";
  squadId: string | null;
  isFloatingPoolMember?: boolean;
};

// ─── Basic Guards ──────────────────────────────────────────────────────────────

/** ใช้กับ API route ที่ ADMIN เท่านั้นเข้าได้ */
export function requireAdmin(user: SessionUser | null | undefined) {
  if (!user || user.role !== "ADMIN") {
    throw new Response("Forbidden", { status: 403 });
  }
}

/** ADMIN หรือ QA_LEAD เข้าได้ */
export function requireAdminOrQaLead(user: SessionUser | null | undefined) {
  if (!user || (user.role !== "ADMIN" && user.role !== "QA_LEAD")) {
    throw new Response("Forbidden", { status: 403 });
  }
}

export function requireRole(user: SessionUser | null | undefined, allowed: SessionUser["role"][]) {
  if (!user || !allowed.includes(user.role)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

/**
 * Last-admin guard: ป้องกันไม่ให้ระบบเหลือ ADMIN 0 คน
 * เรียกก่อน demote role, set active=false, หรือ soft-delete user ที่เป็น ADMIN
 */
export async function assertNotLastAdmin(targetUserId: string) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target || target.role !== "ADMIN") return;

  const adminCount = await prisma.user.count({
    where: { role: "ADMIN", active: true, deletedAt: null, id: { not: targetUserId } },
  });

  if (adminCount === 0) {
    throw new Response(
      "ไม่สามารถลบ/ปิดใช้งาน หรือลด role ของ Admin คนสุดท้ายในระบบได้",
      { status: 400 }
    );
  }
}

// ─── Scope & Visibility ────────────────────────────────────────────────────────

/**
 * กรอง query ให้ QA_LEAD/QA_ENGINEER เห็นเฉพาะ squad ตัวเอง
 * ADMIN, QA_MANAGER และ floating pool member ไม่ถูกกรอง
 */
export function squadScopeFilter(user: SessionUser) {
  if (user.role === "ADMIN" || user.role === "QA_MANAGER") return {};
  if (user.isFloatingPoolMember) return {};
  if (!user.squadId) return { squadId: "___no_squad___" };
  return { squadId: user.squadId };
}

// ─── Squad Board ───────────────────────────────────────────────────────────────

/** ADMIN แก้ไขได้ทุก squad, QA_LEAD แก้ไขได้เฉพาะ squad ตัวเอง, role อื่น view-only เสมอ */
export function canEditSquadBoard(user: SessionUser, targetSquadId: string): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "QA_LEAD") return user.squadId === targetSquadId;
  return false;
}

/**
 * กรองว่า task นี้ควรโชว์บน Squad Board ของ user หรือเปล่า
 * QA_LEAD เห็นเฉพาะงานที่ assignee เป็น QA_LEAD ตัวเองหรือ QA_ENGINEER
 * role อื่นใน squad เห็นได้ทุกงาน (ไม่ถูกกรอง)
 */
export function isTaskVisibleOnSquadBoard(
  user: SessionUser,
  task: { assigneeRole?: string | null }
): boolean {
  if (user.role !== "QA_LEAD") return true;
  if (!task.assigneeRole) return true; // งานที่ยังไม่ assign ให้ QA_LEAD เห็นด้วย
  return task.assigneeRole === "QA_LEAD" || task.assigneeRole === "QA_ENGINEER";
}

/** ADMIN/QA_LEAD assign งานได้, floating pool member assign ได้ข้าม squad, QA_MANAGER/QA_ENGINEER ทำไม่ได้ */
export function canAssignTaskOnSquadBoard(user: SessionUser, targetSquadId: string): boolean {
  if (user.role === "ADMIN") return true;
  if (user.isFloatingPoolMember) return true;
  if (user.role === "QA_LEAD") return user.squadId === targetSquadId;
  return false;
}

// ─── My Board ─────────────────────────────────────────────────────────────────

/** ปุ่ม "✎ แก้ไขเลน" โชว์เฉพาะ ADMIN และ QA_LEAD */
export function canEditMyBoardLanes(user: SessionUser): boolean {
  return user.role === "ADMIN" || user.role === "QA_LEAD";
}

/** เมนู "บอร์ดของฉัน" ซ่อนสำหรับ QA_MANAGER (role นี้ไม่มี my-board) */
export function showMyBoardMenu(user: SessionUser): boolean {
  return user.role !== "QA_MANAGER";
}

// ─── Task CRUD ─────────────────────────────────────────────────────────────────

/** Import CSV/Excel: ADMIN และ QA_LEAD เท่านั้น (QA_MANAGER ห้าม) */
export function canImportTasks(user: SessionUser): boolean {
  return user.role === "ADMIN" || user.role === "QA_LEAD";
}

/** สร้างงานใหม่ (My Board / tasks page): ทุก role ยกเว้น QA_MANAGER */
export function canCreateTask(user: SessionUser): boolean {
  return user.role !== "QA_MANAGER";
}

/** สร้างงานบน Squad Board: ADMIN, QA_LEAD (เฉพาะ squad ตัวเอง), QA_MANAGER ทำได้ */
export function canCreateTaskOnSquadBoard(user: SessionUser, targetSquadId: string): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "QA_MANAGER") return true;
  if (user.role === "QA_LEAD") return user.squadId === targetSquadId;
  return false;
}

export type DeletableTask = {
  squadId: string | null;
  source: string;
  pulledIntoBoardAt: Date | null;
  flaggedForDeletion: boolean;
};

/**
 * ลบ task (soft-delete) — กติกาแยกตาม role:
 * ADMIN: ลบได้ทุกงานเสมอ
 * QA_LEAD: ลบได้เฉพาะงานใน squad ตัวเอง + ต้องเป็น pending-import หรือ flaggedForDeletion
 * QA_MANAGER: ลบได้เฉพาะงานที่ flaggedForDeletion เท่านั้น
 * QA_ENGINEER: ลบไม่ได้เลย
 */
export function canDeleteTask(user: SessionUser, task: DeletableTask): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "QA_LEAD") {
    if (!task.squadId || user.squadId !== task.squadId) return false;
    const isPendingImport = task.source === "IMPORTED" && task.pulledIntoBoardAt === null;
    return isPendingImport || task.flaggedForDeletion;
  }
  if (user.role === "QA_MANAGER") return task.flaggedForDeletion;
  return false;
}

/**
 * Bulk select checkbox eligibility (ปลอดภัยกว่า canDeleteTask — ใช้สำหรับ checkbox ใน tasks list)
 * แม้ ADMIN ก็ bulk-select ได้เฉพาะ pending-import หรือ flagged เท่านั้น
 * กันเผลอลบงานที่กำลังใช้งานอยู่เป็นชุดใหญ่
 */
export function canBulkSelectForDelete(user: SessionUser, task: DeletableTask): boolean {
  if (user.role === "QA_ENGINEER") return false;
  const isPendingImport = task.source === "IMPORTED" && task.pulledIntoBoardAt === null;
  const isFlagged = task.flaggedForDeletion;
  if (!isPendingImport && !isFlagged) return false;
  if (user.role === "ADMIN") return true;
  if (user.role === "QA_LEAD") return !!task.squadId && user.squadId === task.squadId;
  if (user.role === "QA_MANAGER") return isFlagged;
  return false;
}

/** ลบ user (soft-delete): ADMIN เท่านั้น */
export function canDeleteUser(actor: SessionUser): boolean {
  return actor.role === "ADMIN";
}

// ─── Admin Panel ───────────────────────────────────────────────────────────────

/**
 * grayed-out-but-visible: QA_LEAD เห็นตัวเลือก ADMIN ใน dropdown แต่เลือกไม่ได้
 * ต้องเป็น ADMIN เท่านั้นที่ promote คนเป็น ADMIN ได้
 */
export function canAssignRole(
  actor: SessionUser,
  newRole: SessionUser["role"]
): boolean {
  if (actor.role === "ADMIN") return true;
  if (newRole === "ADMIN") return false;
  return actor.role === "QA_LEAD";
}

/**
 * ตั้งรหัสผ่านใหม่: กติกาเดียวกับ canAssignRole
 * ตั้งให้ ADMIN ได้เฉพาะ ADMIN ด้วยกัน (หรือตัวเอง)
 */
export function canResetPassword(
  actor: SessionUser,
  target: { id: string; role: SessionUser["role"] }
): boolean {
  if (actor.id === target.id) return true;
  if (actor.role === "ADMIN") return true;
  if (actor.role === "QA_LEAD") return target.role !== "ADMIN";
  return false;
}

// ─── Review Approval ──────────────────────────────────────────────────────────

/**
 * อนุมัติ review: ADMIN ทำได้ทุก squad, QA_LEAD ทำได้เฉพาะ squad ตัวเอง
 * Floating pool member review ได้ทุก squad (ไม่เช็ค squadId)
 * QA_MANAGER / QA_ENGINEER ทำไม่ได้
 */
export function canApproveReview(user: SessionUser, targetSquadId: string): boolean {
  if (user.role === "ADMIN") return true;
  if (user.isFloatingPoolMember) return true;
  if (user.role === "QA_LEAD") return user.squadId === targetSquadId;
  return false;
}

/**
 * Self-assign งานข้าม squad: เฉพาะ floating pool member เท่านั้น
 * QA_LEAD/QA_ENGINEER ปกติ assign ได้แค่ใน squad ตัวเอง
 */
export function canSelfAssignAcrossSquads(user: SessionUser): boolean {
  return user.isFloatingPoolMember === true;
}

/**
 * QA_ENGINEER ต้องรอ reviewApprovedAt ก่อนจึงจะย้ายงานเข้า Done ได้
 * ADMIN และ QA_LEAD ผ่านเสมอ
 */
export function canMoveTaskToDone(
  user: SessionUser,
  task: { reviewApprovedAt: Date | null }
): boolean {
  if (user.role === "ADMIN" || user.role === "QA_LEAD") return true;
  return task.reviewApprovedAt !== null;
}

// ─── Flag for Deletion ────────────────────────────────────────────────────────

/**
 * Flag/unflag งานให้ลบ: ADMIN ทำได้ทุก squad, QA_LEAD ทำได้เฉพาะ squad ตัวเอง
 * QA_MANAGER / QA_ENGINEER ทำไม่ได้ (QA_MANAGER กดลบได้หลัง flag แต่ flag เองไม่ได้)
 */
export function canFlagTaskForDeletion(user: SessionUser, targetSquadId: string | null): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "QA_LEAD") return !!targetSquadId && user.squadId === targetSquadId;
  return false;
}

// ─── Review State ─────────────────────────────────────────────────────────────

/** ตรวจว่า task ผ่าน review แล้วหรือยัง (ใช้แสดง indicator ฝั่ง UI) */
export function isReviewApproved(task: { reviewApprovedAt: Date | null }): boolean {
  return task.reviewApprovedAt !== null;
}

// ─── Task Content Edit ────────────────────────────────────────────────────────

export type EditableTask = {
  assigneeId: string | null;
  squadId: string | null;
};

/**
 * แก้ไข title/description ของ task: assignee เจ้าของงาน, ADMIN, QA_LEAD ของ squad นั้น,
 * floating pool member, หรือ QA_ENGINEER ใน squad เดียวกัน
 */
export function canEditTaskContent(user: SessionUser, task: EditableTask): boolean {
  if (user.role === 'ADMIN') return true;
  if (user.isFloatingPoolMember) return true;
  if (task.assigneeId === user.id) return true;
  if (user.role === 'QA_LEAD' && !!task.squadId && user.squadId === task.squadId) return true;
  if (user.role === 'QA_ENGINEER' && !!task.squadId && user.squadId === task.squadId) return true;
  return false;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** QA_LEAD และ QA_ENGINEER บังคับผูก squad, ADMIN และ QA_MANAGER ไม่บังคับ */
export function isSquadRequiredForRole(role: SessionUser["role"]): boolean {
  return role === "QA_LEAD" || role === "QA_ENGINEER";
}

/** ใครเปิด/ปิด Sprint ได้: ADMIN (ทุก squad), floating-pool member, QA_LEAD (เฉพาะ squad ตัวเอง) */
export function canManageSprint(user: SessionUser, targetSquadId: string): boolean {
  if (user.role === 'ADMIN') return true;
  if (user.isFloatingPoolMember) return true;
  if (user.role === 'QA_LEAD') return user.squadId === targetSquadId;
  return false;
}

/**
 * ส่ง LINE standup/EOD (all-squads broadcast): ขยายจาก canManageSprint
 * เพิ่ม QA_MANAGER เพราะต้องส่งแจ้งเตือนได้แม้จะ view-only ทุกที่อื่น
 */
export function canSendLineBroadcast(user: SessionUser): boolean {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'QA_MANAGER') return true;
  if (user.isFloatingPoolMember) return true;
  if (user.role === 'QA_LEAD') return true;
  return false;
}
