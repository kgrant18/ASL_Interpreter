"""Download only the ASL Citizen videos SignBridge needs, via HTTP range requests.

The full ASL Citizen archive is ~46 GB. Microsoft's server supports byte ranges, so
`remotezip` reads the zip's central directory and fetches individual members.

Data is licensed under the Microsoft Research License Terms (non-commercial research,
no redistribution). Downloaded files live in backend/data/ which is git-ignored.

Usage:
    python -m training.download_clips            # v1: 24 signs + unknown pool
    python -m training.download_clips --glosses training/target_glosses.txt \
        --unknown 2000 --manifest manifest_v2.csv  # v2: 161 sign variants
"""

from __future__ import annotations

import argparse
import random
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
from remotezip import RemoteZip

ZIP_URL = (
    "https://download.microsoft.com/download/b/8/8/"
    "b88c0bae-e6c1-43e1-8726-98cf5af36ca4/ASL_Citizen.zip"
)
DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "asl_citizen"
VIDEO_DIR = DATA_DIR / "videos"

# Candidate vocabulary (ASL Citizen gloss names). Final enabled vocabulary is decided
# after held-out evaluation (see training/evaluate.py and docs/MODEL_DECISION.md).
TARGET_GLOSSES = [
    "HELLO", "THANKYOU", "YES", "NO", "HELP", "PLEASE", "STOP", "AGAIN",
    "UNDERSTAND", "SORRY", "BYE", "NAME", "WHERE", "MORE", "FINISH", "GOOD",
    "NICE", "MEET", "LEARN", "FRIEND", "WATER", "WAIT", "LOVE", "SIGN",
]
# Clips of other signs, used as an explicit "not a supported sign" class.
UNKNOWN_POOL_SIZE = 700
SEED = 13

_local = threading.local()


def _zip() -> RemoteZip:
    if not hasattr(_local, "z"):
        _local.z = RemoteZip(ZIP_URL)
    return _local.z


def build_manifest(targets: list[str] | None = None,
                   unknown_pool: int = UNKNOWN_POOL_SIZE) -> pd.DataFrame:
    targets = targets or TARGET_GLOSSES
    frames = []
    for split in ("train", "val", "test"):
        df = pd.read_csv(DATA_DIR / f"{split}.csv")
        df["split"] = split
        frames.append(df)
    all_df = pd.concat(frames, ignore_index=True)
    all_df = all_df.rename(
        columns={"Participant ID": "participant", "Video file": "video", "Gloss": "gloss"}
    )
    target = all_df[all_df.gloss.isin(targets)].copy()
    target["label"] = target.gloss

    others = all_df[~all_df.gloss.isin(targets)]
    # Sample the unknown pool stratified by split so held-out signers stay held-out.
    rng = random.Random(SEED)
    pool = []
    for split, grp in others.groupby("split"):
        n = int(unknown_pool * len(grp) / len(others))
        idx = rng.sample(list(grp.index), n)
        pool.append(others.loc[idx])
    unk = pd.concat(pool).copy()
    unk["label"] = "_UNKNOWN"
    manifest = pd.concat([target, unk], ignore_index=True)
    return manifest[["participant", "video", "gloss", "label", "split"]]


def fetch(video: str) -> tuple[str, bool, str]:
    out = VIDEO_DIR / video
    if out.exists() and out.stat().st_size > 0:
        return video, True, "cached"
    try:
        data = _zip().read(f"ASL_Citizen/videos/{video}")
        tmp = out.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.rename(out)
        return video, True, f"{len(data) // 1024} KB"
    except Exception as exc:  # network hiccups: report, continue
        return video, False, repr(exc)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--glosses", type=Path, default=None,
                    help="file with one ASL Citizen gloss per line (default: v1 list)")
    ap.add_argument("--unknown", type=int, default=UNKNOWN_POOL_SIZE)
    ap.add_argument("--manifest", default="manifest.csv")
    args = ap.parse_args()

    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    targets = None
    if args.glosses:
        targets = [l.strip() for l in args.glosses.read_text().splitlines() if l.strip()]
    manifest = build_manifest(targets, args.unknown)
    manifest.to_csv(DATA_DIR / args.manifest, index=False)
    print(f"manifest: {len(manifest)} clips "
          f"({(manifest.label != '_UNKNOWN').sum()} target, "
          f"{(manifest.label == '_UNKNOWN').sum()} unknown-pool)")

    failed = []
    with ThreadPoolExecutor(args.workers) as ex:
        futs = [ex.submit(fetch, v) for v in manifest.video]
        for i, f in enumerate(as_completed(futs), 1):
            video, ok, msg = f.result()
            if not ok:
                failed.append(video)
                print(f"FAIL {video}: {msg}", file=sys.stderr)
            if i % 50 == 0:
                print(f"{i}/{len(futs)} done", flush=True)
    print(f"finished; {len(failed)} failed")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
