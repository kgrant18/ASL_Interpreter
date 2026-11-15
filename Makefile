PY := backend/.venv/bin/python

.PHONY: setup dev test test-backend test-frontend build check train download landmarks fit evaluate train-v2 train-v3 train-phrases demo

setup:            ## install everything
	./scripts/setup.sh

dev:              ## run backend + frontend
	./scripts/dev.sh

test: test-backend test-frontend

test-backend:
	cd backend && .venv/bin/python -m pytest -q tests

test-frontend:
	cd frontend && npx vitest run

build:
	cd frontend && npm run build

check:
	$(PY) scripts/check_environment.py

# ---- model pipeline (ASL Citizen, Microsoft Research License: non-commercial research) ----
train: download landmarks fit evaluate

download:         ## ~1.4k clips (~800 MB) via HTTP range requests
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.download_clips

landmarks:        ## MediaPipe landmark extraction (multi-process)
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.prepare_data --workers 12

fit:
	cd backend && .venv/bin/python -m training.train --epochs 80

evaluate:
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.evaluate

train-v2:         ## 161-sign 5-model ensemble (~7k clips, ~4 GB, ~1.5 h); writes signgru_v2.* (run with SIGNBRIDGE_MODEL=v2)
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.download_clips --glosses training/target_glosses.txt --unknown 2000 --manifest manifest_v2.csv --workers 16
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.prepare_data --manifest manifest_v2.csv --workers 20
	cd backend && .venv/bin/python -m training.train --manifest manifest_v2.csv --out models/signgru_v2.pt --hidden 192 --proj 256 --epochs 120 --steps 60
	cd backend && for s in 1 2 3 4; do .venv/bin/python -m training.train --manifest manifest_v2.csv --out models/signgru_v2_s$$s.pt --hidden 192 --proj 256 --epochs 120 --steps 60 --seed $$s; done
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.evaluate --manifest manifest_v2.csv --weights models/signgru_v2.pt --ensemble --threshold 0.6 --eval-out models/signgru_v2_eval.json --doc-out ../docs/EVALUATION_v2.md

train-v3:         ## 51-sign curated model from the v2 data (needs `make train-v2` data; ~6 min); run with SIGNBRIDGE_MODEL=v3
	cd backend && .venv/bin/python -m training.subset_manifest training/target_glosses_v3.txt manifest_v3.csv
	cd backend && .venv/bin/python -m training.train --manifest manifest_v3.csv --out models/signgru_v3.pt --hidden 192 --proj 256 --epochs 100 --steps 60
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.evaluate --manifest manifest_v3.csv --weights models/signgru_v3.pt --threshold 0.7 --eval-out models/signgru_v3_eval.json --doc-out ../docs/EVALUATION_v3.md

train-phrases:    ## default model: phrase signs + 1.5k other-sign pool (~2k clips, ~1.1 GB, ~30-45 min on an M-series Mac)
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.download_clips --glosses training/target_glosses_phrases.txt --unknown 1500 --manifest manifest_phrases.csv --workers 12
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.prepare_data --manifest manifest_phrases.csv --workers 8
	cd backend && .venv/bin/python -m training.train --manifest manifest_phrases.csv --out models/signgru_phrases.pt --epochs 80
	cd backend && GLOG_minloglevel=2 .venv/bin/python -m training.evaluate --manifest manifest_phrases.csv --weights models/signgru_phrases.pt --eval-out models/signgru_phrases_eval.json --doc-out ../docs/EVALUATION_phrases.md

demo:             ## real-inference replay of held-out test-signer clips (backend must be running)
	./scripts/run_demo.sh
