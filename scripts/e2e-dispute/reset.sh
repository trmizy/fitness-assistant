#!/usr/bin/env bash
# Wipes ONLY this project (containers, network, its two named volumes), then up + seed. Never touches any other project/volume.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
dc down --volumes --remove-orphans
rm -rf "$HERE/.state"
"$HERE/up.sh"
"$HERE/seed.sh"
