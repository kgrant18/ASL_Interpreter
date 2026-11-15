"""Train the SignGRU landmark classifier on ASL Citizen clips.

Splits are ASL Citizen's official *signer-independent* splits:
  train (35 signers) -> fitting
  val   (6 signers)  -> checkpoint selection
  test  (11 signers) -> reported once in training/evaluate.py

Usage:
    python -m training.train --epochs 80
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.recognition.model import SignGRU  # noqa: E402
from app.vision.normalization import FEATURE_DIM, SEQ_LEN  # noqa: E402
from training.windows import (  # noqa: E402
    LIVE_WINDOW_S, UNKNOWN, augment, central_window, load_clips, sample_window,
)

MANIFEST = ROOT / "data" / "asl_citizen" / "manifest.csv"
OUT = ROOT / "models" / "signgru.pt"


def make_batch(clips, labels_idx, rng, n, unk_frac=0.25, partial_frac=0.08):
    """Class-balanced batch: each target class equally likely; unknown ~unk_frac."""
    by_label: dict[str, list] = {}
    for c in clips:
        by_label.setdefault(c.label, []).append(c)
    targets = [k for k in by_label if k != UNKNOWN]
    xs, ys = [], []
    unk_idx = labels_idx[UNKNOWN]
    for _ in range(n):
        r = rng.random()
        if r < unk_frac:
            c = by_label[UNKNOWN][rng.integers(len(by_label[UNKNOWN]))]
            x, y = sample_window(c, rng), unk_idx
        elif r < unk_frac + partial_frac:
            lab = targets[rng.integers(len(targets))]
            c = by_label[lab][rng.integers(len(by_label[lab]))]
            x, y = sample_window(c, rng, partial=True), unk_idx
        else:
            lab = targets[rng.integers(len(targets))]
            c = by_label[lab][rng.integers(len(by_label[lab]))]
            x, y = sample_window(c, rng), labels_idx[lab]
        xs.append(augment(x, rng))
        ys.append(y)
    return torch.from_numpy(np.stack(xs)), torch.tensor(ys)


@torch.no_grad()
def evaluate_central(model, clips, labels_idx, device):
    model.eval()
    x = torch.from_numpy(np.stack([central_window(c) for c in clips])).to(device)
    y = torch.tensor([labels_idx[c.label] for c in clips]).to(device)
    pred = model(x).argmax(-1)
    # balanced accuracy: mean per-class recall (unknown clips would dominate otherwise)
    recalls = [(pred[y == k] == k).float().mean().item() for k in y.unique()]
    return float(np.mean(recalls))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--steps", type=int, default=40)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--manifest", default="manifest.csv")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--hidden", type=int, default=128)
    ap.add_argument("--proj", type=int, default=192)
    ap.add_argument("--init", default=None,
                    help="fine-tune: start from this checkpoint (same labels required)")
    ap.add_argument("--val-splits", default="val",
                    help="comma-separated splits used for checkpoint selection")
    ap.add_argument("--device", default="auto", help="auto (cuda > mps > cpu) | cuda | mps | cpu")
    args = ap.parse_args()
    out_path = Path(args.out)

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    device = args.device
    if device == "auto":
        device = ("cuda" if torch.cuda.is_available()
                  else "mps" if torch.backends.mps.is_available() else "cpu")
    print("device:", device)

    t0 = time.time()
    clips = load_clips(ROOT / "data" / "asl_citizen" / args.manifest)
    print(f"loaded {len(clips)} usable clips in {time.time() - t0:.1f}s")
    labels = sorted({c.label for c in clips if c.label != UNKNOWN}) + [UNKNOWN]
    labels_idx = {k: i for i, k in enumerate(labels)}
    train = [c for c in clips if c.split == "train"]
    val_splits = set(args.val_splits.split(","))
    val = [c for c in clips if c.split in val_splits]
    print(f"train={len(train)} val={len(val)} classes={len(labels)}")

    init = torch.load(args.init, map_location="cpu", weights_only=False) if args.init else None
    if init is not None:
        if init["labels"] != labels:
            raise SystemExit(f"--init labels differ: {init['labels']} vs {labels}")
        args.hidden, args.proj = init.get("hidden", 128), init.get("proj", 192)
    model = SignGRU(FEATURE_DIM, len(labels), hidden=args.hidden, proj=args.proj).to(device)
    if init is not None:
        model.load_state_dict(init["state_dict"])
        print(f"fine-tuning from {args.init}")
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-2)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, total_steps=args.epochs * args.steps)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.1)

    best, best_state = -1.0, None
    for ep in range(args.epochs):
        model.train()
        tot = 0.0
        for _ in range(args.steps):
            x, y = make_batch(train, labels_idx, rng, args.batch)
            x, y = x.to(device), y.to(device)
            loss = loss_fn(model(x), y)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            tot += loss.item()
        acc = evaluate_central(model, val, labels_idx, device)
        if acc >= best:
            best = acc
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
        if ep % 5 == 0 or ep == args.epochs - 1:
            print(f"epoch {ep:3d} loss {tot / args.steps:.3f} val_central_acc {acc:.3f} "
                  f"best {best:.3f}", flush=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "hidden": args.hidden,
        "proj": args.proj,
        "manifest": args.manifest,
        "state_dict": best_state,
        "labels": labels,
        "feature_dim": FEATURE_DIM,
        "seq_len": SEQ_LEN,
        "window_s": LIVE_WINDOW_S,
        "arch": "SignGRU",
        "version": time.strftime("%Y%m%d-%H%M"),
        "train_info": {
            "dataset": ("ASL Citizen (Microsoft Research) plus supplementary signer recordings"
                        if any(c.participant == "local" for c in train) else
                        "ASL Citizen (Microsoft Research), official signer-independent splits"),
            "train_clips": len(train), "val_clips": len(val),
            "local_train_clips": sum(c.participant == "local" for c in train),
            "init": Path(args.init).name if args.init else None,
            "val_central_acc": best, "epochs": args.epochs, "seed": args.seed,
        },
    }, out_path)
    print(f"saved {out_path} (best val central acc {best:.3f})")
    out_path.with_name(out_path.stem + "_labels.json").write_text(json.dumps(labels, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
