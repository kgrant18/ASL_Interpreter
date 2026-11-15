"""Mix local recordings into a dataset manifest (dataset rows are kept unchanged).

Each recorded sign's takes are split by order: every 5th take (#5, #10, ...) -> `ltest`
(held out, reported separately), every 5th offset by two (#3, #8, ...) -> `lval`
(used only for the vocabulary gate), the rest -> `train`. `_IDLE` takes become
`_UNKNOWN` examples with the same split rule.

Optional weighting: `--weight-since YYYY-MM-DD --weight N` repeats the `train` rows of
takes recorded on or after that date N times (e.g. takes from the presenting room), so
batches sample them more often. Held-out rows are never repeated.

Usage:
    python -m training.local_manifest manifest_phrases.csv manifest_phrases_local.csv
"""

from __future__ import annotations

import argparse
from datetime import datetime

import pandas as pd

from app.recordings import INDEX, IDLE
from training.download_clips import DATA_DIR

UNKNOWN = "_UNKNOWN"


def split_for(i: int) -> str:
    return "ltest" if i % 5 == 4 else "lval" if i % 5 == 2 else "train"


def local_rows(index=INDEX, weight_since_ms: int | None = None, weight: int = 1) -> pd.DataFrame:
    rec = pd.read_csv(index).sort_values("created_ms")
    rec["split"] = rec.groupby("label").cumcount().map(split_for)
    out = pd.DataFrame({
        "participant": "local", "video": rec.video,
        "gloss": rec.label, "label": rec.label.replace({IDLE: UNKNOWN}), "split": rec.split,
    })
    if weight_since_ms is not None and weight > 1:
        extra = out[(rec.created_ms >= weight_since_ms).values & (out.split == "train").values]
        out = pd.concat([out] + [extra] * (weight - 1), ignore_index=True)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("out")
    ap.add_argument("--weight-since", default=None, help="YYYY-MM-DD (local time)")
    ap.add_argument("--weight", type=int, default=1)
    args = ap.parse_args()
    since = (int(datetime.strptime(args.weight_since, "%Y-%m-%d").timestamp() * 1000)
             if args.weight_since else None)
    base = pd.read_csv(DATA_DIR / args.base)
    loc = local_rows(weight_since_ms=since, weight=args.weight)
    unknown_labels = set(loc.label) - set(base.label)
    if unknown_labels:
        raise SystemExit(f"recorded labels not in the model's classes: {sorted(unknown_labels)}")
    out = pd.concat([base, loc], ignore_index=True)
    out.to_csv(DATA_DIR / args.out, index=False)
    print(loc.groupby(["label", "split"]).size().unstack(fill_value=0).to_string())
    print(f"-> {args.out}: {len(base)} dataset + {len(loc)} local rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
