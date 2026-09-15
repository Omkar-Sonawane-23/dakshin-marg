#!/usr/bin/env bash
#
# Dakshin Marg — one-click SIH demo video (Linux / macOS).
#
#   ./make-demo.sh                     full render (~15 min)
#   ./make-demo.sh --short             core acts only
#   ./make-demo.sh --dry               rehearsal: screenshots, no video
#   ./make-demo.sh --only=narration    just (re)generate the voice track
#   ./make-demo.sh --help              every option
#
# First run installs what is missing: node modules, the Python service venv,
# a Chromium to drive, and an ffmpeg to encode with. Nothing is guessed —
# each resolver prints what it found.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 20+ is required but 'node' is not on PATH." >&2
  echo "       Install it from https://nodejs.org and re-run." >&2
  exit 1
fi

export DM_NO_BROWSER_DOWNLOAD=1
exec node tools/demo-video/bin/make-demo.mjs "$@"
