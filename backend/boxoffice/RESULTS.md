# Results

Every number here comes from 17 rolling-origin folds, 2010 to 2026, on 2,505
films. Each fold trains on everything released before a year and scores the
films released in it. Nothing is imputed and nothing post-release is used.

Figures are quoted on two conventions and they are not interchangeable. The
**fold mean** averages the 17 folds, weighting a 43-film year the same as a
116-film one. The **pooled** figure treats every scored film equally. Each is
labelled where it appears.

## Against the baselines

| Estimator | MAE (log) | Within a factor of 2 |
|---|---|---|
| Predict the median film | 1.478 | 31.0% |
| **Budget alone** | 1.044 | 47.4% |
| All 35 pre-release features | **0.943** | **55.4%** |

The model clears budget-only in 16 of the 17 folds; 2011 is the exception.
Budget alone reaching 47% is the finding underneath the headline: what a studio
spends is most of what a studio makes.

## The learner barely matters, and the incumbent is no longer the best

Gradient boosting was asserted rather than justified, so it was put against
three alternatives on the same 17 folds. Ridge and the random forest cannot
take a missing value, so both get median imputation **with indicator columns**,
which is the strongest form of the thing rather than a straw man.

| Learner | MAE (log) | Within 2x | Folds beating the shipped model |
|---|---|---|---|
| Budget alone, linear | 1.044 | 47.4% | 1/17 |
| Ridge, imputed | 0.924 | 54.1% | 7/17 |
| **Random forest, imputed** | **0.918** | **55.8%** | 10/17 |
| Neural net, two hidden layers of 64 | 1.152 | 43.0% | 0/17 |
| Boosting, sklearn defaults | 0.933 | 54.7% | 7/17 |
| Boosting, as shipped | 0.943 | 55.4% | - |

**The neural network is the worst thing on the list.** Two hidden layers on
the same 35 features, with median imputation, missing indicators and
standardisation to mean zero and unit variance, lands at 43.0% and loses all 17
folds. It is beaten by a linear regression on budget alone, which is one
feature. With 2,505 rows and 35 columns there is nothing for it to learn that
the trees have not already found, and plenty of variance for it to fit.

A note on scaling, since it is the part most often got wrong. Trees do not care
about it: a split at `budget > 40m` is the same split whichever units budget is
in, which is why the boosters take the matrix untouched. Gradient-trained
models do care, because a feature measured in hundreds of millions and a
zero-one flag sharing one learning rate means one of them is effectively
ignored. The convention is standardising to mean zero and unit variance rather
than squeezing into a zero-to-one box, and an exact zero is a perfectly good
input value. The network above got the correct treatment and still lost, so the
result is about the problem rather than about the preprocessing.

**The learner is worth a point or two; the features are worth eight.** Every
model given all 35 features lands between 54% and 56%. Budget alone sits at
47%. That gap is the entire result and no estimator moves it.

**The random forest is now ahead on both metrics**, and this is a change worth
stating plainly rather than burying. On the smaller sample it tied; with 2,505
films it carries the lower error, the better within-2x, and wins 10 of 17
folds. The margin is still inside the fold-to-fold spread, so this is a lead
rather than a verdict.

The booster continues to ship on a tiebreak that is a stated principle rather
than a number: it takes missing values natively and needs no imputation step,
and half this sample has a director with no earlier film in it. That argument
is now carrying more weight than it was, which is the honest way to describe
keeping a model that is no longer winning on the scoreboard.

## What each signal is worth

Measured by removing the group from the full model, which asks what it
contributes alongside everything else.

| Group | Error lost when removed |
|---|---|
| Form: sequel, franchise position, runtime, language | **+0.087** |
| Studio: the distributor and its track record | **+0.043** |
| Genre | +0.012 |
| Cast: the stars' prior grosses | +0.006 |
| Composer's prior grosses | +0.006 |
| Release timing | +0.005 |
| Cinematographer's prior grosses | -0.001 |
| Director's prior grosses | -0.007 |

**The distributor predicts better than the people.** Studio contributes seven
times what cast does. Who releases a film carries more information than who is
in it or who directed it.

**Star power contributes almost nothing.** A cast's prior box office barely
predicts the next film's. This is the result most likely to be wrong for an
interesting reason rather than a boring one: prior gross is a crude proxy for
drawing power, and the effect may live in interactions the model can already
see through budget.

**Removing the director slightly improves the model**, and the cinematographer
lands at zero. That was the prediction before the run, and it is now the data's
answer rather than an assertion.

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

## Three ideas that were tested and did not survive

### Prestige does not predict revenue

Thirteen features: the Oscar record of the director, cast and writer as of
release day, joined through IMDb's principals file to the Academy data; how
crowded the release corridor is; the gap since the last franchise entry; and
the director's most recent gross rather than their career median.

A nomination for film year Y is announced in the first quarter of Y+1, so it is
treated as public from 1 March of Y+1 and counted only for films released after
that date. A film opening in February 2016 does not know about the ceremony
later that month.

| Group removed from the 48-feature model | Change in MAE | Change in within 2x |
|---|---|---|
| All thirteen at once | +0.008 | -0.2 pts |
| Oscar pedigree | +0.003 | -0.1 pts |
| Release competition | -0.000 | -0.2 pts |
| Franchise gap | +0.002 | -0.2 pts |
| Director recency | +0.004 | -0.9 pts |

