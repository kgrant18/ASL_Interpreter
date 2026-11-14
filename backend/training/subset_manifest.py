"""Build a curated-vocabulary manifest from manifest_v2.csv (no new downloads).

Clips of the listed signs keep their labels; the generic other-sign pool stays
`_UNKNOWN`; clips of the *excluded* v2 signs are dropped. (Keeping excluded
look-alikes as negatives made HELLO/LEARN/MEET hedge toward "unknown" on
validation signers, so v3 drops them; see docs/EVALUATION_v3.md.)

Usage:
    python -m training.subset_manifest training/target_glosses_v3.txt manifest_v3.csv
"""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "asl_citizen"


def read_glosses(path: Path) -> list[str]:
    return [w for line in path.read_text().splitlines() if not line.startswith("#") for w in line.split()]


def main() -> int:
    glosses = read_glosses(Path(sys.argv[1]))
    m = pd.read_csv(DATA / "manifest_v2.csv")
    missing = set(glosses) - set(m.label)
    if missing:
        raise SystemExit(f"not in manifest_v2: {sorted(missing)}")
    out = m[m.label.isin(glosses) | (m.label == "_UNKNOWN")]
    out.to_csv(DATA / sys.argv[2], index=False)
    print(f"{len(glosses)} signs, {len(out)} clips -> {sys.argv[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
