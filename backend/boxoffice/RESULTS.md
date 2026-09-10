# Results

Every number here comes from 16 rolling-origin folds, 2010 to 2025, on 2,457
films. Each fold trains on everything released before a year and scores the
films released in it. Nothing is imputed and nothing post-release is used.

## Against the baselines

| Estimator | MAE (log) | Within a factor of 2 |
|---|---|---|
| Predict the median film | 1.478 | 31.0% |
| **Budget alone** | 1.053 | 47.3% |
| All 35 pre-release features | **0.948** | **55.7%** |

The model clears budget-only in 15 of the 16 folds; 2011 is the exception.
Budget alone reaching 47% is the finding underneath the headline: what a studio
spends is most of what a studio makes.

## What each signal is worth

Measured by removing the group from the full model, which asks what it
contributes alongside everything else.

| Group | Error lost when removed |
|---|---|
| Form: sequel, franchise position, runtime, language | **+0.088** |
| Studio: the distributor and its track record | **+0.040** |
| Genre | +0.013 |
| Release timing | +0.008 |
| Composer's prior grosses | +0.006 |
| Cinematographer's prior grosses | +0.000 |
| Cast: the stars' prior grosses | -0.001 |
| Director's prior grosses | -0.007 |

Three results worth stating plainly.

**The distributor predicts better than the people.** Studio contributes forty
times what cast does. Who releases a film carries more information than who is
in it or who directed it.

**Star power contributes nothing measurable.** A cast's prior box office does
not predict the next film's at this sample size. This is the result most likely
to be wrong for an interesting reason rather than a boring one: 2,457 films is
not many, prior gross is a crude proxy for drawing power, and the effect may
live in interactions the model can see through budget instead.

**Cinematographer lands at exactly zero.** That was the prediction before the
run, and it is now the data's answer rather than an assertion. Worth keeping in
the table for exactly that reason.

## The ablation design mattered more than the ablation

Adding each group to a budget-only model makes almost every one of them look
harmful: genre, calendar, cast and cinematographer all raise error. Yet all 35
features together beat budget-only by 11 points.

Two things cause that, and only one is interesting. The interesting one is that
these features only mean something in combination: a star's prior gross says
nothing until you know the budget tier and genre it is attached to. The
uninteresting one is a confound in the first design, which held the boosting
configuration fixed across feature counts, so five features and four hundred
iterations overfit in a way thirty-five do not.

Both designs are reported. The disagreement between them is more useful than
either table alone.

## Limits

**2020 breaks.** Both model and baseline collapse to 42% and 33%. The pandemic
severed the relationship between budget and gross, and a model trained through
2019 had no way to know. That is an honest limit of temporal validation.

**The sample thins after 2018**, from 114 films a year to between 36 and 76.
Recent folds carry less weight than they appear to.

**Coverage of the people features is genuinely low.** Director prior gross is
present for 50% of films, cinematographer 67%, composer 74%, because half the
sample has nobody with an earlier film in it. Those gaps are left as missing
rather than imputed: a first-time director has no track record, and filling it
with a median would tell the model every debut is average.

**Worldwide only, so far.** TMDB reports a single worldwide gross with no
domestic split. Domestic requires OMDb at 1,000 calls a day, and the
three-target version follows as that quota allows.

## The breakout, and a claim that did not survive

On the 686 films with both a worldwide and a domestic figure, nine folds:

| Target | Within a factor of 2 |
|---|---|
| Domestic | 69.4% |
| International | 59.7% |
| Worldwide, summed from the two halves | 69.4% |
| **Worldwide, fit directly** | **71.7%** |

The README originally argued that worldwide should be the sum of the two
halves, because domestic and international have different drivers and one fit
on the total cannot express that. The claim was checked and it does not hold:
the direct fit wins by 2.3 points and is better or level in seven of nine
folds.

The mechanism is not subtle once looked at. Each half is fit in log space and
exponentiated before summing, so two independent errors compound rather than
cancel, while the direct fit optimises the quantity actually being asked for.

The margin moved when coverage improved, and that is worth recording. On the
first 523 films the gap was 4.9 points; on 686 it is 2.3. The direction has
been stable across both runs and the size has not, so the finding is "summing
does not help" rather than "summing costs five points".

What survives unchanged is the other half of the original argument.
**International is meaningfully harder to forecast than domestic**, by 9.7
points here and 11 points on the smaller sample.

## Domestic coverage is the binding constraint

Worldwide gross is available for all 2,456 films. A domestic figure is
available for 687, which is 28%.

| Source | Films | Note |
|---|---|---|
| Clean Sweep's existing OMDb cache | 520 | free, already on disk |
| OMDb, fetched | 3 | daily quota ran out |
| Wikidata, filling gaps | 164 | no quota, but only 832 of the sample present at all |

Where the two sources overlap on 239 films they agree exactly on 198, within
one percent on 224 and within ten percent on 234. The five that disagree by
more all have Wikidata reporting the smaller figure, which is what an early-run
number looks like against a final one, so OMDb takes precedence and Wikidata
fills gaps.

Twenty-eight percent is thin, and it thins worst in the recent years that
matter most: 2019, 2020 and 2023 onward have too few films with both figures to
form a fold at all. The split results above should be read as directional. The
route to better coverage is OMDb over two more days rather than another source,
because Wikidata simply does not carry these films.
