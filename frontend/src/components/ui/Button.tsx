// Button: the one button style family for the app.
//
// `variant` picks a filled accent (primary CTA), an outlined one (secondary) or a
// quiet text button (ghost). `loading` swaps in a spinner and disables the
// control so double submits are impossible.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-ink hover:bg-accent-soft shadow-[0_0_24px_rgba(142,197,255,0.25)] disabled:shadow-none",
  secondary: "border border-accent/60 text-accent hover:bg-accent/10 hover:border-accent",
  ghost: "text-bone-dim hover:text-bone hover:bg-white/5",
  danger: "border border-loss/60 text-loss hover:bg-loss/10",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-wide",
        "transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:opacity-40",
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}
