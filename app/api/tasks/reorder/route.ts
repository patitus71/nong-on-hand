import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { SessionUser } from '@/lib/rbac';
import { shouldResetReviewApproval } from '@/lib/importTasks';
import { sendLineGroupMessageWithMention, MentionContext } from '@/lib/lineNotify';

// Personal lane name → squad lane name for tasks that belong to a squad.
// 'Review' is intentionally absent: tasks in personal Review lane keep the personal laneId
// so the Squad Board can derive 'Wait for review' status from lane.name === 'Review'.
const PERSONAL_TO_SQUAD: Record<string, string> = {
  'To Do':      'To do',
  'In Progress': 'In progress',
  'Done':       'Done',
};

// Batch-reorder tasks across one or more lanes in one transaction.
// Body: { items: { id, laneId, order }[] }
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const { items } = await req.json() as {
    items: { id: string; laneId: string; order: number; reviewerId?: string | null }[];
  };
  if (!Array.isArray(items) || items.length === 0) {
    return new Response('items required', { status: 400 });
  }

  const taskIds       = items.map(i => i.id);
  const targetLaneIds = Array.from(new Set(items.map(i => i.laneId)));

  // Fetch tasks — include current laneId and reviewApprovedAt for guards
  const tasksRaw = await prisma.task.findMany({
    where:  { id: { in: taskIds } },
    select: {
      id: true, squadId: true, laneId: true, reviewApprovedAt: true, requiresReview: true, isCancelled: true,
      reviewerId: true, title: true, prLink: true, assigneeId: true,
    },
  });
  const taskById = new Map(tasksRaw.map(t => [t.id, t]));

  // Fetch all lane IDs we need: targets + current task lanes
  const currentLaneIds = tasksRaw.filter(t => t.laneId).map(t => t.laneId!);
  const allLaneIds = Array.from(new Set([...targetLaneIds, ...currentLaneIds]));

  const lanesRaw = await prisma.lane.findMany({
    where:  { id: { in: allLaneIds } },
    select: { id: true, name: true, board: { select: { type: true } } },
  });
  const laneById = new Map(lanesRaw.map(l => [l.id, l]));

  // Collect which (squadId, squadLaneName) pairs we need to resolve
  const needed = new Set<string>(); // `${squadId}:${squadLaneName}`
  for (const { id, laneId } of items) {
    const task = taskById.get(id);
    const lane = laneById.get(laneId);
    if (!task?.squadId || lane?.board.type !== 'PERSONAL') continue;
    const sqName = PERSONAL_TO_SQUAD[lane.name];
    if (sqName) needed.add(`${task.squadId}:${sqName}`);
  }

  // Fetch squad lanes in one query
  const squadLaneMap = new Map<string, string>(); // `${squadId}:${laneName}` → laneId
  if (needed.size > 0) {
    const uniqueSquadIds = Array.from(new Set(Array.from(needed).map(k => k.split(':')[0])));
    const squadLanes = await prisma.lane.findMany({
      where: {
        name:  { in: Object.values(PERSONAL_TO_SQUAD) },
        board: { type: 'SQUAD', owner: { squadId: { in: uniqueSquadIds } } },
      },
      select: {
        id:   true,
        name: true,
        board: { select: { owner: { select: { squadId: true } } } },
      },
    });
    for (const l of squadLanes) {
      const sqId = l.board.owner.squadId;
      if (sqId) squadLaneMap.set(`${sqId}:${l.name}`, l.id);
    }
  }

  // Resolve final laneId for each item and validate
  const approvalResets = new Set<string>(); // task IDs that need reviewApprovedAt cleared

  // หมายเหตุสำคัญ: saveOrder() ฝั่ง client ส่ง item ของ "ทุก task ทุกเลนบนบอร์ด" มาทุกครั้ง
  // (ต้องคำนวณ order ใหม่ให้ sibling ทั้งหมด) ไม่ใช่แค่ตัวที่ถูกลาก และสำหรับ squad task
  // ตัว client ส่ง personal-lane-id เสมอ (Task.laneId ที่ persist ไว้จริงอาจเป็น squad-lane-id
  // ถ้าอยู่ To Do/In Progress/Done — ดูคอมเมนต์ PERSONAL_TO_SQUAD ด้านบน) ดังนั้นต้องเทียบ
  // "laneId สุดท้ายหลัง resolve" กับ "laneId ที่ persist ไว้" เพื่อรู้ว่า task นี้ "ย้ายจริง"
  // ในรอบนี้ไหม — ห้ามใช้ newLaneName/oldLaneName string เทียบเฉยๆ เพราะ case ต่างกัน
  // (เช่น "In Progress" vs "In progress") จะทำให้เข้าใจผิดว่า "ย้าย" ทุกครั้งทั้งที่อยู่ตำแหน่งเดิม
  const resolved = items.map(({ id, laneId, order, reviewerId: itemReviewerId }) => {
    const task        = taskById.get(id);
    const targetLane  = laneById.get(laneId);
    const currentLane = task?.laneId ? laneById.get(task.laneId) : null;

    const oldLaneName = currentLane?.name ?? '';
    const newLaneName = targetLane?.name ?? '';

    let finalLaneId = laneId;
    if (task?.squadId && targetLane?.board.type === 'PERSONAL') {
      const sqName = PERSONAL_TO_SQUAD[newLaneName];
      if (sqName) {
        finalLaneId = squadLaneMap.get(`${task.squadId}:${sqName}`) ?? laneId;
      }
      // ไม่มี sqName (เช่น 'Review') — ไม่มี squad lane ให้ translate เก็บ personal laneId ไว้
    }

    const moved = finalLaneId !== task?.laneId;

    // เช็ค reset approval เฉพาะตอนย้ายจริง — ไม่งั้น task ที่ "ค้างอยู่ใน Review" (newLaneName
    // === 'Review' เสมอไม่ว่าจะย้ายจริงหรือไม่) จะโดน reset ทุกครั้งที่มีการลากการ์ดอื่นบนบอร์ด
    if (moved && shouldResetReviewApproval(oldLaneName, newLaneName)) {
      approvalResets.add(id);
    }

    return { id, laneId: finalLaneId, order, itemReviewerId, moved };
  });

  // Guard: เลน "Cancel" เข้าได้ทางเดียวผ่าน /api/tasks/[taskId]/flag (resolve-to-cancel)
  // เท่านั้น ห้ามลากเข้าตรงๆ ผ่าน endpoint นี้ และเป็น terminal state — task ที่ isCancelled
  // แล้วห้ามเปลี่ยน laneId อีกไม่ว่ากรณีใด ใช้กับทุก role ไม่ใช่แค่ QA_ENGINEER
  for (const { id, laneId: resolvedLaneId, moved } of resolved) {
    if (!moved) continue;
    const task = taskById.get(id);
    if (task?.isCancelled) {
      return new Response('งานนี้ถูกยกเลิกแล้ว ย้ายเลนต่อไม่ได้อีก', { status: 403 });
    }
    if (laneById.get(resolvedLaneId)?.name === 'Cancel') {
      return new Response('ย้ายเข้าเลน Cancel โดยตรงไม่ได้ — ต้องกด "จัดการปัญหานี้" แล้วเลือกปลายทาง Cancel เท่านั้น', { status: 403 });
    }
  }

  // Guard: QA_ENGINEER moving squad task to Done without review approval —
  // เช็คเฉพาะ task ที่ "กำลังจะย้ายเข้า Done ในรอบนี้จริงๆ" (moved === true) เท่านั้น ไม่งั้น
  // task เก่าที่ค้างอยู่ใน Done โดยไม่มี approval (เช่น ถูก QA_LEAD/ADMIN ย้ายเข้าตรงๆ) จะ
  // ทำให้ลากการ์ดอื่นบนบอร์ดไม่ได้เลยสักใบ เพราะ item ของมันติดมาด้วยทุกครั้ง
  //
  // requiresReview === false: งานแยกที่ไม่จำเป็นต้อง review — อนุญาตย้าย In Progress → Done
  // ตรงได้เลยโดยไม่ต้องผ่าน approval แต่ถ้าใครลากงานนี้เข้า Review lane เองก็ยังใช้ logic เดิม
  // ทุกอย่าง (approval reset, ต้อง QA_LEAD approve ก่อนออกจาก Review ตามปกติ) — flag นี้แค่ปลด
  // เงื่อนไข "ต้องผ่าน Review ก่อนถึงจะเข้า Done ได้" สำหรับงานที่ไม่จำเป็นต้อง review เท่านั้น
  if (user.role === 'QA_ENGINEER') {
    for (const { id, laneId: resolvedLaneId, moved } of resolved) {
      const task = taskById.get(id);
      if (!task?.squadId || !task.requiresReview || task.reviewApprovedAt || !moved) continue;
      const squadDoneLaneId = squadLaneMap.get(`${task.squadId}:Done`);
      if (squadDoneLaneId && squadDoneLaneId === resolvedLaneId) {
        return new Response('ต้องรอ QA_LEAD approve review ก่อนจึงจะย้ายงานไป Done ได้', { status: 403 });
      }
    }
  }

  await prisma.$transaction(
    resolved.map(({ id, laneId, order, itemReviewerId }) =>
      prisma.task.update({
        where: { id },
        data:  {
          laneId,
          order,
          ...(approvalResets.has(id) ? {
            reviewApprovedAt:   null,
            reviewApprovedById: null,
            reviewerId:         itemReviewerId !== undefined ? itemReviewerId : null,
          } : {}),
        },
      }),
    ),
  );

  // LINE notification — เฉพาะ task ที่ "ย้ายเข้า Review lane จริงในรอบนี้" และตั้ง reviewer
  // ใหม่จริง (ต่างจากค่าเดิม) เท่านั้น กัน reorder ทั้งบอร์ด (ทุก task ทุกเลนถูกส่งมาด้วยเสมอ)
  // ยิงแจ้งเตือนซ้ำให้ task อื่นที่บังเอิญค้างอยู่ใน Review lane
  const reviewRequests = resolved
    .filter(({ id, laneId, itemReviewerId, moved }) => {
      if (!moved || !itemReviewerId) return false;
      if (laneById.get(laneId)?.name !== 'Review') return false;
      const task = taskById.get(id);
      return itemReviewerId !== task?.reviewerId;
    })
    .map(({ id, itemReviewerId }) => ({ taskId: id, reviewerId: itemReviewerId! }));

  if (reviewRequests.length > 0) {
    void (async () => {
      for (const { taskId, reviewerId } of reviewRequests) {
        try {
          const task = taskById.get(taskId);
          if (!task?.squadId) continue;

          const [reviewer, squad, assignee] = await Promise.all([
            prisma.user.findUnique({
              where:  { id: reviewerId },
              select: { name: true, lineUserId: true, lineDisplayName: true },
            }),
            prisma.squad.findUnique({
              where:  { id: task.squadId },
              select: { name: true, lineGroupId: true },
            }),
            task.assigneeId
              ? prisma.user.findUnique({ where: { id: task.assigneeId }, select: { name: true } })
              : Promise.resolve(null),
          ]);

          if (!squad?.lineGroupId || !reviewer) continue;

          await prisma.notification.create({
            data: {
              userId:        reviewerId,
              message:       `งาน "${task.title}" ต้องการให้คุณ Review`,
              relatedTaskId: taskId,
            },
          });

          const ctx = new MentionContext();
          const mention = ctx.slot(reviewer.lineDisplayName ?? reviewer.name, reviewer.lineUserId);
          const text = [
            `🔍 ${mention} received a review request`,
            `Task: ${task.title}`,
            `Squad: ${squad.name}`,
            `Sent by: ${assignee?.name ?? session.user?.name ?? 'Unknown'}`,
            ...(task.prLink ? [`🔗 PR: ${task.prLink}`] : []),
          ].join('\n');
          const r = await sendLineGroupMessageWithMention(squad.lineGroupId, text, ctx);
          if (!r.success) console.error('[reorder] LINE review-request notification failed:', r.reason);
        } catch (err) {
          console.error('[reorder] LINE review-request notification error:', err);
        }
      }
    })();
  }

  revalidatePath('/my-board');
  revalidatePath('/squads/[squadId]', 'page');
  return Response.json({ ok: true });
}
