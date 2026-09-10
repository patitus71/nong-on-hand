-- Review is opt-in only now, never mandatory — the per-task "requiresReview" override
-- (added in 20260827120000) is dead weight once nothing blocks In Progress → Done by
-- default. No code references this column anymore.
ALTER TABLE "Task" DROP COLUMN "requiresReview";
