# Results

Every number here comes from 17 rolling-origin folds, 2010 to 2026, on 2,527
films. Each fold trains on everything released before a year and scores the
films released in it. Nothing is imputed and nothing post-release is used.

Figures are quoted on two conventions and they are not interchangeable. The
**fold mean** averages the 17 folds, weighting a 38-film year the same as a
116-film one. The **pooled** figure treats every scored film equally. Each is
labelled where it appears.

## Against the baselines

| Estimator | MAE (log) | Within a factor of 2 |
|---|---|---|
| Predict the median film | 1.460 | 32.1% |
| **Budget alone** | 1.035 | 47.1% |
| All 38 pre-release features | **0.921** | **56.0%** |

The model clears budget-only in all 17 folds, which it did not before the
target corrections: 2011 used to be an exception and was an artefact of four
mislabelled grosses in that year's training data.
Budget alone reaching 47% is the finding underneath the headline: what a studio
spends is most of what a studio makes.

## The learner barely matters

Gradient boosting was asserted rather than justified, so it was put against
three alternatives on the same 17 folds. Ridge and the random forest cannot
take a missing value, so both get median imputation **with indicator columns**,
which is the strongest form of the thing rather than a straw man.

| Learner | MAE (log) | Within 2x | Folds beating the shipped model |
|---|---|---|---|
| Budget alone, linear | 1.035 | 47.1% | 0/17 |
| Ridge, imputed | 0.918 | 54.0% | 3/17 |
| Random forest, imputed | **0.912** | **56.1%** | 8/17 |
| Neural net, two hidden layers of 64 | 1.211 | 41.1% | 0/17 |
| Boosting, hand-tuned, retired | 0.928 | 55.8% | 6/17 |
| Boosting, as shipped (library defaults) | 0.921 | 56.0% | - |

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

**What ships is the library defaults**, and the row above it is the hand-set
configuration they replaced; the section below records how. The random forest
is still ahead on error and behind on the headline, and the four tree rows sit
inside one another's fold-to-fold spread. The right statement remains that the
learner is worth a point or two and the features are worth nine.

## The tuning search, and what it found instead of a better model

The hand-set configuration that shipped for months was beaten by scikit-learn's
defaults, so a proper search was run: forty randomised candidates over six
parameters, each scored on the nine folds from 2010 to 2018, the winner chosen
there. The eight folds from 2019 to 2026 were held out from the search
entirely and each of three configurations was scored on them exactly once.

| Configuration | Held-out MAE | Held-out within 2x |
|---|---|---|
| Hand-tuned, retired | 1.041 | **50.8%** |
| scikit-learn defaults, shipped | 1.032 | 50.4% |
| Best of 40 on the development folds | **1.020** | 48.8% |

**The search's winner is the worst of the three on the folds it never saw**,
by 1.6 to 2.0 points of hit rate, which is what fitting the folds you were
chosen on looks like from the outside. On this sample the retired hand-tuned
configuration edges the defaults on held-out hit rate and trails on error; on
the previous one it was the other way round. All three sit inside the noise of
eight folds, and that is the point: nothing here was ever a reason to prefer a
tuned model.

The defaults now ship, and every study imports that one definition from
`train.py` rather than carrying its own copy, because six copies is how
"tuned" and "shipped" drifted apart without anyone noticing.

Two honest caveats. Eight held-out folds is a noisy estimate, and every gap in
that table is inside it; the defaults are chosen on principle as much as on the
number. And the held-out folds cover 2019 to 2026, which contains the pandemic
year, so all three configurations score lower here than they do on the full
seventeen.

## What each signal is worth

Measured by removing the group from the full model, which asks what it
contributes alongside everything else.

