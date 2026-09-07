// ShortlistPanel: the actors offered for the role being cast, and the act of
// casting one.
//
// Sits under src/components/recast/. It is the working half of the screen:
// the part being cast at the top, the note explaining where these names came
// from (CastingTypeNote), the cards themselves, and a confirm bar that
// appears once one is highlighted.
//
// Select-then-confirm, not click-to-cast. That is the Oscars mode's "Lock in"
// bar and it is here for the same reason: a casting cannot be taken back, the
// shortlist shrinks as the round goes on, and an irreversible decision should
// cost two deliberate actions rather than one stray click. The bar names the
// actor and the part in one sentence so the confirmation is about something
// specific.
//
// The server's refusal is rendered here, next to the cards, and it keeps the
// selection: "that actor is not on this role's shortlist" is a statement
// about the name that was chosen, so it belongs beside the names.

import type { ActorCard, RoleCard } from "../../api/types";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { ActorOption } from "./ActorOption";
import { CastingTypeNote } from "./CastingTypeNote";

interface Props {
  role: RoleCard;
  actors: ActorCard[];
  loading: boolean;
  /** True while the confirmed casting is being posted. */
  casting: boolean;
  selectedId: string | null;
  /** The server's refusal of the last attempt, if there was one. */
  error: string | null;
  onSelect: (personId: string | null) => void;
  onConfirm: () => void;
}

export function ShortlistPanel({
  role,
  actors,
  loading,
  casting,
  selectedId,
  error,
  onSelect,
  onConfirm,
}: Props) {
  const selected = actors.find((a) => a.person_id === selectedId) ?? null;
  const part = role.character ?? `the number ${role.billing} part`;

  return (
    <section aria-labelledby="recast-shortlist" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-[10px] uppercase tracking-[0.25em] text-gold">
          {role.is_lead ? "Casting a lead" : "Casting a supporting part"}
        </p>
        <h2 id="recast-shortlist" className="text-2xl leading-tight">
          Who plays {part}?
        </h2>
        <p className="text-sm text-ivory-dim">
          {role.original.name} played it, billed{" "}
          <span className="tabular-nums">#{role.billing}</span>.
        </p>
      </div>

      <CastingTypeNote role={role} />

      {/* A refusal, kept next to the cards it is about. */}
      {error && (
        <p role="alert" className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-sm text-ivory">
          {error}
        </p>
      )}

      {loading && actors.length === 0 ? (
        // Card-shaped skeletons, so the panel does not jump when the
        // shortlist lands.
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-40 rounded-xl" />
          ))}
        </div>
      ) : actors.length === 0 ? (
        <EmptyState title="No one left to offer">
          This role&rsquo;s casting type has been used up by the parts already cast. There is
          nobody left the shortlist can honestly put forward.
        </EmptyState>
      ) : (
        <ul className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
          {actors.map((actor) => (
            <li key={actor.person_id}>
              <ActorOption
                actor={actor}
                selected={actor.person_id === selectedId}
                interactive={!casting}
                // Clicking the highlighted card again clears it, so a
                // selection is never a trap.
                onSelect={(id) => onSelect(id === selectedId ? null : id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Confirm bar: sticky at the foot of the viewport while a card is
          highlighted, exactly as the Oscars draft does it. */}
      {selected && (
        <div className="sticky bottom-4 z-20 flex animate-rise flex-col items-center gap-3 rounded-xl border border-gold/60 bg-ink/95 p-4 shadow-glow backdrop-blur sm:flex-row sm:justify-between">
          <p className="text-sm">
            <span className="text-ivory-dim">Cast </span>
            <span className="font-display text-lg text-ivory">{selected.name}</span>
            <span className="text-ivory-dim"> as </span>
            <span className="font-display text-lg text-ivory">{part}</span>
            <span className="text-muted">?</span>
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSelect(null)} disabled={casting}>
              Cancel
            </Button>
            <Button size="md" onClick={onConfirm} loading={casting}>
              Lock in
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
