// EmptyState: friendly placeholder for "nothing here yet" situations, such
// as an empty leaderboard, untrained analytics models, or a year with no pool.
import type { ReactNode } from "react";

interface Props {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-16 text-center">
      <span aria-hidden className="text-3xl text-accent/60">
        ✦
      </span>
      <h3 className="text-xl text-bone">{title}</h3>
      {children && <p className="max-w-md text-sm text-bone-dim">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