| Group | Error lost when removed |
|---|---|
| Form: sequel, franchise position, runtime, language | **+0.068** |
| Studio: the distributor and its track record | **+0.022** |
| Cast: the stars' prior grosses | +0.010 |
| Genre | +0.005 |
| Release timing | +0.002 |
| Composer's prior grosses | +0.002 |
| Director's prior grosses | +0.001 |
| Writer's prior grosses | -0.002 |
| Cinematographer's prior grosses | -0.005 |

**The distributor was a finding, and is not.** On 2,505 films the studio group
was significant at p=0.005. Closing a gap in the sampling frame added 22 films,
and on 2,527 it is p=0.19 with an interval containing zero. An effect that
flips on one percent more data was never an effect, and the earlier claim that
"who releases a film carries more information than who made it" is withdrawn
rather than softened. An earlier draft also quoted a "seven times" ratio of
MAE deltas between studio and cast; that was a ratio of two noises.

**Star power contributes almost nothing.** A cast's prior box office barely
predicts the next film's. This is the result most likely to be wrong for an
interesting reason rather than a boring one: prior gross is a crude proxy for
drawing power, and the effect may live in interactions the model can already
see through budget.

**Every person group sits at a hundredth or less.** A caveat those figures
should carry: the director feature is blank for half the sample, and three
quarters of those blanks are veteran directors whose earlier work the sampling
frame cannot see. A feature that merges "first-time director" with "director
we cannot look up" is partly noise, and finding that noise contributes little
is not the same as finding that directors do not matter. A version with the
history widened was built and tested; it is more truthful and scores worse,
which is recorded under Limits.

## Which of these differences are real

Everything above is a point estimate, and the ablation table in particular
invites a reader to rank eight groups by a third-decimal difference in MAE.
Most of those differences are noise. Measured properly they separate into two
groups, and the split is not the one the MAE ordering implies.

The headline metric is binary per film, and both models are scored on the same
films, so the comparison is paired: **McNemar's exact test** on the films the
two models disagree about, and a **paired bootstrap over films** (5,000
resamples) for the size of the effect. Wilcoxon across the 17 folds is reported
alongside and agrees throughout.

| Removed from the full model | Change in hit rate | 95% CI | Discordant films | p (McNemar) |
|---|---|---|---|---|
| **Everything except budget** | **+8.6 pts** | +6.1 to +11.3 | 391 | **<0.0001** |
| **Form** | **+4.4 pts** | +1.9 to +6.7 | 315 | **0.0005** |
| Studio | +1.3 pts | -0.6 to +3.2 | 191 | 0.19 |
| Cast | +1.2 pts | -0.6 to +3.0 | 180 | 0.21 |
| Genre | +0.3 pts | -1.4 to +2.1 | 159 | 0.75 |
| Calendar | +0.3 pts | -1.5 to +1.9 | 148 | 0.81 |
| Composer | -0.1 pts | -1.8 to +1.5 | 154 | 0.94 |
| Director | -0.3 pts | -1.9 to +1.3 | 139 | 0.73 |
| Cinematographer | -0.6 pts | -2.2 to +1.0 | 141 | 0.50 |
| Writer | -1.2 pts | -2.8 to +0.5 | 147 | 0.19 |

**Two of the ten claims survive.** The model genuinely beats budget-only, by
between 6 and 11 points. Form -- sequel status, franchise position, runtime and
language -- is the one group that clears the line on its own.

**Eight do not.** Every group describing the people who made the film --
director, cast, cinematographer, composer, writer -- has a confidence interval
containing zero, and so do the distributor, genre and release timing. That is a
weaker statement than "they contribute nothing" and a more honest one: 2,527
films cannot resolve an effect of one point.

**Studio and genre were significant on the previous sample and are not on this
one.** Studio went from p=0.005 to p=0.19 and genre from p=0.031 to p=0.75 when
22 films arrived. Calendar had already done the same trick the other way on the
sample before that. Effects that cross the line whenever the sample or the
learner moves by a hair are effects of about a point, and a point is what this
sample cannot resolve. None of the three is quoted as a finding.