Every one sits inside noise. Forty percent of the sample has an Academy Award
winner attached, so the feature is neither rare nor thinly covered. Prestige is
simply a different axis from commercial performance, and the model already
knows what it needs about a film's scale from budget and distributor.

### The marketing synopsis does not predict revenue

A plot summary is an appealing feature and a dangerous one, and which it is
depends on who wrote it and when. **Wikipedia plot summaries are written after
the film has played**, so their length and detail track how much attention it
received, which is the same class of signal as a vote count. TMDB's `overview`
is the studio's own logline, published to sell tickets and present months
before opening. 2,621 of 2,622 films have one, including every film on the
unreleased slate.

TF-IDF over word and bigram features, reduced to 32 components, **fitted inside
each fold on training documents only** so a 2012 model cannot see the marketing
vocabulary of 2020.

| Arm | MAE (log) | Within 2x | Better in |
|---|---|---|---|
| Metadata, 35 features | 0.943 | 55.4% | - |
| Metadata + synopsis | 0.937 | 54.9% | 7/17 folds |
| Synopsis alone | 1.437 | 31.7% | 0/17 folds |

Adding it is noise. Alone it is barely better than predicting the median film
(31.0%), which is the cleaner statement of the result: **there is almost
nothing about revenue in how a film is described.**

### Worldwide is not the sum of its parts

The original design argued that worldwide should be the sum of a domestic fit
and an international fit, because the two halves have different drivers. It was
checked rather than left standing, and it loses. Each half is fit in log space
and exponentiated before summing, so two independent errors compound instead of
cancelling, while a direct fit optimises the quantity actually wanted.

Across eleven feature groups and three outside ideas, the pattern has not
varied: **what the film is predicts revenue; who made it, how it is described,
and how its parts are assembled do not.**

## The breakout, on a sample that is no longer biased

Domestic coverage reached 95.5% in September 2026, which changed these numbers
enough that the previous version of this section should be treated as
withdrawn rather than refined.

| Target | Within a factor of 2 (fold mean) |
|---|---|
| Domestic | 51.2% |
| International | 40.5% |
| Worldwide, summed from the two halves | 52.5% |
| **Worldwide, fit directly** | **56.6%** |

15 folds, 2012 to 2026, on 2,323 films with both figures. A domestic gross is now held for 2393 films, 95.5% of the released sample, all of it from OMDb: the Wikidata fallback that carried 164 films at 28% coverage is now entirely redundant and contributes nothing.

**The earlier figures were flattered by the sample, not by the model.** On 686
films the same table read 69.4% domestic and 71.7% worldwide. That sample came
mostly from an existing cache of Oscar-nominated films, which is a set of
prestige titles with unusually predictable performance. Going from 686 films to
2,323 cost roughly fifteen points across the board. Nothing about the method
changed; the population did.

Both conclusions survive the correction. The direct fit still beats summing, by
4.1 points rather than 2.3. International is still the harder half, by 10.7
points rather than 9.7.

**70 films report a domestic gross larger than their worldwide gross** and are
dropped from the split. That is OMDb and TMDB disagreeing rather than a
reconciliation rule, and it is an open item rather than a solved one.

## The headline number hides where the model fails

57.1% pooled across the 1,425 films with an out-of-sample projection is an
average over five orders of magnitude, and the average is the least useful
thing about it. Split the forecasts into ten buckets by what the film actually
earned:

| Decile | Median actual | Median projected / actual | Within 2x |
|---|---|---|---|
| 1 (smallest) | $1.7M | **9.95** | 15% |
| 2 | $11.4M | 2.01 | 42% |
| 3 | $23.7M | 1.46 | 55% |
| 4 | $43.5M | 1.03 | 62% |
| 5 | $67.9M | 0.94 | 63% |
| 6 | $104.9M | 0.79 | 66% |
| 7 | $152.6M | 0.83 | 63% |
| 8 | $222.8M | 0.71 | 61% |
| 9 | $371.9M | 0.79 | 75% |
| 10 (largest) | $809.3M | 0.66 | 69% |

**It cannot tell you a film will flop.** In the bottom decile it projects ten
times what the film earned, and lands within a factor of two only 15% of the
time. A studio using this to greenlight would be systematically told its worst
bets would be fine, which is the single most expensive way a box office model
can be wrong.

**It underestimates blockbusters** by about a third at the top. That is the
milder failure: directionally right and merely conservative.

Both are regression to the mean in log space, which is what a squared-error
objective does when the target spans five orders of magnitude. Neither is
visible in the headline metric, which is why the headline metric should not be
quoted alone.

## Limits

**2020 breaks.** Both model and baseline collapse. The pandemic severed the
relationship between budget and gross, and a model trained through 2019 had no
way to know. That is temporal validation being honest, not a bug.

**The sample thins after 2018**, from 114 films a year to between 36 and 76.
Recent folds carry less weight than they appear to, and 2026 is a partial year.

**Coverage of the people features is genuinely low.** Director prior gross is
present for 50% of films, cinematographer 67%, composer 74%, because half the
sample has nobody with an earlier film in it. Every one of those gaps is
explained by the person having no prior credit rather than by a failed lookup,
checked directly. They are left missing rather than imputed.

**The sample is studio films.** It will not price a microbudget breakout,
because the frame excluded films no distributor picked up.

**No estimator is meaningfully better than any other here.** Ridge, a random
forest and two boosters land within two points of each other, so the remaining
error is a property of what is knowable before release rather than of the
model. More modelling will not move it.
