'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Next.js's client-side Router Cache restores browser back/forward navigations
// straight from cache and ignores `staleTimes` in that path, so pages showing
// list/board data go stale after navigating away and back (e.g. add a task,
// open its detail page, press back — the new card is missing until a hard
// reload). Force a refetch of whatever route we land on after every
// popstate. The setTimeout defers past Next's own popstate handling so
// router.refresh() targets the page we navigated to, not the one we left.
//
// The refetch + re-render can take a couple seconds against a remote DB, and
// the page briefly shows the pre-refresh (stale) data during that window —
// confusing without a visible signal. startTransition marks router.refresh()
// as a pending transition so we can show a thin top-of-screen loading bar
// for exactly that window, same idea as GitHub/YouTube's page-load indicator.
export default function PopstateRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onPopState() {
      setTimeout(() => {
        startTransition(() => {
          router.refresh();
        });
      }, 0);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [router]);

  if (!isPending) return null;

  return (
    <>
      <style>{`
        @keyframes popstate-refresh-sweep {
          0%   { left: -33%; }
          100% { left: 100%; }
        }
      `}</style>
      <div className="fixed top-0 left-0 right-0 h-[3px] z-[9999] overflow-hidden pointer-events-none">
        <div
          className="absolute top-0 h-full w-1/3 bg-accent"
          style={{ animation: 'popstate-refresh-sweep 1s ease-in-out infinite' }}
        />
      </div>
    </>
  );
}
