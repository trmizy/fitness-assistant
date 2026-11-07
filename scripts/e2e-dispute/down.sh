#!/usr/bin/env bash
# Stops and removes the containers + network of project gymini-e2e-dispute. KEEPS the database/evidence volumes (use reset.sh to wipe).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
dc down --remove-orphans
