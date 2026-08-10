-- Performance indexes: every FK used in WHERE had no index (full sequential scan)

CREATE INDEX "Squad_isFloatingPool_idx" ON "Squad"("isFloatingPool");

CREATE INDEX "User_squadId_active_idx" ON "User"("squadId", "active");
CREATE INDEX "User_role_squadId_active_idx" ON "User"("role", "squadId", "active");

CREATE INDEX "Board_ownerId_type_idx" ON "Board"("ownerId", "type");

CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");
CREATE INDEX "Task_squadId_deletedAt_idx" ON "Task"("squadId", "deletedAt");
CREATE INDEX "Task_assigneeId_deletedAt_idx" ON "Task"("assigneeId", "deletedAt");
CREATE INDEX "Task_laneId_idx" ON "Task"("laneId");
CREATE INDEX "Task_flaggedForDeletion_idx" ON "Task"("flaggedForDeletion");

CREATE INDEX "RetroVote_userId_idx" ON "RetroVote"("userId");

CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

CREATE INDEX "TimeLog_taskId_idx" ON "TimeLog"("taskId");
CREATE INDEX "TimeLog_userId_idx" ON "TimeLog"("userId");
