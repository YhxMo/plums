export function Skeleton() {
  return (
    <div className="skeleton-page" role="status" aria-label="正在读取工作台…">
      <span className="skeleton skeleton-title" />
      <div className="agent-grid" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div className="skeleton skeleton-card" key={i} />
        ))}
      </div>
      <span className="sr-only">正在读取工作台…</span>
    </div>
  );
}
