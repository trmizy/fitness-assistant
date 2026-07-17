#!/usr/bin/env bash
# Run this ON the RunPod pod (not locally) after cloning/syncing the repo.
# Creates an isolated training venv and installs training/requirements.txt.
# See training/RUNPOD_RUNBOOK.md for the full step-by-step launch process.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venv-train"

echo "== Checking for a CUDA-visible GPU =="
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi not found — this does not look like a GPU pod. Aborting." >&2
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

echo "== Creating venv at ${VENV_DIR} =="
python3 -m venv "${VENV_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

echo "== Installing training/requirements.txt =="
pip install --upgrade pip
pip install -r "${REPO_ROOT}/training/requirements.txt"

echo "== Verifying torch sees the GPU =="
python3 -c "import torch; assert torch.cuda.is_available(), 'CUDA not available inside venv'; print('CUDA OK:', torch.cuda.get_device_name(0))"

echo
echo "Setup complete. Activate with:"
echo "  source ${VENV_DIR}/bin/activate"
echo "Next: run the smoke test in training/RUNPOD_RUNBOOK.md before a full training run."
