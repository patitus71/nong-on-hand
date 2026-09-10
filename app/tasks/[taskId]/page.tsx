import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import Topbar from '@/components/Topbar';
import TaskDetailClient from './TaskDetailClient';

export default async function TaskDetailPage({ params }: { params: { taskId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const user = session.user as any;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    include: {
      squad:    { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      lane:     { select: { name: true } },
      timeLogs: { orderBy: { startAt: 'desc' } },
      taskLogs: {
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true } } },
      },
      retroItems: {
        include: { retro: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
      },
      issueLogs: {
        include: {
          flaggedBy:  { select: { name: true } },
          resolvedBy: { select: { name: true } },
        },
        orderBy: { flaggedAt: 'desc' },
      },
    },
  });

  if (!task) notFound();

  const taskData = {
    id:          task.id,
    title:       task.title,
    description: task.description,
    hasIssue:    task.hasIssue,
    issueNote:   task.issueNote,
    source:      task.source as string,
    squad:       task.squad,
    assignee:    task.assignee,
    laneName:    task.lane?.name ?? null,
    timeLogs: task.timeLogs.map(l => ({
      normalMinutes: l.normalMinutes ?? 0,
      otMinutes:     l.otMinutes ?? 0,
      startAt:       l.startAt.toISOString(),
      endAt:         l.endAt?.toISOString() ?? '',
    })),
    taskLogs: task.taskLogs.map(l => ({
      id:        l.id,
      action:    l.action,
      detail:    l.detail,
      createdAt: l.createdAt.toISOString(),
      userName:  l.user.name,
    })),
    retroItems: task.retroItems.map(r => ({
      id:         r.id,
      category:   r.category as string,
      content:    r.content,
      retroId:    r.retro.id,
      retroTitle: r.retro.title,
      createdAt:  r.createdAt.toISOString(),
    })),
    issueLogs: task.issueLogs.map(l => ({
      id:             l.id,
      issueNote:      l.issueNote,
      flaggedByName:  l.flaggedBy.name,
      flaggedAt:      l.flaggedAt.toISOString(),
      resolutionNote: l.resolutionNote,
      resolvedByName: l.resolvedBy?.name ?? null,
      resolvedAt:     l.resolvedAt?.toISOString() ?? null,
    })),
  };

  return (
    <>
      <Topbar />
      <TaskDetailClient
        task={taskData}
        userId={user.id}
        userRole={user.role}
        userSquadId={user.squadId ?? null}
        isFloatingPoolMember={user.isFloatingPoolMember ?? false}
      />
    </>
  );
}