**The MAE ranking is superseded by this table.** Ordering nine groups by a
quantity whose uncertainty was never computed produced a ranking that partly
reflected noise, and an earlier draft drew conclusions from positions in it.

## The ablation design mattered more than the ablation

Adding each group to a budget-only model makes almost every one of them look
harmful: genre, calendar, cast and cinematographer all raise error. Yet all 38
features together beat budget-only by ten points.

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

| Group removed from the 51-feature model | Change in MAE | Change in within 2x |
|---|---|---|
| All thirteen at once | +0.004 | +0.0 pts |
| Oscar pedigree | +0.008 | -0.2 pts |
| Release competition | -0.010 | +1.5 pts |
| Franchise gap | -0.002 | +0.2 pts |
| Director recency | -0.006 | +0.7 pts |

Every one sits inside noise. Forty percent of the sample has an Academy Award
winner attached, so the feature is neither rare nor thinly covered. Prestige is
simply a different axis from commercial performance, and the model already
knows what it needs about a film's scale from budget and distributor.

### The writer was in the cache the whole time

Writer credits were fetched on the first run and went unused for months. No new
source was needed and no request was spent; the column was simply never wired
into a feature group. It is as pre-release as the director and makes a
different claim about a film, so it was added and tested rather than assumed in
either direction.

It contributes **-1.2 points, 95% CI -2.8 to +0.5, p=0.19**. A fifth
independent group describing who made a film, and a fifth that cannot be
distinguished from noise.

Unlike the thirteen prestige features it keeps its place in the matrix, because
it costs nothing to maintain: the same generic as-of code path, no separate
pipeline, no extra fetch. A fifth null is worth more in the ablation table than
three columns are worth removing.

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
| Metadata, 38 features | 0.921 | 56.0% | - |
| Metadata + synopsis | 0.919 | 55.0% | 5/17 folds |
| Synopsis alone | 1.392 | 32.8% | 0/17 folds |

Adding it is noise. Alone it is barely better than predicting the median film
(32.1%), which is the cleaner statement of the result: **there is almost
nothing about revenue in how a film is described.**

### Career structure does not predict revenue either

The career histories that failed as a source of average grosses carry release
dates for every credit, where they carry revenue for 42%. So a different
feature was built on the dates alone: how long each director, cinematographer
and composer had been working as of the film, how many films they had made,
their pace, the gap they were coming off, and whether that gap was seven years
or more. Eighteen columns at 89 to 93% coverage, against 50% for the earnings
version.

One thing it deliberately does not measure. Whether someone is "no longer
active" needs credits that did not exist on release day; what is knowable on
the day is the gap they are currently coming off, and that is what is used.

| Removed | Change in hit rate | 95% CI | p |
|---|---|---|---|
| All career structure | -1.1 pts | -3.2 to +0.9 | 0.33 |
| Tenure: length, count, pace | -0.3 pts | -2.3 to +1.7 | 0.84 |
| Recency: gap, gap band, returning | -1.0 pts | -2.9 to +0.8 | 0.34 |

None of the three is distinguishable from noise. A seventh feature group
about the people attached to a film, and a seventh with an interval containing
zero.

### Worldwide is not the sum of its parts

The original design argued that worldwide should be the sum of a domestic fit
and an international fit, because the two halves have different drivers. It was
checked rather than left standing, and it loses. Each half is fit in log space
and exponentiated before summing, so two independent errors compound instead of
cancelling, while a direct fit optimises the quantity actually wanted.

Across nine feature groups in the matrix and five ideas built and tested
outside it, the pattern has not varied: **what the film is predicts revenue; who made it, how it is described,
and how its parts are assembled do not.**

## The breakout, on a sample that is no longer biased

Domestic coverage reached 95.6% in September 2026, which changed these numbers
enough that the previous version of this section should be treated as
withdrawn rather than refined.

