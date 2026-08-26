export default function AdminLoading() {
  return (
    <div className="px-7 py-6 pb-16">
      {/* Page title */}
      <div className="h-6 w-28 bg-surface-2 rounded-md animate-pulse mb-1" />
      <div className="h-4 w-44 bg-surface-2 rounded-md animate-pulse mb-5" />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-app-border pb-0">
        <div className="h-9 w-16 bg-surface-2 rounded-t-lg animate-pulse" />
        <div className="h-9 w-20 bg-surface-2 rounded-t-lg animate-pulse" />
      </div>

      {/* Table */}
      <div className="overflow-hidden border border-app-border rounded-[10px]">
        <div className="h-10 border-b border-app-border bg-surface-1 animate-pulse" />
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-app-border last:border-none">
            <div className="flex items-center gap-2 flex-1">
              <div className="w-6 h-6 rounded-full bg-surface-2 animate-pulse" />
              <div className="h-4 w-28 bg-surface-2 rounded animate-pulse" />
            </div>
            <div className="h-8 w-24 bg-surface-2 rounded-md animate-pulse" />
            <div className="h-8 w-24 bg-surface-2 rounded-md animate-pulse" />
            <div className="h-5 w-9 bg-surface-2 rounded-full animate-pulse" />
            <div className="h-8 w-28 bg-surface-2 rounded-md animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
