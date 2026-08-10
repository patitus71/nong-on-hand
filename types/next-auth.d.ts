import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      username: string;
      role: 'ADMIN' | 'QA_LEAD' | 'QA_MANAGER' | 'QA_ENGINEER';
      squadId: string | null;
      isFloatingPoolMember: boolean;
    } & DefaultSession['user'];
  }
}
