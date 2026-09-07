// CastingTypeNote: why these eighteen names and not the other four thousand.
//
// Sits under src/components/recast/, above the shortlist. It exists because
// the shortlist is the most interesting decision in the mode and the least
// visible one: without a word of explanation, a wall of actor cards looks
// like an arbitrary sample, and the player has no reason to read the casting
// type printed on each of them.
//
// What it says is the design note in docs/GAME_DESIGN.md §8, in two
// sentences. The shortlist is the original actor's **casting type** — a
// k-means cluster over reach, the share of their credits that are leads,
// their era, how many films they have made and the genres they work in. That
// constraint is the game: the whole catalog would make each round a search
// box, and a random sample would put a 1950s character player up for a
// franchise lead. Drawing from the cluster means everyone offered plausibly
// does this *kind* of work, so the decision left is which of them fits this
// particular part.
//
// The second half is the honesty note: the list is not simply the best
// candidates. A few strong ones are guaranteed a place and the rest of the
// slots come from the wider cluster, so a good answer is always available
// without the round collapsing into "take the top one".

import type { RoleCard } from "../../api/types";

export function CastingTypeNote({ role }: { role: RoleCard }) {
  const type = role.original.casting_type;

  return (
    <aside className="flex flex-col gap-2 rounded-lg border border-dashed border-line bg-ink-2/40 p-3 text-xs leading-relaxed text-bone-dim">
      <p>
        {type ? (
          <>
            Everyone below is a{" "}
            <span className="uppercase tracking-[0.15em] text-accent">{type}</span> — the same casting
            type as {role.original.name}.
          </>
        ) : (
          // `casting_type` is nullable on the wire: the actor model may not
          // have been run. The shortlist is still drawn from a cluster, so the
          // explanation holds; only the label for it is missing.
          <>Everyone below is drawn from the same casting type as {role.original.name}.</>
        )}{" "}
        Casting types come from clustering every actor in the catalog on their reach, how often they
        lead, the era they worked in, how many films they made and the genres they work in.
      </p>
      <p className="text-muted">
        That is the constraint that makes this a decision rather than a search box: everyone here
        plausibly does this kind of work, so the only question left is which of them fits{" "}
        {role.character ? <span className="text-bone-dim">{role.character}</span> : "this part"}.
        The strongest few are always on the list, and the rest are drawn from the wider cluster — so
        there is a good answer here, but it is not simply the first one.
      </p>
    </aside>
  );
}
