"""Mix local recordings into a dataset manifest (dataset rows are kept unchanged).

Each recorded sign's takes are split by order: every 5th take (#5, #10, ...) -> `ltest`
(held out, reported separately), every 5th offset by two (#3, #8, ...) -> `lval`
(used only for the vocabulary gate), the rest -> `train`. `_IDLE` takes become
`_UNKNOWN` examples with the same split rule.

Usage:
    python -m training.local_manifest manifest_phrases.csv manifest_phrases_local.csv
"""

from __future__ import annotations

import sys

import pandas as pd

from app.recordings import INDEX, IDLE
from training.download_clips import DATA_DIR

UNKNOWN = "_UNKNOWN"


def split_for(i: int) -> str:
    return "ltest" if i % 5 == 4 else "lval" if i % 5 == 2 else "train"


def local_rows(index=INDEX) -> pd.DataFrame:
    rec = pd.read_csv(index).sort_values("created_ms")
    rec["split"] = rec.groupby("label").cumcount().map(split_for)
    return pd.DataFrame({
        "participant": "local", "video": rec.video,
        "gloss": rec.label, "label": rec.label.replace({IDLE: UNKNOWN}), "split": rec.split,
    })


def main() -> int:
    base = pd.read_csv(DATA_DIR / sys.argv[1])
    loc = local_rows()
    unknown_labels = set(loc.label) - set(base.label)
    if unknown_labels:
        raise SystemExit(f"recorded labels not in the model's classes: {sorted(unknown_labels)}")
    out = pd.concat([base, loc], ignore_index=True)
    out.to_csv(DATA_DIR / sys.argv[2], index=False)
    print(loc.groupby(["label", "split"]).size().unstack(fill_value=0).to_string())
    print(f"-> {sys.argv[2]}: {len(base)} dataset + {len(loc)} local rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
