# Clean Sweep — Game Design

Three modes, one catalog. **The Oscars** is the main game; **Recast** and the
**Co-star Grid** are shorter rounds built on the same 1950-2025 film data.

| Mode | The question | Round length |
|------|--------------|--------------|
| The Oscars | Can you build a ballot that sweeps the season? | 8 rounds |
| Recast | Who else could have played this part? | 3-5 roles |
| Co-star Grid | Which film were these two both in? | 3 minutes |

The two side modes are described in §8 and §9. The rest of this document is
the Oscars mode.

---

## The Oscars

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
  1950s–2020s, then a film year inside that decade (1950–2025). Drawing the
  decade first keeps early cinema as likely as the streaming era, mirroring
  82-0's decade slots. The year reel re-spins if the drawn year cannot be won
  in the category being drafted, so every slot the game deals is one that
  *can* be filled perfectly. The catalog itself starts at 1950: the Academy's records reach back to
  1927, but 91% of the 1920s films the pool rule pulls in have under 10,000
  IMDb votes, and being dealt five silent films nobody has heard of is not a
  round anyone can play.
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

| Metric        | Source                                   | Scored? |
|---------------|------------------------------------------|---------|
| Academy       | Oscar win/nomination, or the genre crown | yes     |
| Acclaim       | IMDb rating, percentile in year          | yes     |
| Box Office    | Measured revenue, percentile in year     | yes     |
| Popularity    | IMDb vote count, percentile in year      | yes     |
| Prestige      | ML ranker probability                    | **no** — shown as a model estimate |

When Rotten Tomatoes / Metacritic scores are enriched they blend into
Acclaim (critic vs. audience split, see `docs/DATA.md`).

A contender's **Pick Score** is the weighted mean of its metrics. For the two
genre categories the Academy metric reads the genre crown instead of an Oscar,
and everything else works identically:

| Metric | Weight |
|--------|--------|
| Academy | 0.60 |
| Acclaim | 0.16 |
| Box Office | 0.14 |
| Popularity | 0.10 |

No model prediction is scored. The ranker's estimate is shown on the card
labelled as such, but a player's record depends only on observable facts and
the actual outcome. Box Office is scored from *measured* revenue only;
where the figure is an estimate it is shown marked and left unscored.

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


---

## 8. Recast

A film comes up with its principal roles, top-billed first. You replace each
one, and the round scores how defensible the casting is.

### The shortlist is the game

Each role offers a shortlist drawn from the **casting type** of the actor who
originally played it — a k-means clustering of every actor in the catalog over
their reach, the share of their credits that are leads, their era, how many
films they have made, and the genres they work in (`backend/ml/actors.py`).
Five types come out, each named from its centroid:

| Casting type | Actors | Looks like |
|--------------|--------|------------|
| Marquee Lead | 158 | Brad Pitt, Samuel L. Jackson, Leonardo DiCaprio |
| Leading Player | 261 | Elijah Wood, Joseph Gordon-Levitt, Anne Hathaway |
| Supporting Regular | 251 | Stellan Skarsgård, Sean Bean |
| Working Actor | 385 | Orlando Bloom, Cillian Murphy, Andy Serkis |
| Ensemble Player | 183 | Takashi Shimura, Charles Bronson |

That constraint is deliberate. Offering the whole catalog would make each
round a search box; a random sample would put a 1950s character player up for
a franchise lead. Drawing from the cluster means everyone offered plausibly
does this *kind* of work, so the decision is about which of them fits this
particular part.

The shortlist is not simply the best-fitting candidates either — the strongest
few are guaranteed a place and the rest of the slots are drawn from the wider
cluster, so the answer is available without the round being "take the top
one".

### How a casting is scored

Four components, each 0-100, blended into one fit score:

| Component | Weight | What it asks |
|-----------|--------|--------------|
| Stature | 0.35 | Can this name carry a part this size? Compared on reach, so the gap that matters is order-of-magnitude |
| Role fit | 0.30 | Do they actually play parts this size? From their lead share, scored against the *role* rather than the original actor |
| Genre | 0.20 | Do they work in this kind of film? |
| Era | 0.15 | Are they plausible contemporaries? The lightest weight — a knowingly anachronistic recast should cost something, not everything |

Afterwards each role reveals the **best available** casting on the shortlist
you were shown, so there is always something to compare against.

**Gender is deliberately not a factor.** The seed carries the signal — the
Academy splits its acting awards — and it would be easy to require a
like-for-like swap. The mode does not, because gender-swapped casting is a
real creative decision rather than an error, and scoring it as a mismatch
would build an opinion into the maths the data cannot support.

## 9. Co-star Grid

Three actors down the side, three across the top, nine cells. Each cell wants
a film both its actors appeared in. Three minutes, or hand it in early.

### Every cell is answerable

The board is **searched for**, not sampled and then checked. A candidate is
only accepted once all nine intersections are known to share at least one
film, so a pairing that never worked together can never appear.

### No board is a giveaway

The obvious failure is six actors who were all in one ensemble: search
unconstrained and you get a board whose every cell is *Interstellar*, which is
a memory test with one answer. No single film may be the best answer for more
than two of the nine cells.

Actors are drawn from the most recognisable slice of the co-star graph — a
board of unknown names is unplayable however well connected they are.

### Scoring

Every pair's shared films are pre-ranked by how well known they are. Naming
the collaboration people remember scores 100; naming an obscure film they also
share still scores, from a floor of 60. That rewards knowing the *pair* rather
than knowing one trivia answer.

A film may only be used once per board, so one ensemble cannot fill a row.

Afterwards each cell reveals its best answer — the one worth remembering — and
not the full list.
