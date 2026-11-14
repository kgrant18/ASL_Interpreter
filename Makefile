PY := backend/.venv/bin/python

.PHONY: setup dev test test-backend test-frontend build check train download landmarks fit evaluate demo

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

demo:             ## real-inference replay of held-out test-signer clips (backend must be running)
	./scripts/run_demo.sh