| Target | Within a factor of 2 (fold mean) |
|---|---|
| Domestic | 52.9% |
| International | 38.4% |
| Worldwide, summed from the two halves | 54.1% |
| **Worldwide, fit directly** | **57.4%** |

15 folds, 2012 to 2026, on 2,345 films with both figures. A domestic gross is now held for 2415 films, 95.6% of the released sample, all of it from OMDb: the Wikidata fallback that carried 164 films at 28% coverage is now entirely redundant and contributes nothing.

**The earlier figures were flattered by the sample, not by the model.** On 686
films the same table read 69.4% domestic and 71.7% worldwide. That sample came
mostly from an existing cache of Oscar-nominated films, which is a set of
prestige titles with unusually predictable performance. Going from 686 films to
2,345 cost roughly fifteen points across the board. Nothing about the method
changed; the population did.

Both conclusions survive the correction. The direct fit still beats summing, by
3.3 points. International is still the harder half, by 14.5 points.

**70 films report a domestic gross larger than their worldwide gross** and are
dropped from the split. That is OMDb and TMDB disagreeing rather than a
reconciliation rule, and it is an open item rather than a solved one.

## There are three kinds of outcome, and the data chose them

The regression target is a continuum, and a continuum is not what a greenlight
conversation deals in. Whether box office falls into natural *kinds* is a
question with an answer, so it was asked: k-means over the two post-release
dimensions, what a film earned and what it earned relative to cost, with
silhouette across k and a bootstrap stability check that re-clusters resampled
data and measures whether pairs of films stay together.

| k | Silhouette | Stability (bootstrap ARI) | Smallest cluster |
|---|---|---|---|
| 2 | **0.521** | 0.889 | 583 |
| **3** | 0.463 | **0.910** | 91 |
| 4 | 0.380 | 0.873 | 67 |
| 7 | 0.338 | 0.678 | 53 |

Past four the structure dissolves: those are cuts through a continuum, not
kinds. Three is the most stable structure in the data, and the three have a
plain business meaning.

| Class | Films | Median budget | Median revenue | Median multiple |
|---|---|---|---|---|
| Write-off | 91 | $12m | $0.2m | **0.03x** |
| Loses money | 928 | $23m | $20m | **0.88x** |
| Profitable | 1,508 | $50m | $155m | **3.33x** |

**Budget is not a clustering dimension, on purpose.** It is knowable months
before release, so a class defined partly by budget is partly free to predict,
and a model asked to predict such a label would be reporting that budget equals
budget. The cross-tab is the reason that matters:

| Budget tier | Write-off | Loses money | Profitable |
|---|---|---|---|
| Under $15m | 10.5% | 52.5% | **37.0%** |
| $15m to $50m | 3.1% | 46.3% | 50.5% |
| Over $50m | 0.5% | 18.6% | **80.9%** |

Budget tier alone moves the profitable rate from 37% to 81%. Predicting that a
$200m tentpole turns a profit is worth nothing against an 81% base rate. The
question with a real answer is which of the sub-$15m films is the 37% that
works, and the section below answers it.

## Can you tell which films will not pay before they open?

The classifier predicts the three outcome classes above from the 38 pre-release
features, scored on the same 17 rolling-origin folds. Three rules keep the
number honest, and each one closes a way this could have scored well and
meant nothing.

**The classes are frozen.** They are the k=3 centroids fitted once on every
released film, so a 2012 fold and a 2026 fold are scored against the same
three definitions. Re-deriving them per fold would let the labels drift with
the training years.

**The opponent is the budget-tier prior, not a coin.** For each film, the
baseline is the class frequencies *of its own budget tier* in the training
years. A model that says "profitable" to every tentpole and "loss" to every
sub-$15m film is already right 65% of the time; beating that is the claim.

