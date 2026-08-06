export default function TasksLoading() {
  return (
    <div className="max-w-[1180px] mx-auto px-7 py-6 pb-16">
      {/* Header skeleton */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="h-6 w-32 bg-surface-2 rounded-md animate-pulse mb-1" />
          <div className="h-4 w-52 bg-surface-2 rounded-md animate-pulse" />
        </div>
        <div className="h-9 w-28 bg-surface-2 rounded-md animate-pulse" />
      </div>

      {/* Stats skeleton */}
      <div className="flex gap-2.5 mb-5">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-surface-1 border border-app-border rounded-[10px] px-4 py-3 min-w-[110px]">
            <div className="h-6 w-8 bg-surface-2 rounded animate-pulse mb-1" />
            <div className="h-3.5 w-16 bg-surface-2 rounded animate-pulse" />
          </div>
        ))}
      </div>

      {/* Toolbar skeleton */}
      <div className="flex items-center gap-2 mb-3">
        {[220, 120, 120, 120].map((w, i) => (
          <div key={i} style={{ width: w }} className="h-9 bg-surface-2 rounded-md animate-pulse" />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="w-full bg-surface-1 border border-app-border rounded-[10px] overflow-hidden">
        <div className="h-10 border-b border-app-border bg-surface-1 animate-pulse" />
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-app-border last:border-none">
            <div className="w-4 h-4 bg-surface-2 rounded animate-pulse" />
            <div className="flex-1 h-4 bg-surface-2 rounded animate-pulse" />
            <div className="w-16 h-4 bg-surface-2 rounded animate-pulse" />
            <div className="w-20 h-4 bg-surface-2 rounded animate-pulse" />
            <div className="w-20 h-4 bg-surface-2 rounded animate-pulse" />
            <div className="w-16 h-4 bg-surface-2 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
