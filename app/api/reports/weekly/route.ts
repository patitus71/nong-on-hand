import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canEditSquadBoard } from '@/lib/rbac';
import type { SessionUser } from '@/lib/rbac';
import {
  generateWeeklyReportMarkdown,
  buildDashboardRows,
  type DashboardData,
} from '@/lib/weeklyReport';

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

  // คำนวณสัปดาห์ก่อนหน้า (7 วัน)
  const prevWeekStart = new Date(weekStart); prevWeekStart.setDate(weekStart.getDate() - 7);
  const prevWeekEnd   = new Date(weekEnd);   prevWeekEnd.setDate(weekEnd.getDate() - 7);

  const completedSelect = {
    title:    true,
    squad:    { select: { name: true } },
    assignee: { select: { name: true } },
    timeLogs: {
      where:  { endAt: { not: null } },
      select: { normalMinutes: true, otMinutes: true },
    },
  } as const;

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

  const [
    squad,
    completedRaw,
    prevCompletedRaw,
    issueLogsRaw,
    deletedRaw,
    retro,
  ] = await Promise.all([
    prisma.squad.findUnique({ where: { id: squadId }, select: { name: true } }),

    // สัปดาห์นี้ — งานที่เสร็จ
    prisma.task.findMany({
      where: { squadId, deletedAt: null, completedAt: { gte: weekStart, lte: weekEnd } },
      select: { id: true, ...completedSelect },
      orderBy: { completedAt: 'asc' },
    }),

    // สัปดาห์ก่อน — สำหรับ dashboard comparison
    prisma.task.findMany({
      where: { squadId, deletedAt: null, completedAt: { gte: prevWeekStart, lte: prevWeekEnd } },
      select: completedSelect,
    }),

    // ปัญหาที่เจอสัปดาห์นี้
    prisma.taskIssueLog.findMany({
      where: { task: { squadId }, flaggedAt: { gte: weekStart, lte: weekEnd } },
      select: {
        issueNote:      true,
        resolutionNote: true,
        flaggedAt:      true,
        resolvedAt:     true,
        flaggedBy:      { select: { name: true } },
        task: {
          select: {
            title:    true,
            squad:    { select: { name: true } },
            assignee: { select: { name: true } },
            timeLogs: {
              where:  { endAt: { not: null } },
              select: { normalMinutes: true, otMinutes: true },
            },
          },
        },
      },
      orderBy: { flaggedAt: 'asc' },
    }),

    // ticket ที่ถูกลบสัปดาห์นี้
    prisma.task.findMany({
      where: { squadId, deletedAt: { gte: weekStart, lte: weekEnd } },
      select: {
        id:               true,
        title:            true,
        deletedAt:        true,
        deletionFlagNote: true,
        squad:            { select: { name: true } },
        deletedBy:        { select: { name: true, role: true } },
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

  // แปลงข้อมูล
  const completedTasks = completedRaw.map(t => ({
    id:            t.id,
    title:         t.title,
    squadName:     t.squad?.name ?? '—',
    assigneeName:  t.assignee?.name ?? null,
    normalMinutes: t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0), 0),
    otMinutes:     t.timeLogs.reduce((s, l) => s + (l.otMinutes ?? 0), 0),
    completedAt:   new Date(),
  }));

  const prevCompleted = prevCompletedRaw.map(t => ({
    assigneeName:  t.assignee?.name ?? null,
    normalMinutes: t.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0), 0),
    otMinutes:     t.timeLogs.reduce((s, l) => s + (l.otMinutes ?? 0), 0),
  }));

  const dashboardRows = buildDashboardRows(
    completedTasks.map(t => ({ assigneeName: t.assigneeName, normalMinutes: t.normalMinutes, otMinutes: t.otMinutes })),
    prevCompleted,
  );

  const dashboard: DashboardData | null = dashboardRows.length > 0
    ? { rows: dashboardRows, hasPrevWeek: prevCompleted.length > 0 }
    : null;

  const issueLogs = issueLogsRaw.map(log => ({
    issueNote:      log.issueNote,
    resolutionNote: log.resolutionNote,
    flaggedAt:      log.flaggedAt,
    resolvedAt:     log.resolvedAt,
    taskTitle:      log.task.title,
    taskSquadName:  log.task.squad?.name ?? '—',
    assigneeName:   log.task.assignee?.name ?? null,
    normalMinutes:  log.task.timeLogs.reduce((s, l) => s + (l.normalMinutes ?? 0), 0),
    otMinutes:      log.task.timeLogs.reduce((s, l) => s + (l.otMinutes ?? 0), 0),
    flaggedByName:  log.flaggedBy.name,
  }));

  const deletedTasks = deletedRaw.map(t => ({
    id:               t.id,
    title:            t.title,
    squadName:        t.squad?.name ?? '—',
    deletedAt:        t.deletedAt!,
    deletionFlagNote: t.deletionFlagNote,
    deletedByName:    t.deletedBy?.name ?? null,
    deletedByRole:    t.deletedBy?.role ?? null,
  }));

  const contentMarkdown = generateWeeklyReportMarkdown({
    squadName: squad.name,
    weekStart,
    weekEnd,
    dashboard,
    completedTasks,
    issueLogs,
    deletedTasks,
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

  return NextResponse.json({ id: record.id, contentMarkdown, dashboard });
}
