import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditSquadBoard } from '@/lib/rbac';
import type { SessionUser } from '@/lib/rbac';
import { generateWeeklyReportMarkdown } from '@/lib/weeklyReport';

// POST /api/reports/weekly
// Body: { squadId, weekStart, weekEnd, retroId? }
// สิทธิ์: ADMIN ทุก squad, QA_LEAD เฉพาะ squad ตัวเอง, floating pool ทุก squad
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const user = session.user as SessionUser;

  const body = await req.json();
  const { squadId, weekStart: weekStartStr, weekEnd: weekEndStr, retroId } = body;

  if (!squadId || !weekStartStr || !weekEndStr) {
    return new NextResponse('squadId, weekStart, weekEnd จำเป็นต้องระบุ', { status: 400 });
  }

  if (!canEditSquadBoard(user, squadId)) {
    return new NextResponse('ไม่มีสิทธิ์สร้างรายงานสำหรับ squad นี้', { status: 403 });
  }

  const weekStart = new Date(weekStartStr);
  const weekEnd   = new Date(weekEndStr);

  const retroSelect = {
    id:    true,
    title: true,
    items: {
      select: {
        category: true,
        content:  true,
        votes:    { select: { id: true } },
      },
    },
  } as const;

  const [squad, completedTasks, issueLogs, deletedTasks, retro] = await Promise.all([
    prisma.squad.findUnique({ where: { id: squadId }, select: { name: true } }),

    prisma.task.findMany({
      where: {
        squadId,
        deletedAt:   null,
        completedAt: { gte: weekStart, lte: weekEnd },
      },
      select: {
        id:             true,
        title:          true,
        estimatedHours: true,
        completedAt:    true,
        assignee:       { select: { name: true } },
      },
      orderBy: { completedAt: 'asc' },
    }),

    prisma.taskIssueLog.findMany({
      where: {
        task:      { squadId },
        flaggedAt: { gte: weekStart, lte: weekEnd },
      },
      select: {
        issueNote:      true,
        resolutionNote: true,
        flaggedAt:      true,
        resolvedAt:     true,
        task:      { select: { id: true, title: true } },
        flaggedBy: { select: { name: true } },
      },
      orderBy: { flaggedAt: 'asc' },
    }),

    prisma.task.findMany({
      where: {
        squadId,
        deletedAt: { gte: weekStart, lte: weekEnd },
      },
      select: {
        id:               true,
        title:            true,
        deletedAt:        true,
        deletionFlagNote: true,
      },
      orderBy: { deletedAt: 'asc' },
    }),

    retroId
      ? prisma.retro.findUnique({ where: { id: retroId }, select: retroSelect })
      : prisma.retro.findFirst({
          where: {
            squadId,
            OR: [
              { createdAt: { gte: weekStart, lte: weekEnd } },
              { closedAt:  { gte: weekStart, lte: weekEnd } },
            ],
          },
          select:  retroSelect,
          orderBy: { createdAt: 'desc' },
        }),
  ]);

  if (!squad) return new NextResponse('ไม่พบ squad', { status: 404 });

  const contentMarkdown = generateWeeklyReportMarkdown({
    squad,
    weekStart,
    weekEnd,
    completedTasks: completedTasks.map(t => ({
      ...t,
      completedAt: t.completedAt!,
    })),
    issueLogs,
    deletedTasks: deletedTasks.map(t => ({
      ...t,
      deletedAt: t.deletedAt!,
    })),
    retro: retro
      ? {
          title: retro.title,
          items: retro.items.map(i => ({
            category:  i.category as 'WENT_WELL' | 'TO_IMPROVE' | 'ACTION_ITEM',
            content:   i.content,
            voteCount: i.votes.length,
          })),
        }
      : null,
  });

  const record = await prisma.weeklyReport.create({
    data: {
      squadId,
      weekStart,
      weekEnd,
      generatedById:  user.id,
      contentMarkdown,
      retroId:        retro?.id ?? null,
    },
  });

  return NextResponse.json({ id: record.id, contentMarkdown });
}
