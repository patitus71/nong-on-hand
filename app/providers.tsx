'use client';
import { SessionProvider } from 'next-auth/react';
import PopstateRefresh from './PopstateRefresh';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PopstateRefresh />
      {children}
    </SessionProvider>
  );
}
