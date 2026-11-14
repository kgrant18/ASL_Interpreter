# Demo assets

`sample_clips/` is intentionally empty. ASL Citizen clips may not be redistributed, so they are never committed.

For a camera-free, **real-inference** demo, use the held-out test-signer clips that `make train` downloads to `backend/data/` (local only):

```bash
./scripts/dev.sh          # terminal 1
make demo                 # terminal 2: streams clips through the live backend
./scripts/run_demo.sh HELLO WATER SORRY _UNKNOWN   # choose signs
```

You can also stream any recording you made yourself (with the signer's consent):

```bash
backend/.venv/bin/python scripts/replay_clip.py my_signing.mp4
```

See [../docs/DEMO_GUIDE.md](../docs/DEMO_GUIDE.md) for the 3-minute script.
