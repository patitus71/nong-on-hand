-- Jira import fields: ticket number/url/status captured from "Import จาก Jira JSON" — status is reference-only, no lane effect
ALTER TABLE "Task" ADD COLUMN "jiraTicketNo" TEXT;
ALTER TABLE "Task" ADD COLUMN "jiraUrl" TEXT;
ALTER TABLE "Task" ADD COLUMN "jiraStatus" TEXT;
