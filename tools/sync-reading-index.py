#!/usr/bin/env python3
"""Copy each passage's `grammar` array into content/reading/index.json.

The reading list needs to say which chapters a passage leans on before
the passage itself is fetched, so the index carries a copy. This writes
that copy. `tools/check-reading.py` fails if the two ever disagree.

`tools/build-reading-index.py` rebuilds the whole index and already
carries the grammar across; this one touches nothing else, so it is the
safe thing to run after editing a passage.

Run:  python3 tools/sync-reading-index.py
"""

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READING = os.path.join(ROOT, "content", "reading")
INDEX = os.path.join(READING, "index.json")


def main():
    with io.open(INDEX, encoding="utf-8") as fh:
        index = json.load(fh)

    changed = []
    for entry in index["passages"]:
        path = os.path.join(READING, entry["file"])
        if not os.path.exists(path):
            print("skipping %s: no file" % entry["id"])
            continue
        with io.open(path, encoding="utf-8") as fh:
            grammar = json.load(fh).get("grammar", [])
        if entry.get("grammar") != grammar:
            entry["grammar"] = grammar
            changed.append(entry["id"])

    with io.open(INDEX, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(index, ensure_ascii=False, indent=1) + "\n")

    if changed:
        print("updated %d: %s" % (len(changed), ", ".join(changed)))
    else:
        print("index already matches the passages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
