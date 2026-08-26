// lib/auth.ts
// NextAuth config — CredentialsProvider + JWT strategy
// อ้างอิง pattern จาก qa-assist: role ฝังใน JWT, session หมดอายุถ้าไม่มี activity 30 นาที

import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    // ใช้ default ของ NextAuth (30 วัน) — เหมาะกับ internal tool ที่ไม่ต้องการ
    // บังคับ re-login บ่อยๆ ระหว่างวันทำงาน
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { username: credentials.username },
          include: { squad: { select: { isFloatingPool: true } } },
        });
        if (!user) return null;

        // account ที่ active=false (ปิดใช้งานจาก admin panel) ห้าม login
        if (!user.active) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          squadId: user.squadId,
          isFloatingPoolMember: user.squad?.isFloatingPool ?? false,
        } as any;
      },
    }),
  ],
  callbacks: {
    // ฝัง role + squadId ลง JWT ตอน sign in
    // refresh จาก DB ทุก 5 นาที เพื่อให้ isFloatingPoolMember / squadId / role เป็นปัจจุบัน
    // กรณีที่ admin เปลี่ยน squad ของ user กลางคัน ไม่ต้อง re-login
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.username = (user as any).username;
        token.role = (user as any).role;
        token.squadId = (user as any).squadId;
        token.isFloatingPoolMember = (user as any).isFloatingPoolMember ?? false;
        token.lastRefreshed = Date.now();
      } else if (token.id) {
        const now = Date.now();
        const lastRefreshed = (token.lastRefreshed as number | undefined) ?? 0;
        if (now - lastRefreshed > 5 * 60 * 1000) {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, squadId: true, squad: { select: { isFloatingPool: true } } },
          });
          if (dbUser) {
            token.role = dbUser.role;
            token.squadId = dbUser.squadId;
            token.isFloatingPoolMember = dbUser.squad?.isFloatingPool ?? false;
          }
          token.lastRefreshed = now;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).username = token.username;
        (session.user as any).role = token.role;
        (session.user as any).squadId = token.squadId;
        (session.user as any).isFloatingPoolMember = token.isFloatingPoolMember ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
