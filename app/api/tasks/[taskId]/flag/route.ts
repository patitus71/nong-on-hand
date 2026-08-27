import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { ensurePersonalCancelLane } from '@/lib/personalBoard';

export async function PATCH(req: Request, { params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const user = session.user as any;

  const { hasIssue, issueNote, resolutionNote, destination } = await req.json();

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true, squadId: true, laneId: true, assigneeId: true, isCancelled: true,
      lane: { select: { board: { select: { type: true, ownerId: true } } } },
    },
  });
  if (!task) return new Response('Not Found', { status: 404 });
  if (task.isCancelled) return new Response('งานนี้ถูกยกเลิกแล้ว แก้ไขต่อไม่ได้อีก', { status: 403 });

  if (hasIssue) {
    // Flagging: create a new TaskIssueLog entry
    const [updated] = await prisma.$transaction([
      prisma.task.update({
        where: { id: params.taskId },
        data: { hasIssue: true, issueNote: issueNote ?? null },
      }),
      prisma.taskIssueLog.create({
        data: {
          taskId:     params.taskId,
          issueNote:  issueNote ?? '',
          flaggedById: user.id,
        },
      }),
    ]);
    revalidatePath('/my-board');
    revalidatePath('/squads/[squadId]', 'page');
    return Response.json(updated);
  } else {
    // Resolving: find latest open log and close it; move task to target lane.
    // destination='todo' (default) → To Do lane (normal flow)
    // destination='done' → Done lane directly, bypass review requirement intentionally
    // destination='cancel' → Cancel lane บน personal board ของ assignee เสมอ (ไม่มี squad-side
    // Cancel lane) — hasIssue ยังคงเป็น true ต่อไป (ไม่ set false เหมือน 2 เคสข้างบน) เพื่อให้
    // Squad Board ยังจัดอยู่บัคเก็ต "มีปัญหา" ตามเดิม — นี่คือทางเดียวที่ set isCancelled ได้
    const resolveDestination: 'todo' | 'done' | 'cancel' =
      destination === 'done' ? 'done' : destination === 'cancel' ? 'cancel' : 'todo';

    // บังคับกรอกเหตุผลเสมอไม่ว่าจะเลือกปลายทางไหน — ห้ามพึ่ง client-side validation อย่างเดียว
    if (!resolutionNote || !resolutionNote.trim()) {
      return new Response('กรุณากรอกเหตุผลก่อนยืนยัน — ต้องมีเหตุผลเสมอ ห้ามเว้นว่าง', { status: 400 });
    }

    const openLog = await prisma.taskIssueLog.findFirst({
      where: { taskId: params.taskId, resolvedAt: null },
      orderBy: { flaggedAt: 'desc' },
    });

    let targetLaneId: string | null = null;
    if (resolveDestination === 'cancel') {
      const ownerId = task.assigneeId ?? user.id;
      targetLaneId = await ensurePersonalCancelLane(ownerId);
    } else if (resolveDestination === 'done') {
      // Done lane: bypass review check — resolutionNote serves as evidence
      if (task.squadId) {
        const lane = await prisma.lane.findFirst({
          where: { name: 'Done', board: { type: 'SQUAD', owner: { squadId: task.squadId } } },
          select: { id: true },
        });
        targetLaneId = lane?.id ?? null;
      } else {
        const ownerId = task.assigneeId ?? user.id;
        const lane = await prisma.lane.findFirst({
          where: { name: 'Done', board: { type: 'PERSONAL', ownerId } },
          select: { id: true },
        });
        targetLaneId = lane?.id ?? null;
      }
    } else {
      // Default: return to To Do lane
      if (task.squadId) {
        const lane = await prisma.lane.findFirst({
          where: { name: 'To do', board: { type: 'SQUAD', owner: { squadId: task.squadId } } },
          select: { id: true },
        });
        targetLaneId = lane?.id ?? null;
      } else {
        const ownerId = task.assigneeId ?? user.id;
        const lane = await prisma.lane.findFirst({
          where: { name: 'To Do', board: { type: 'PERSONAL', ownerId } },
          select: { id: true },
        });
        targetLaneId = lane?.id ?? null;
      }
    }

    const ops: any[] = [
      prisma.task.update({
        where: { id: params.taskId },
        data: {
          ...(resolveDestination === 'cancel'
            ? { isCancelled: true, cancelNote: resolutionNote.trim() } // hasIssue/issueNote คงเดิม
            : { hasIssue: false, issueNote: null }),
          ...(targetLaneId ? { laneId: targetLaneId } : {}),
        },
      }),
    ];

    if (openLog) {
      ops.push(
        prisma.taskIssueLog.update({
          where: { id: openLog.id },
          data: {
            resolutionNote: resolutionNote.trim(),
            resolvedById:   user.id,
            resolvedAt:     new Date(),
          },
        }),
      );
    }

    const [updated] = await prisma.$transaction(ops);
    revalidatePath('/my-board');
    revalidatePath('/squads/[squadId]', 'page');
    return Response.json(updated);
  }
}
