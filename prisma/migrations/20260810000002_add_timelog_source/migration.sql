-- CreateEnum
CREATE TYPE "TimeLogSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable: make endAt/normalMinutes/otMinutes optional, add source
ALTER TABLE "TimeLog"
  ALTER COLUMN "endAt" DROP NOT NULL,
  ALTER COLUMN "normalMinutes" DROP NOT NULL,
  ALTER COLUMN "otMinutes" DROP NOT NULL,
  ADD COLUMN "source" "TimeLogSource" NOT NULL DEFAULT 'AUTO';
