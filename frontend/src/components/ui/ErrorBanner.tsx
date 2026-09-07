// ErrorBanner: inline error surface with an optional retry action.
// Used for page-level failures (the toast handles transient action errors).
import { Button } from "./Button";

interface Props {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ message, onRetry, className = "" }: Props) {
  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-lg border border-loss/40 bg-loss/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <p className="text-bone">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
