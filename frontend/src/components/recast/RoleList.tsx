// RoleList: the film's cast, top-billed first, as the round works down it.
//
// Sits under src/components/recast/, beside the shortlist. It is the only
// place the whole shape of a round is visible at once, and it shows three
// states in one column:
//
//   cast      the part is filled — the original name struck through and the
//             replacement under it, so the recast reads as a substitution
//             rather than as a list of names;
//   casting   the part being decided now, ringed in gold and announced with
//             `aria-current` so a screen reader lands on it too;
//   waiting   still to come, muted, but still legible: knowing that a
//             supporting part is next is information a player uses when
//             deciding how much of their shortlist to spend now.
//
// Lead and supporting parts are told apart deliberately and twice over — a
// chip that says which it is, and a larger serif name for the leads. That is
// not decoration: `role_fit` is thirty per cent of the score and it is judged
// against the *part*, so a player who cannot see at a glance which parts are
// leads cannot see what they are being scored on.

import type { CastingPick, RoleCard } from "../../api/types";
import { Chip } from "../ui/Chip";

interface Props {
  roles: RoleCard[];
  picks: CastingPick[];
  /** Index into `roles` of the part being cast; `roles.length` when done. */
  currentRole: number;
}

export function RoleList({ roles, picks, currentRole }: Props) {
  return (
    <section aria-labelledby="recast-roles" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recast-roles" className="text-lg">
          The cast
        </h2>
        <p className="text-xs text-ivory-dim">
          <span className="tabular-nums text-ivory">
            {picks.length} of {roles.length}
          </span>{" "}
          recast
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {roles.map((role, index) => (
          <li key={role.billing}>
            <RoleRow
              role={role}
              // `picks` is filled in billing order, so a role's pick is at its
              // own index — there is no id to match on and none is needed.
              pick={picks[index] ?? null}
              state={index < currentRole ? "cast" : index === currentRole ? "casting" : "waiting"}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

type RowState = "cast" | "casting" | "waiting";

const ROW_STYLES: Record<RowState, string> = {
  cast: "border-line bg-ink-2/60",
  casting: "border-gold bg-gold/5 shadow-glow",
  waiting: "border-dashed border-line bg-transparent opacity-70",
};

function RoleRow({
  role,
  pick,
  state,
}: {
  role: RoleCard;
  pick: CastingPick | null;
  state: RowState;
}) {
  return (
    <article
      // Only the row being decided is "current", which is what lets a screen
      // reader jump to the part the shortlist belongs to.
      aria-current={state === "casting" ? "step" : undefined}
      className={`flex flex-col gap-1.5 rounded-lg border p-3 transition-colors ${ROW_STYLES[state]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted">
            <span className="tabular-nums">#{role.billing}</span> billed
          </p>
          <h3
            className={`truncate leading-tight text-ivory ${role.is_lead ? "text-lg" : "text-base"}`}
            title={role.character ?? undefined}
          >
            {role.character ?? "Uncredited part"}
          </h3>
        </div>
        <Chip tone={role.is_lead ? "gold" : "neutral"}>{role.is_lead ? "Lead" : "Supporting"}</Chip>
      </div>

      {/* The original is always named. It is the anchor for stature and era,
          and half of what makes a replacement interesting to look at. */}
      <p className="truncate text-xs">
        <span className="text-muted">Originally </span>
        <span className={pick ? "text-muted line-through" : "text-ivory-dim"}>
          {role.original.name}
        </span>
      </p>

      {pick ? (
        <p className="truncate text-sm text-gold" title={pick.replacement.name}>
          <span aria-hidden className="mr-1 text-muted">
            →
          </span>
          {pick.replacement.name}
        </p>
      ) : state === "casting" ? (
        <p className="text-xs uppercase tracking-[0.2em] text-gold">Casting now</p>
      ) : (
        <p className="text-xs text-muted">Still to cast</p>
      )}
    </article>
  );
}
