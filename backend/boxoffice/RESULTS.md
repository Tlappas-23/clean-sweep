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

## The learner barely matters

Gradient boosting was asserted rather than justified, so it was put against
three alternatives on the same 16 folds. Ridge and the random forest cannot
take a missing value, so both get median imputation **with indicator columns**,
which is the strongest form of the thing rather than a straw man.

| Learner | MAE (log) | Within 2x | Folds beating the shipped model |
|---|---|---|---|
| Budget alone, linear | 1.053 | 47.3% | 1/16 |
| Ridge, imputed | 0.928 | 54.1% | 6/16 |
| Random forest, imputed | **0.922** | 55.6% | 8/16 |
| Boosting, sklearn defaults | 0.938 | 55.1% | 7/16 |
| **Boosting, as shipped** | 0.948 | **55.7%** | - |

**The learner is worth a point or two; the features are worth eight.** Every
model given all 35 features lands between 54% and 56%. Budget alone sits at
47%. That gap is the entire result and no estimator moves it.

**Random forest is not worse than what ships.** It ties on the headline metric,
wins 8 of 16 folds on it, and carries the lower error in 13 of them. Its error
advantage averages 0.026 fold to fold against a fold-to-fold spread of 0.040,
so this is a tie with a hint rather than a defeat.

**Tuning bought almost nothing**, and what it bought it paid for: the untuned
configuration has the lower error and the tuned one the better within-2x, which
is the tuning doing exactly what it was pointed at, for a fraction of a point.

The booster ships on a tiebreak that is a principle rather than a number. It
takes missing values natively and needs no imputation step. Half this sample
has a director with no earlier film in it, and adopting the model that requires
inventing a career for each of them, in exchange for nothing measurable, would
contradict the argument the rest of the project is making.

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

## Prestige does not predict revenue

Thirteen features were added to test whether Academy pedigree and slate context
carry information the base model was missing. Oscar record of the director,
cast and writer as of release day; how crowded the release corridor is; the gap
since the last franchise entry; and the director's most recent gross rather
than their career median.

Together they moved the model from 0.948 to 0.941 MAE and from 55.7% to 55.8%
within a factor of two. Thirteen features for a tenth of a point.

Removing each group from the full 48-feature model:

| Group removed | Change in MAE | Change in within 2x |
|---|---|---|
| All thirteen at once | +0.006 | -0.1 pts |
| Oscar pedigree | +0.005 | -0.2 pts |
| Release competition | +0.002 | -0.2 pts |
| Franchise gap | +0.002 | -0.3 pts |
| Director recency | +0.001 | -0.6 pts |

Every one of them sits inside noise. The instability across runs is the clearest
evidence of that: an earlier pass, before the feature matrix was rebuilt to fix
the unreleased-film priors, had the Oscar block coming out mildly *harmful* at
-0.003 rather than mildly helpful at +0.005. An effect whose sign flips on a
rebuild is not an effect. Nothing here earns its place.

**The Oscar result is the interesting one**, because it was a reasonable idea
and it fails in a specific way. Forty percent of this sample has an Academy
Award winner attached, so the feature is not rare or thinly covered. Prestige
is simply a different axis from commercial performance, and the model already
knows what it needs about a film's scale from budget and studio.

That finding is consistent with everything else the ablation found. Across
eleven feature groups now tested, the pattern does not vary:

**What the film is predicts revenue. Who made it does not.**

Sequel status, franchise position, budget and distributor carry the signal.
Cast, director, cinematographer, composer and Academy pedigree carry none of
it. The 48-feature model is kept as the record of that test; the 35-feature
model is what ships, because thirteen features that buy a tenth of a point are
thirteen features to maintain for nothing.

## The headline number hides where the model fails

55.7% within a factor of two is an average across the whole range, and the
average is the least useful thing about it. Split the forecasts into ten
buckets by what the film actually earned:

| Decile | Median actual | Median projected / actual | Within 2x |
|---|---|---|---|
| 1 (smallest) | $1.7M | **10.13** | 15% |
| 2 | $11.6M | 1.98 | 44% |
| 3 | $24.6M | 1.39 | 54% |
| 4 | $44.5M | 1.02 | 64% |
| 5 | $68.5M | 0.94 | 62% |
| 6 | $105M | 0.79 | 67% |
| 7 | $153M | 0.82 | 63% |
| 8 | $222M | 0.70 | 61% |
| 9 | $372M | 0.78 | 75% |
| 10 (largest) | $787M | 0.66 | 69% |

The model is well calibrated in the middle, where a $44M film gets a forecast
within two percent of the truth. It is wrong in two directions at the edges, and
the two errors are not equally serious.

**It cannot tell you a film will flop.** In the bottom decile it projects ten
times what the film earned, and lands within a factor of two only 15% of the
time. Films that made $1.7M were forecast at roughly $17M. A studio using this
to greenlight would be systematically told that its worst bets would be fine,
which is the single most expensive way a box office model can be wrong.

**It underestimates blockbusters**, by about a third at the top. That is the
milder failure: it is directionally right and merely conservative.

Both are regression to the mean in log space, which is what a squared-error
objective does when the target spans five orders of magnitude. Neither is
visible in the headline metric, which is why the headline metric should not be
quoted alone.
