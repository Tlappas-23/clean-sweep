# Clean Sweep — Game Design

Clean Sweep is an Oscar-ballot drafting game in the spirit of
[82-0](https://www.82-0.com/how-to-play). Instead of building an undefeated
NBA roster, you build a six-category awards ballot and run it through an
awards-season simulation. A perfect run wins every stop on the circuit:
a **30-0 season**, the "clean sweep".

## 1. The ballot (roster spots)

Six rounds, one per category. Categories are always filled in this order
(the slot machine randomises the *year*, not the order):

| Round | Category                  | Contender type      |
|-------|---------------------------|---------------------|
| 1     | Best Picture              | a film              |
| 2     | Best Director             | a person in a film  |
| 3     | Best Actor                | a person in a film  |
| 4     | Best Actress              | a person in a film  |
| 5     | Best Supporting Actor     | a person in a film  |
| 6     | Best Supporting Actress   | a person in a film  |

## 2. The slot machine

Each round starts with a spin of two reels:

* **Decade reel** → **Year reel.** A decade is drawn uniformly from
  1920s–2020s, then a film year inside that decade (1927–2025). Drawing the
  decade first keeps early cinema as likely as the streaming era, mirroring
  82-0's decade slots. The year reel re-spins if the drawn year has no actual
  winner in the category being drafted, so every slot the game deals is one
  that *can* be filled perfectly. That rules out the supporting categories
  before the 1936 ceremony (they did not exist) and 1933 (the 1934 ceremony
  covered the split 1932/33 season, filed under 1932).
* **Category reel.** The next unfilled category in the order above.

You then pick one contender from that year's candidate pool for that
category. The pool is *every* notable film/performance of that year (top
films by IMDb vote count), not just the nominees, so knowing who was actually
nominated is a real edge.

### Skips

You get **one year skip** and **one category skip** per game.

* *Year skip* re-spins the year reel.
* *Category skip* defers the current category to the end of the ballot and
  spins the next one (the year is kept).

Use them when the machine lands on a thin year for the category you need.

## 3. Strength metrics

Every contender has five metrics, each on a 0–100 scale. Percentile-based
metrics are computed **within the contender's film year**, so a 1940 film is
compared to 1940 films.

| Metric        | Source                                   | What it captures                                  |
|---------------|------------------------------------------|---------------------------------------------------|
| Academy       | Oscar nominations/wins (ground truth)    | 100 win · 60 nomination · 0 otherwise             |
| Acclaim       | IMDb rating (percentile in year)         | How well the film is regarded                     |
| Popularity    | IMDb vote count (percentile in year)     | Reach / cultural footprint                        |
| Box Office    | TMDB revenue (percentile in year)        | Commercial success (falls back to Popularity)     |
| Prestige      | ML ranker probability                    | Learned "does this look like an Oscar winner?"    |

When Rotten Tomatoes / Metacritic scores are enriched they blend into
Acclaim (critic vs. audience split, see `docs/DATA.md`).

A contender's **Pick Score** is the weighted mean of its metrics:

| Metric | Weight |
|--------|--------|
| Academy | 0.50 |
| Prestige | 0.17 |
| Acclaim | 0.13 |
| Box Office | 0.12 |
| Popularity | 0.08 |

Weights are renormalised over whichever metrics are available, so a pick is
never punished for missing box-office data. The **Ballot Strength** is the
sum of the six pick scores (0–600).

## 4. The awards circuit (the simulation)

The season is **30 ceremonies**, from early critics' circles through the
guilds to the Academy Awards. Each ceremony has:

* a **threshold** — the strength required to win it. Thresholds rise along a
  convex curve, so the last handful of ceremonies demand a near-perfect
  ballot (this is the "each additional win is harder" rule from 82-0);
* an **emphasis vector** — how much that ceremony weights each of the six
  categories. An acting-focused body weights the four acting slots heavily;
  a directors' guild weights Best Director.

Your ballot wins a ceremony if its *emphasis-weighted* strength clears the
threshold. Because emphasis vectors differ, **a weak category costs you the
ceremonies that care about it** even if your total is high — the deficiency
rule from 82-0. The simulation is deterministic: the same ballot always yields
the same record.

The weights and the threshold curve are calibrated together
(`python -m app.engine.calibrate`, 20,000 random six-year draws) so that
three things hold at once:

| Ballot | Sweeps |
|--------|--------|
| The six actual winners | always |
| Five winners plus one un-nominated pick | never |
| Six nominees who all lost | never |

In other words: knowing the shortlist gets you a long way, but only knowing
the envelope gets you 30-0.

### Does it actually reward knowledge?

150 seeded games per strategy, played straight through the engine:

| Strategy | Mean record | Sweeps |
|----------|-------------|--------|
| Knows every winner | 30–0 | 100% |
| Knows the nominees, not the winners | 25.6–4.4 | 0% |
| Follows the prestige model | 20.8–9.2 | 0.7% |
| Always picks the highest-rated film | 9.6–20.4 | 0% |
| Always picks the most popular film | 13.3–16.7 | 0% |
| Always picks the top-billed name | 12.3–17.7 | 0% |

The ordering is the design goal in one table. Recognising a famous title gets
you about a third of the season. Knowing who was nominated gets you most of
it. Only knowing who actually won closes it out, and the ML model — which has
never seen an award outcome as a feature — plays at the level of a
well-informed fan.

## 5. Game modes

| Mode        | Metrics visible while picking | Academy outcome visible |
|-------------|-------------------------------|-------------------------|
| Classic     | Acclaim, Popularity, Box Office, Prestige, archetype | never (revealed at results) |
| Cinephile   | none — title, year, person, character only            | never |

The Academy metric is *always* hidden until the ballot is complete; otherwise
the game would be trivial.

## 6. Daily challenge

A game created with `seed = today's date` produces the same spins for every
player, so scores are comparable on the leaderboard.

## 7. Archetypes (clustering)

Each film is tagged with an archetype learned by clustering film features
(see `docs/ML.md`): e.g. *Critical Darling*, *Crowd-Pleaser*, *Prestige
Drama*, *Cult Favourite*, *Blockbuster*. Archetypes are shown on contender
cards as a hint and drive the analytics page. They do **not** affect scoring
(82-0 has no synergy bonuses; neither does Clean Sweep).
