import { cache } from 'react';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

// ใช้ React cache() เพื่อให้ทุก component ใน request เดียวกัน (page + Topbar)
// ได้ session object เดียวกันโดยไม่ต้อง decode JWT ซ้ำ
export const getSession = cache(() => getServerSession(authOptions));
