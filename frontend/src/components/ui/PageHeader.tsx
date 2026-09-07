// PageHeader: eyebrow + serif title + optional lede, used at the top of
// every secondary page so they share one rhythm.
import type { ReactNode } from "react";

interface Props {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, lede, actions }: Props) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-2 text-xs uppercase tracking-[0.25em] text-accent">{eyebrow}</p>}
        <h1 className="text-3xl leading-tight sm:text-4xl">{title}</h1>
        {lede && <p className="mt-2 max-w-2xl text-sm text-bone-dim">{lede}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
