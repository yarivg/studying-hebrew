#!/bin/sh
# Every check this repo has, in the order that fails fastest.
#
# Run from the repo root:  sh tools/check-all.sh
#
# Exits non-zero if any of them does, so it works as a pre-commit gate.

set -e
cd "$(dirname "$0")/.."

fail=0
run() {
  printf '\n== %s\n' "$1"
  shift
  if ! "$@"; then fail=1; fi
}

printf '== javascript syntax\n'
for f in assets/*.js sw.js; do
  node --check "$f" || fail=1
done
echo "  $(ls assets/*.js sw.js | wc -l | tr -d ' ') files"

run "vocabulary"        python3 tools/build-vocab.py
run "hebrew"            python3 tools/check-hebrew.py
run "test banks"        python3 tools/check-tests.py
run "bank grading"      node tools/check-grading.js
run "reading passages"  python3 tools/check-reading.py
run "gloss lookup"      node tools/check-gloss.js
run "speech scoring"    node tools/check-speech.js

if [ "$fail" != "0" ]; then
  printf '\nsomething failed\n'
  exit 1
fi
printf '\neverything passes\n'
