import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// ต้อง cache ทั้ง dev และ production — ใน serverless ถ้าไม่ cache จะสร้าง
// PrismaClient ใหม่ทุก warm invocation ทำให้ connection pool หมดเร็วมาก
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;
