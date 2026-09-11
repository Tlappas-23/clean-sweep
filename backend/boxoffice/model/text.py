"""
Does the marketing synopsis predict box office beyond what the metadata says?

The text is the studio's own logline, present before release for every film in
the sample and every film on the slate (see `pipeline.synopsis` for why that
source and not a Wikipedia plot summary).

The evaluation keeps the project's as-of rule, which for text means something
specific: **the vectorizer is fitted inside each fold, on training documents
only.** Fitting one vocabulary across the whole corpus would let a 2012 fold's
representation be shaped by words that only entered the language of film
marketing in 2020. That is a weaker leak than using the target, but it is the
same kind of mistake, and it is the one text features usually make.

Three arms on identical folds:

* the 35 metadata features, which is what ships;
* those plus the synopsis;
* the synopsis alone, which bounds how much is in the text at all.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.feature_extraction.text import TfidfVectorizer

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from boxoffice.model.train import FEATURES, _within_2x, feature_columns, model

DATA = Path(FEATURES).parent
OUT = DATA / "text_ablation.csv"
COMPONENTS = 32


def _model() -> HistGradientBoostingRegressor:
    return model()


def _text_block(train_docs: pd.Series, test_docs: pd.Series) -> tuple[np.ndarray, np.ndarray]:
    """Fold-local TF-IDF reduced to dense components, plus two length scalars.

    Length is offered separately because it is the crude version of the same
    idea: a longer synopsis may simply mean a film someone cared enough to
    describe. If the group carries anything, it matters whether it is the
    language or just the word count.
    """
    vec = TfidfVectorizer(min_df=3, ngram_range=(1, 2), sublinear_tf=True,
                          stop_words="english", max_features=20_000)
    tr = vec.fit_transform(train_docs)
    te = vec.transform(test_docs)

    svd = TruncatedSVD(n_components=COMPONENTS, random_state=0)
    tr_d = svd.fit_transform(tr)
    te_d = svd.transform(te)

    def scalars(docs):
        return np.c_[docs.str.len().to_numpy(), docs.str.split().str.len().to_numpy()]

    return np.c_[tr_d, scalars(train_docs)], np.c_[te_d, scalars(test_docs)]


def run(first_year: int = 2010) -> pd.DataFrame:
    frame = pd.read_parquet(FEATURES)
    syn = pd.read_parquet(DATA / "synopsis.parquet")
    frame = frame.merge(syn[["imdb_id", "overview"]], on="imdb_id", how="left")
    frame["overview"] = frame["overview"].fillna("")

    frame = frame[~frame["is_upcoming"].fillna(False).astype(bool)]
    frame = frame.sort_values("release_date")

    # Read the feature list off the matrix before anything is added to it. The
    # bookkeeping column below is numeric and not in META, so computing `cols`
    # after it exists silently makes release year a 36th feature. That is worse
    # than it sounds: every fold tests on a year the model has never seen, so a
    # split on it sends the whole test set down one branch.
    cols = feature_columns(frame)
    frame["year"] = frame["release_date"].dt.year

    rows: list[dict] = []
    for year in sorted(y for y in frame["year"].unique() if y >= first_year):
        train = frame[frame["year"] < year]
        test = frame[frame["year"] == year]
        if len(train) < 200 or len(test) < 20:
            continue

        y_tr = train["y_log_worldwide"].to_numpy()
        y_te = test["y_log_worldwide"].to_numpy()
        x_tr = train[cols].to_numpy(dtype="float64")
        x_te = test[cols].to_numpy(dtype="float64")
        t_tr, t_te = _text_block(train["overview"], test["overview"])

        arms = {
            f"metadata ({len(cols)})": (x_tr, x_te),
            "metadata + synopsis": (np.c_[x_tr, t_tr], np.c_[x_te, t_te]),
            "synopsis only": (t_tr, t_te),
        }
        for name, (a, b) in arms.items():
            pred = _model().fit(a, y_tr).predict(b)
            rows.append({"arm": name, "year": year, "n_test": len(test),
                         "mae_log": float(np.mean(np.abs(pred - y_te))),
                         "within_2x": _within_2x(y_te, pred)})
        print(f"  {year} done", flush=True)

    out = pd.DataFrame(rows)
    out.to_csv(OUT, index=False)
    return out


def summarise(folds: pd.DataFrame) -> pd.DataFrame:
    meta = next(a for a in folds.arm.unique() if a.startswith("metadata ("))
    base = folds[folds.arm == meta].set_index("year")
    rows = []
    for name in (meta, "metadata + synopsis", "synopsis only"):
        block = folds[folds.arm == name].set_index("year")
        rows.append({
            "arm": name,
            "mae_log": block.mae_log.mean(),
            "within_2x": block.within_2x.mean(),
            "d_mae": block.mae_log.mean() - base.mae_log.mean(),
            "d_2x": block.within_2x.mean() - base.within_2x.mean(),
            "folds_better": "-" if name == meta else
                            f"{int((block.within_2x > base.within_2x).sum())}/{len(block)}",
        })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    print(summarise(run()).to_string(index=False, float_format=lambda v: f"{v:+.3f}"))
