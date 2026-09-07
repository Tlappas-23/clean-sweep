# Clean Sweep — Game Design

Clean Sweep is an Oscar-ballot drafting game in the spirit of
[82-0](https://www.82-0.com/how-to-play). Instead of building an undefeated
NBA roster, you build a six-category awards ballot and run it through an
awards-season simulation. A perfect run wins every stop on the circuit:
a **30-0 season**, the "clean sweep".

## 1. The ballot (roster spots)

Eight rounds, one per category. Categories are always filled in this order
(the slot machine randomises the *year*, not the order):

| Round | Category                  | Contender type      | Answer key |
|-------|---------------------------|---------------------|------------|
| 1     | Best Picture              | a film              | Academy Award |
| 2     | Best Director             | a person in a film  | Academy Award |
| 3     | Best Actor                | a person in a film  | Academy Award |
| 4     | Best Actress              | a person in a film  | Academy Award |
| 5     | Best Supporting Actor     | a person in a film  | Academy Award |
| 6     | Best Supporting Actress   | a person in a film  | Academy Award |
| 7     | Best Horror               | a film              | genre crown |
| 8     | Best Comedy               | a film              | genre crown |

### The two categories the Academy never created

Horror has won 8 Oscars in 99 years, so "did it win" cannot decide a Best
Horror round — almost every year would be unwinnable. These two slots are
judged against a **genre crown** computed from the data instead: within each
year, films of that genre are ranked by the Bayesian weighted rating IMDb
uses for its own Top 250, which pulls a film's score toward the pool mean in
proportion to how few votes back it. The top film takes the crown and scores
100; the next four score 60, exactly like nominees. Every year from 1927 to
2025 has a crown in both genres.

The crowns land where you would hope: *Psycho* (1960), *The Shining* (1980),
*Get Out* (2017), and *The Apartment* for 1960 comedy.

## 2. The slot machine

Each round starts with a spin of two reels:

* **Decade reel** → **Year reel.** A decade is drawn uniformly from
  1920s–2020s, then a film year inside that decade (1927–2025). Drawing the
  decade first keeps early cinema as likely as the streaming era, mirroring
  82-0's decade slots. The year reel re-spins if the drawn year cannot be won
  in the category being drafted, so every slot the game deals is one that
  *can* be filled perfectly. That rules out the supporting categories before
  the 1936 ceremony (they did not exist) and 1933 (the 1934 ceremony covered
  the split 1932/33 season, filed under 1932).
* **Category reel.** The next unfilled category in the order above.

### Three years, or gamble for a fourth

Each round deals **three different years at once**, and you may draft your
contender from whichever of them you like. That turns every round into a
choice between eras rather than a single take-it-or-leave-it draw.

If none of the three appeals, you may spend the round's **reroll** for a
fourth year — but the three are thrown away and the new year is the only one
left. You have to use it. One reroll per round, and it has to be spent before
you lock a pick in.

That is the whole tension: three safe options, or one blind swing at a year
you have not seen. Rerolling out of a 1930s Best Comedy slot might hand you
1994, or it might hand you 1931.

### The category skip

You also get **one category skip** for the whole game. It defers the current
category to the end of the ballot and starts the next one instead, with a
fresh set of three years (a year playable for Best Horror is not necessarily
playable for Best Supporting Actress). The skip keeps the round's reroll.

You pick one contender from the pool of whichever year you choose. The pool
is *every* notable film or performance of that year, not just the nominees,
so knowing who was actually nominated is a real edge.

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

A contender's **Pick Score** is the weighted mean of its metrics. For the two
genre categories the Academy metric reads the genre crown instead of an Oscar,
and everything else works identically:

| Metric | Weight |
|--------|--------|
| Academy | 0.50 |
| Prestige | 0.17 |
| Acclaim | 0.13 |
| Box Office | 0.12 |
| Popularity | 0.08 |

Weights are renormalised over whichever metrics are available, so a pick is
never punished for missing box-office data. The **Ballot Strength** is the
sum of the eight pick scores (0–800).

## 4. The awards circuit (the simulation)

The season is **30 ceremonies**, from early critics' circles through the
guilds to the Academy Awards. Each ceremony has:

* a **threshold** — the strength required to win it. Thresholds rise along a
  convex curve, so the last handful of ceremonies demand a near-perfect
  ballot (this is the "each additional win is harder" rule from 82-0);
* an **emphasis vector** — how much that ceremony weights each of the eight
  categories. An acting-focused body weights the four acting slots heavily;
  a directors' guild weights Best Director; the Saturn and Fangoria stops
  weight the two genre slots.

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
| Every actual winner and crown | always |
| One un-nominated pick among them | never |
| Nominees and runners-up only | never |

In other words: knowing the shortlist gets you a long way, but only knowing
the envelope gets you 30-0.

### Does it actually reward knowledge?

150 seeded games per strategy, played straight through the engine:

See `docs/BALANCE.md` for the measured records of each strategy; the ordering
is the design goal in one table. Recognising a famous title gets you about a
third of the season, knowing who was nominated gets you most of it, and only
knowing who actually won closes it out.

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