**The output is a calibrated probability.** The library-default booster hit
69% accuracy with a log loss *worse* than the prior: a third of films got a
class probability above 0.99 and 8% of those were wrong, and when it said 4%
chance of profit, a quarter turned a profit. Regularised hard and calibrated
by isotonic regression on held-out slices of the training years, it sits on
the diagonal. When it says 60%, about 60% are profitable.

| Predicted P(profit) | Films | Actually profitable |
|---|---|---|
| 0.2 to 0.3 | 78 | 31% |
| 0.3 to 0.4 | 148 | 29% |
| 0.4 to 0.5 | 169 | 43% |
| 0.5 to 0.6 | 180 | 47% |
| 0.6 to 0.7 | 161 | 67% |
| 0.7 to 0.8 | 170 | 74% |
| 0.8 to 0.9 | 192 | 85% |
| 0.9 to 1.0 | 315 | 94% |

One more rule, learned the hard way: **neither side may say "never".**
Isotonic calibration can emit an exact zero, and two such films scored a log
loss of 27 each and dominated the mid-tier interval on the first run. Both
model and prior are floored at one in a thousand, which is the smallest
probability a model trained on two thousand films has any business asserting.

### The result, per tier, with intervals

Paired per film: the difference in log loss between prior and model,
bootstrapped over films for the interval, with a sign test on which of the
two was closer.

| Budget tier | Films | Base rate profit | Log loss, prior | Log loss, model | Improvement | 95% CI | Films model closer | p |
|---|---|---|---|---|---|---|---|---|
| Under $15m | 307 | 40% | 0.953 | **0.873** | +0.080 | +0.036 to +0.123 | 181 of 307 | **0.002** |
| $15m to $50m | 554 | 53% | 0.843 | **0.782** | +0.061 | +0.025 to +0.096 | 346 of 554 | **<0.0001** |
| Over $50m | 587 | 86% | 0.474 | **0.408** | +0.066 | +0.037 to +0.094 | 444 of 587 | **<0.0001** |
| All | 1,448 | 63% | 0.716 | **0.650** | +0.067 | +0.046 to +0.087 | 971 of 1,448 | **<0.0001** |

**The model beats the budget-tier prior in every tier, and every interval is
clear of zero.** That is the first result in this project where a claim about
the features survives at the level of a single budget tier rather than pooled
across all of them.

### The headline: which of the sub-$15m films work

In the tier where the prior is weakest and the question matters most, the
model ranks. Sort the 307 sub-$15m films by predicted probability of profit:

| Quartile by predicted P(profit) | Actually profitable |
|---|---|
| Top quarter | **67%** |
| Bottom quarter | **24%** |
| Tier base rate | 40% |

The prior cannot do this at all: within a tier in any given year it assigns
every film the same number. Three-to-one separation between the model's most
and least confident quarter, from nothing that is not public before release.

### The decision curve

Flag a film as not profitable when its predicted P(profit) falls below a
threshold. At every threshold the model's flags are right more often than
budget tier alone:

| Threshold | Flags | Catches (of unprofitable) | Precision, model | Precision, prior |
|---|---|---|---|---|
| 0.4 | 18% | 36% | **72.8%** | 59.9% |
| 0.5 | 30% | 54% | **66.5%** | 55.3% |
| 0.6 | 42% | 72% | **62.6%** | 51.8% |

Where to sit on that curve is a business decision, not a modelling one. The
gap between the two lines is what thirty-seven other pre-release facts are
worth once the budget is already known: eleven to thirteen points of precision
at any catch rate.

### What it cannot do

**It never calls a write-off.** Fifty-nine of the 1,448 scored films are in
the write-off class, 4%, and neither model nor prior ever predicts it as the
most likely outcome. The model does separate them -- mean P(write-off) of
0.076 on actual write-offs against 0.026 on everything else, three to one --
but never past the point of a call. A class that rare on a sample this size is
detectable and not predictable, and that is the honest statement of the limit
the regression model hit from the other side when it projected nine times
actual in the bottom decile.

