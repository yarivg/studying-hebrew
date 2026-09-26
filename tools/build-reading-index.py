#!/usr/bin/env python3
"""Assemble content/reading/index.json from the passages on disk.

The index is a list, and the order it is written in is the order the reading
page groups by level and then shows. Rather than hand-maintaining it, this
reads every passage file and writes the index from what is actually there, so
a passage can never be listed and missing, or present and unlisted.

Each passage supplies its own title, level and blurb. A `_index-*.json` file
left behind by a writing pass is used only for its blurbs, since a blurb is
about the passage rather than in it, and is deleted once it has been read.

Run:  python3 tools/build-reading-index.py
"""

import glob
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READING = os.path.join(ROOT, "content", "reading")

LEVELS = ["A1", "A2", "B1", "B2"]


def main():
    # Blurbs handed over by a writing pass, keyed by passage id.
    blurbs = {}
    sidecars = sorted(glob.glob(os.path.join(READING, "_index-*.json")))
    for path in sidecars:
        try:
            doc = json.load(io.open(path, encoding="utf-8"))
        except ValueError as e:
            print("skipping %s: %s" % (os.path.basename(path), e))
            continue
        for entry in doc.get("passages", []):
            if entry.get("id") and entry.get("blurb"):
                blurbs[entry["id"]] = entry["blurb"]

    entries = []
    for path in sorted(glob.glob(os.path.join(READING, "*.json"))):
        name = os.path.basename(path)
        if name == "index.json" or name.startswith("_"):
            continue
        p = json.load(io.open(path, encoding="utf-8"))
        pid = p.get("id") or name[:-5]
        entries.append({
            "id": pid,
            "file": name,
            "title": p.get("title", ""),
            "level": p.get("level", "A1"),
            # The passage's own blurb wins; a sidecar fills a gap.
            "blurb": p.get("blurb") or blurbs.get(pid, ""),
            # Carried into the index so the reading list can say which
            # chapters a passage needs without fetching the passage.
            "grammar": p.get("grammar", []),
        })

    # Standalone passages by level, then the serial in chapter order. The
    # serial is grouped by level on the page like everything else, so the
    # ordering here is only about which of two passages at one level is first.
    def sort_key(e):
        story = e["id"].startswith("story-")
        level = LEVELS.index(e["level"]) if e["level"] in LEVELS else len(LEVELS)
        return (1 if story else 0, level if not story else 0, e["id"])

    entries.sort(key=sort_key)

    io.open(os.path.join(READING, "index.json"), "w", encoding="utf-8").write(
        json.dumps({"passages": entries}, ensure_ascii=False, indent=1) + "\n")

    missing = [e["id"] for e in entries if not e["blurb"]]
    print("wrote content/reading/index.json with %d passages" % len(entries))
    for level in LEVELS:
        n = len([e for e in entries if e["level"] == level])
        if n:
            print("  %s: %d" % (level, n))
    n = len([e for e in entries if e["id"].startswith("story-")])
    if n:
        print("  of which %d are chapters of the serial" % n)

    if missing:
        print("\n%d passages have no blurb:" % len(missing))
        for m in missing:
            print("  " + m)
        return 1

    for path in sidecars:
        os.remove(path)
        print("  removed %s" % os.path.basename(path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
