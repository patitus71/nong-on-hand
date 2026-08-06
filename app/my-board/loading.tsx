export default function MyBoardLoading() {
  return (
    <div className="max-w-[1400px] mx-auto px-7 py-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="h-7 w-32 bg-surface-2 rounded-md animate-pulse" />
        <div className="h-9 w-28 bg-surface-2 rounded-md animate-pulse" />
      </div>

      {/* Issue section placeholder */}
      <div className="bg-danger-bg border border-danger/30 rounded-xl p-3 mb-5 h-20 animate-pulse" />

      {/* Lanes */}
      <div className="flex gap-3.5">
        {['To Do', 'In Progress', 'Review', 'Done'].map(lane => (
          <div key={lane} className="bg-surface-1 border border-app-border rounded-[12px] w-[260px] flex-shrink-0 p-2.5">
            <div className="flex items-center gap-1.5 px-1 pb-2.5">
              <div className="h-4 w-20 bg-surface-2 rounded animate-pulse" />
            </div>
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-surface-2 border border-app-border rounded-lg p-2.5 mb-2 animate-pulse">
                <div className="h-4 w-full bg-surface-3 rounded mb-2" />
                <div className="h-3 w-12 bg-surface-3 rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