**Two thousand films is small**, and the intervals show it: the sub-$15m
result rests on 307 films. The direction is not in doubt. The size is
approximate.

**"Profitable" here means the worldwide gross returned the production budget
at a multiple the clustering found**, which is not the same as the film
having made money. Prints and advertising, exhibitor splits and ancillary
revenue are not in any public dataset. That is the modelling assumption the
whole section rests on, and it is stated rather than assumed.

## The headline number hides where the model fails

A note on which number this is, because there are two and they differ. The
56.0% in the baseline table is the mean across 17 folds, which weights a
38-film year the same as a 116-film one. The figure below pools every scored
film. Both are honest and neither is interchangeable with the other.

57.2% pooled across the 1,447 films with an out-of-sample projection is an
average over five orders of magnitude, and the average is the least useful
thing about it. Split the forecasts into ten buckets by what the film actually
earned:

| Decile | Median actual | Median projected / actual | Within 2x |
|---|---|---|---|
| 1 (smallest) | $1.8M | **9.62** | 16% |
| 2 | $11.9M | 2.19 | 39% |
| 3 | $24.5M | 1.49 | 49% |
| 4 | $44.3M | 1.12 | 63% |
| 5 | $68.9M | 0.96 | 66% |
| 6 | $105.3M | 0.82 | 62% |
| 7 | $152.9M | 0.80 | 63% |
| 8 | $223.9M | 0.73 | 68% |
| 9 | $372.0M | 0.78 | 77% |
| 10 (largest) | $814.6M | 0.67 | 70% |

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

**The sample thins after 2018**, from 114 films a year to between 38 and 80.
Recent folds carry less weight than they appear to, and 2026 is a partial year.

**Career histories are computed inside the sampling frame, and a version that
was not has been built, tested and retired.** The story is worth recording,
because the check that hid the original problem looked like a good one.

Director prior gross used to be present for 50% of films, and that was written
up as half the sample being first-time directors. The evidence offered was that
every blank lined up with a zero prior-film count, which proves only that a
column agrees with its own counter. Cross-checked against IMDb's crew file,
**only 26% of those blanks were genuine first features**. Another 22% had work
only before the 2000 cutoff, and **52% had films released since 2000 that the
distributor and budget frame simply could not see**. `Mission: Impossible II`
was recorded as a debut; its director had made twenty-five features.

The frame is right for deciding which films to predict and was never the right
way to decide what is known about a person. So `pipeline/filmography.py`
fetched the full filmography and grosses for every director, cinematographer
and composer attached to the sample, with the as-of rule unchanged, and
coverage rose from 50% to 79%. It also made the model worse, by one to four
points on every floor and normalisation tried. The most likely reason is that
the blank was carrying information: "nobody attached has a studio track record"
is a real signal about a film's scale, and filling it with a number measured on
a different population destroyed that signal. The wider history is off by
default with that reasoning in the code, and the fetch stays because the
diagnosis it produced led to the target corrections that did help.

Whatever blanks remain are left missing rather than imputed, for the original
reason: a genuine first feature has no track record, and inventing one would
tell the model every debut is average.

**The sample is studio films.** It will not price a microbudget breakout,
because the frame excluded films no distributor picked up.

**The frame missed a studio for six years, and the fix moved a finding.** The
distributor list carried the pre-2020 Fox ids and the post-2020 Searchlight id
and not the post-2020 20th Century Studios id, so every release of that studio
since the rename was absent, *Avatar: The Way of Water* included. Adding it
brought in 22 films and took the studio group from significant to not. The
headline lift and the form result moved by fractions of a point. That is
recorded here because it is the clearest evidence in the project of which
results are robust to the sample and which were riding on it.

**No estimator is meaningfully better than any other here.** Ridge, a random
forest and two boosters land within three points of each other, so the remaining
error is a property of what is knowable before release rather than of the
model. More modelling will not move it.
