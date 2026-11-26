#!/usr/bin/env bash
# Matching on this computer, tried on a real library without changing it
# (round 11, P2a). Builds IMDb's list of titles from the two real files (about
# 240 MB downloaded, not kept), copies the library read-only, looks every title
# matched online up in the list the way the app does, and decides with the
# app's own rules: right / wrong / Needs attention against the IMDb id the
# online match holds. The report has film names in it: it stays in SCRATCH.
#
#   scripts/proof/offline-match-dryrun.sh SCRATCH [LIBRARY_DB]
#
# LIBRARY_DB defaults to the app's own (%APPDATA%/com.kinema.app/library.db on
# Windows, ~/.local/share/com.kinema.app/library.db on Linux). A list already
# in SCRATCH/imdb-titles.db is used again; delete it to build a fresh one.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
scratch="$(cd "${1:?a scratch folder}" && pwd)"
library="${2:-${APPDATA:+$APPDATA/com.kinema.app/library.db}}"
library="${library:-$HOME/.local/share/com.kinema.app/library.db}"
py=$(command -v py || command -v python3)

# A consistent copy even while the app runs (its WAL included), opened read-only.
"$py" -c 'import sqlite3,sys
src = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2]); src.backup(dst); dst.close()' "$library" "$scratch/library-copy.db"

export IMDB_TITLES_OUT="$scratch/imdb-titles.db" IMDB_TITLES_DB="$scratch/imdb-titles.db"
export DRYRUN_LIBRARY="$scratch/library-copy.db" DRYRUN_OUT="$scratch/dryrun.json"
export DRYRUN_JSON="$scratch/dryrun.json" DRYRUN_REPORT="$scratch/dryrun-report.txt"
cd "$here/src-tauri"
if [ ! -f "$IMDB_TITLES_DB" ]; then
  cargo test --lib imdb_titles::tests::builds_from_the_real_files -- --ignored --nocapture 2>&1 | grep -E "kept|test result"
fi
cargo test --lib imdb_titles::tests::dry_run_candidates -- --ignored --nocapture 2>&1 | grep -E "looked up|test result"
cd "$here"
npx vitest run src/metadata/imdbDryRun.test.ts 2>&1 | grep -E "groups|Tests|FAIL" || true
echo "report: $DRYRUN_REPORT"
