import type { ReactNode } from "react";

// Icones de traco (24x24, currentColor) escritos a mao: a interface nao usa emoji.
const PATHS: Record<string, ReactNode> = {
  pedido: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5v-7z" />,
  agent: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="3" />
      <path d="M12 8V4.5M9.5 13h.01M14.5 13h.01M9.5 16.2h5" />
      <circle cx="12" cy="3.8" r="1" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M7.5 10l3 2.2-3 2.2M12.5 14.8h4" />
    </>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17l3 3 5.5-5.5a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.6-.6-.6-2.6 2.6-2.6z" />,
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 7v10M18 11c0 4-6 3-12 6" />
    </>
  ),
  flag: <path d="M6 21V4M6 5h11l-2 3.5 2 3.5H6" />,
  note: (
    <>
      <path d="M5 4.5h10.5L19 8v11.5H5z" />
      <path d="M15 4.5V8h4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </>
  ),
  bell: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15l1.5-2zM10 20.5a2 2 0 0 0 4 0" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M7 4.5v15l12-7.5-12-7.5z" />,
  flask: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3M8 15h8" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  alert: <path d="M12 4l9 16H3L12 4zM12 10v4M12 17.3v.4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  canvas: (
    <>
      <rect x="3" y="4" width="6.5" height="5" rx="1.6" />
      <rect x="3" y="15" width="6.5" height="5" rx="1.6" />
      <rect x="14.5" y="9.5" width="6.5" height="5" rx="1.6" />
      <path d="M9.5 6.5h2a3 3 0 0 1 3 3M9.5 17.5h2a3 3 0 0 0 3-3" />
    </>
  ),
  chevron: <path d="M8 10l4 4 4-4" />,
  trash: <path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13" />,
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.7" />
      <path d="M5 6v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6M5 12v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6" />
    </>
  ),
  record: (
    <>
      <path d="M6 4.5h9l3 3V19.5H6z" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  layout: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M9.5 9.5V20" />
    </>
  ),
  library: (
    <>
      <path d="M4.5 5v14M9.5 5v14" />
      <path d="M14 6.5l4.8-1.3 3 12.6-4.8 1.3z" />
    </>
  ),
  puzzle: <path d="M10 4.5a2 2 0 1 1 4 0V7h3.5v3.5H20a2 2 0 1 1 0 4h-2.5V19H14v-2.5a2 2 0 1 0-4 0V19H6.5v-4.5H9a2 2 0 1 0 0-4H6.5V7H10V4.5z" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7.5" height="9" rx="2" />
      <rect x="13" y="3.5" width="7.5" height="5" rx="2" />
      <rect x="13" y="11" width="7.5" height="9.5" rx="2" />
      <rect x="3.5" y="15" width="7.5" height="5.5" rx="2" />
    </>
  ),
  page: (
    <>
      <path d="M6 3.5h8l4 4V20.5H6z" />
      <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
    </>
  ),
};

export default function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name] ?? null}
    </svg>
  );
}

export const NODE_ICON: Record<string, string> = {
  "input.prompt": "pedido",
  "agent.llm": "agent",
  "agent.claude": "terminal",
  "tool.call": "wrench",
  "data.records": "database",
  "action.record": "record",
  "action.notify": "bell",
  "ui.block": "layout",
  "logic.if": "branch",
  "output.result": "flag",
  note: "note",
};
