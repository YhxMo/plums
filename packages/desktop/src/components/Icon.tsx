import type { ReactNode } from "react";
const paths = {
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  plum: (
    <>
      <path d="M12 6c-5-3-9 1-9 6s4 9 9 9 9-4 9-9-4-9-9-6Z" />
      <path d="M12 7c0-4 3-5 6-5-1 3-3 4-6 5Z" />
    </>
  ),
  agent: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="5" />
      <path d="M12 6V3M8 11v2m8-2v2m-7 3h6" />
    </>
  ),
  character: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </>
  ),
  extension: (
    <path d="M9 3H4v6h2a2 2 0 1 1 0 4H4v7h7v-2a2 2 0 1 1 4 0v2h5v-7h-2a2 2 0 1 1 0-4h2V3h-7v2a2 2 0 1 1-4 0V3Z" />
  ),
  connector: (
    <>
      <path d="m9 15-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0m-3-3 8-8" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1v4l3 1 1 3 3 2 3-2 1-3 3-1V7l-3-1-1-3Z" />
      <circle cx="12" cy="9" r="3" />
      <path d="M12 17v4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  back: <path d="m11 5-7 7 7 7M4 12h16" />,
  next: <path d="m13 5 7 7-7 7M4 12h16" />,
  down: <path d="m5 9 7 7 7-7" />,
  check: <path d="m5 12 4 4L19 6" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v13m-5-5 5 5 5-5M4 16v4h16v-4" />
    </>
  ),
  folder: <path d="M3 7V4h6l3 3h9v13H3V7Z" />,
  play: <path d="m7 4 14 8-14 8V4Z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  edit: (
    <>
      <path d="m4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5l8-3Z" />
      <path d="m8 11 3 3 5-5" />
    </>
  ),
  warning: (
    <>
      <path d="m12 3 10 18H2L12 3Z" />
      <path d="M12 9v5m0 3v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  loader: (
    <>
      <path d="M20 12a8 8 0 1 1-4-7M20 4v5h-5" />
    </>
  ),
  moon: <path d="M21 14A9 9 0 0 1 10 3a9 9 0 1 0 11 11Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  label,
}: {
  name: IconName;
  size?: number;
  label?: string;
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
