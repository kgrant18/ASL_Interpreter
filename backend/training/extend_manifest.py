"""Re-target an already-downloaded manifest without reshuffling its _UNKNOWN pool.

Clips of signs dropped from the gloss list become _UNKNOWN (they are genuine other
signs); clips of newly added signs are appended, and any unknown-pool clip of a
now-targeted sign is relabeled to that sign.

Usage:
    python -m training.extend_manifest training/target_glosses_phrases.txt manifest_phrases.csv
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

from training.download_clips import DATA_DIR, parse_glosses

UNKNOWN = "_UNKNOWN"


def main() -> int:
    labels = parse_glosses(Path(sys.argv[1]).read_text().splitlines())
    path = DATA_DIR / sys.argv[2]
    m = pd.read_csv(path)
    m["label"] = [labels.get(g, UNKNOWN) for g in m.gloss]
    frames = []
    for split in ("train", "val", "test"):
        df = pd.read_csv(DATA_DIR / f"{split}.csv")
        df["split"] = split
        frames.append(df)
    all_df = pd.concat(frames, ignore_index=True).rename(
        columns={"Participant ID": "participant", "Video file": "video", "Gloss": "gloss"})
    new = all_df[all_df.gloss.isin(labels) & ~all_df.video.isin(m.video)].copy()
    new["label"] = new.gloss.map(labels)
    out = pd.concat([m, new[m.columns]], ignore_index=True)
    out.to_csv(path, index=False)
    print(f"{len(new)} clips added; {len(out)} total; "
          f"{(out.label == UNKNOWN).sum()} unknown-pool")
    print(out[out.label != UNKNOWN].groupby("label").size().to_dict())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
