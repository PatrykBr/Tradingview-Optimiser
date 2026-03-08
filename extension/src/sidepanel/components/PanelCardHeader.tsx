import type { ReactNode } from 'react';

interface PanelCardHeaderProps {
  title: string;
  icon: ReactNode;
  right?: ReactNode;
  className?: string;
}

function joinClasses(...classes: Array<string | undefined>): string {
  return classes.filter((value): value is string => Boolean(value)).join(' ');
}

export default function PanelCardHeader({ title, icon, right, className }: PanelCardHeaderProps) {
  return (
    <div
      className={joinClasses(
        'panel-card-header',
        right ? 'flex items-center justify-between gap-2.5' : undefined,
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="panel-card-icon flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
        <h2 className="panel-card-title truncate">{title}</h2>
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}
