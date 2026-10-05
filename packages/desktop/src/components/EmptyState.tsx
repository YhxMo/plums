import type { ReactNode } from "react";
export function EmptyState({
  title,
  description,
  action,
  illustration = "agent",
}: {
  title?: string;
  description: string;
  action?: ReactNode;
  illustration?: "agent" | "components" | "search" | "settings" | "error";
}) {
  return (
    <div className={`empty-state ${illustration}`}>
      <svg
        className="block-illustration"
        width="160"
        height="126"
        viewBox="0 0 160 126"
        fill="none"
        aria-hidden="true"
      >
        <ellipse
          cx="80"
          cy="116"
          rx="51"
          ry="5"
          fill="currentColor"
          opacity=".08"
        />
        <g stroke="var(--line-strong)" strokeWidth="2">
          <rect
            x="23"
            y="69"
            width="112"
            height="39"
            rx="10"
            fill="var(--sky-300)"
            transform="rotate(-2 80 88)"
          />
          <rect
            x="38"
            y="40"
            width="93"
            height="38"
            rx="10"
            fill="var(--mint-300)"
            transform="rotate(3 80 58)"
          />
          <rect
            x="48"
            y="13"
            width="65"
            height="37"
            rx="10"
            fill="var(--peach-300)"
            transform="rotate(-4 80 31)"
          />
          <path
            d="M64 27h9m12 0h9m-38 27h10m16 0h10m16 0h10m-73 30h12m17 0h12m17 0h12"
            strokeLinecap="round"
          />
        </g>
      </svg>
      {title && <h2>{title}</h2>}
      <p>{description}</p>
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
