-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "standupAutoSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "standupSendTime" TEXT,
    "eodAutoSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    "eodSendTime" TEXT,
    "lastStandupSentAt" TIMESTAMP(3),
    "lastEodSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_squadId_key" ON "NotificationSettings"("squadId");

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;
