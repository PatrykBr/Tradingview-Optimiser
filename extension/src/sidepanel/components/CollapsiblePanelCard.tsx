import type { ReactNode } from 'react';

interface CollapsiblePanelCardProps {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
}

export default function CollapsiblePanelCard({
  open,
  onToggle,
  icon,
  title,
  summary,
  children,
}: Readonly<CollapsiblePanelCardProps>) {
  return (
    <div className="panel-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="panel-card-header flex w-full items-center justify-between gap-3 text-left hover:bg-bg-hover/35"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="panel-card-icon flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
          <span className="panel-card-title truncate">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {summary ? <span className="text-[11px] text-text-muted">{summary}</span> : null}
          <svg
            className={`h-4 w-4 text-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
