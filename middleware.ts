// middleware.ts
// Guard route ระดับ Next.js middleware
// - /admin* ต้องเป็น ADMIN หรือ QA_LEAD เท่านั้น
// - route อื่นๆ ที่ผ่าน matcher นี้ ต้องมี token ที่ valid (login แล้ว)
//
// หมายเหตุสำคัญ: middleware เป็นแค่ด่านแรก (UX) ไม่ใช่ด่านความปลอดภัยเดียว —
// ทุก API route ภายใต้ /api/admin/** ต้องเช็ค role ซ้ำฝั่ง server อีกที (ดู lib/rbac.ts)
// เพราะ middleware อ่าน token จาก cookie ซึ่งพอจะปลอมหรือเลี่ยงได้ในบาง edge case

import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const isAdminRoute = req.nextUrl.pathname.startsWith("/admin");

    if (isAdminRoute) {
      const role = token?.role as string | undefined;
      if (role !== "ADMIN") {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      // ต้อง login (มี token) ก่อนถึงจะเข้า middleware function ด้านบนได้
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
    },
  }
);

export const config = {
  // ปรับ path ตามหน้าที่ต้องการ login ก่อนเข้า (เว้น /login, /api/auth, static assets)
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
