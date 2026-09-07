// Chip: small pill for genres, archetypes and status labels.
import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "win" | "loss";

const TONES: Record<Tone, string> = {
  neutral: "border-line text-bone-dim",
  accent: "border-accent/50 bg-accent/10 text-accent",
  win: "border-win/50 bg-win/10 text-win",
  loss: "border-loss/50 bg-loss/10 text-loss",
};

export function Chip({ tone = "neutral", children, className = "", title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
