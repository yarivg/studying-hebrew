#!/usr/bin/env python3
"""Check the reading passages against content/reading/SCHEMA.md.

Run:  python3 tools/check-reading.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
READING = os.path.join(ROOT, "content", "reading")
MANIFEST = os.path.join(ROOT, "content", "manifest.json")

# Hebrew is denser than French: no articles to write separately, prefixes
# glued on, and a pronoun folded into the verb. The same reading load is
# fewer words on the page, so the ranges are lower than the French ones.
WORDS = {"A1": (60, 100), "A2": (100, 150), "B1": (150, 220), "B2": (220, 300)}
# Reading order of the levels, so a passage can be checked against the level
# of every chapter it says it exercises. "ref" is Part IV, which teaches
# nothing new and is therefore available at any level.
ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "ref": 0}
# A chapter of the serial runs longer than a standalone passage of its level.
STORY_WORDS = (350, 450)
QTYPES = {"mcq", "fill", "open"}

# The same set hebrew.js strips.
MARKS = re.compile("[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]")
# A Hebrew word: letters, plus the geresh and gershayim that sit inside
# abbreviations and loanwords. Python's \w does not match the combining
# points, so counting with it would split every pointed word in two.
WORD_RE = re.compile("[\u05D0-\u05EA][\u05D0-\u05EA\u05F3\u05F4'\"-]*")

problems = []
warnings = []


def bad(name, msg):
    problems.append("%s: %s" % (name, msg))


def warn(name, msg):
    warnings.append("%s: %s" % (name, msg))


def strip_nikud(s):
    return MARKS.sub("", str(s))


def count_words(text):
    return len(WORD_RE.findall(strip_nikud(text)))


def has_nikud(s):
    return bool(MARKS.search(str(s)))


def check(path, slugs):
    name = os.path.basename(path)
    with open(path, encoding="utf-8") as fh:
        try:
            p = json.load(fh)
        except ValueError as e:
            bad(name, "not valid JSON: %s" % e)
            return None

    if p.get("id") != name[:-5]:
        bad(name, "id %r does not match the filename" % p.get("id"))
    if p.get("level") not in WORDS:
        bad(name, "level %r is not A1/A2/B1/B2" % p.get("level"))
        return p
    for field in ("title", "blurb", "text"):
        if not str(p.get(field, "")).strip():
            bad(name, "empty %s" % field)

    for slug in p.get("grammar", []):
        if slug not in slugs:
            bad(name, "grammar slug %r is not a chapter" % slug)
        # A passage may not lean on a chapter the reader has not reached.
        # The chapter's own level is the test: an A1 passage naming a B1
        # chapter is asking for grammar the course has not taught yet.
        elif ORDER.get(slugs[slug], 99) > ORDER.get(p["level"], 0):
            bad(name, "grammar slug %r is a %s chapter, above this passage's %s"
                % (slug, slugs[slug], p["level"]))

    n = count_words(p.get("text", ""))
    lo, hi = STORY_WORDS if p["id"].startswith("story-") else WORDS[p["level"]]
    if not lo <= n <= hi:
        bad(name, "%d words, outside the %s range %d-%d" % (n, p["level"], lo, hi))

    # Every line has to be worth hearing on its own.
    for line in [l for l in p.get("text", "").split("\n") if l.strip()]:
        if count_words(line) > 25:
            bad(name, "a line is %d words long; split it" % count_words(line))
        elif not has_nikud(line):
            warn(name, "a line has no nikud: %r" % line[:40])

    aloud = p.get("aloud") or []
    if not 1 <= len(aloud) <= 2:
        bad(name, "needs one or two `aloud` lines, has %d" % len(aloud))
    for line in aloud:
        if not 3 <= count_words(line) <= 10:
            bad(name, "aloud line %r must be 3-10 words" % line)
        if line not in p.get("text", ""):
            bad(name, "aloud line %r is not in the passage" % line)
        # Read back to the recogniser, so the model reading has to be right.
        if not has_nikud(line):
            bad(name, "aloud line %r has no nikud" % line)

    qs = p.get("questions") or []
    # A chapter of the serial is longer than a standalone passage and carries
    # one more question, which is what content/reading/SCHEMA.md asks for.
    hi = 8 if p["id"].startswith("story-") else 7
    if not 5 <= len(qs) <= hi:
        bad(name, "needs 5-%d questions, has %d" % (hi, len(qs)))
    seen = set()
    for q in qs:
        qid = q.get("id", "?")
        if qid in seen:
            bad(name, "duplicate question id %r" % qid)
        seen.add(qid)
        if q.get("type") not in QTYPES:
            bad(name, "%s: type %r not allowed in a passage" % (qid, q.get("type")))
            continue
        if not str(q.get("why", "")).strip():
            bad(name, "%s: empty why" % qid)
        if q["type"] == "mcq":
            ch = q.get("choices") or []
            if not 2 <= len(ch) <= 5 or not isinstance(q.get("a"), int) \
                    or not 0 <= q["a"] < len(ch):
                bad(name, "%s: bad mcq" % qid)
        else:
            a = q.get("a")
            if not isinstance(a, list) or not a or not str(a[0]).strip():
                bad(name, "%s: needs an answer array" % qid)
    if qs and qs[-1].get("type") != "open":
        bad(name, "the last question should be `open`")

    return p


def main():
    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    # slug -> the level of the chapter, so a passage can be checked against it
    slugs = {c["slug"]: c.get("level", "A1")
             for p in manifest["parts"] for c in p["chapters"]}

    # A leading underscore marks a working file, not a passage: the index is
    # assembled from those, and they are not passages to check.
    files = sorted(f for f in os.listdir(READING)
                   if f.endswith(".json") and f != "index.json" and not f.startswith("_"))
    passages = [check(os.path.join(READING, f), slugs) for f in files]
    passages = [p for p in passages if p]

    index_path = os.path.join(READING, "index.json")
    if not os.path.exists(index_path):
        bad("index.json", "missing")
    else:
        with open(index_path, encoding="utf-8") as fh:
            listed = json.load(fh).get("passages", [])
        listed_ids = [e.get("id") for e in listed]
        for p in passages:
            if p["id"] not in listed_ids:
                bad("index.json", "does not list %s" % p["id"])
        for e in listed:
            if not os.path.exists(os.path.join(READING, e.get("file", ""))):
                bad("index.json", "lists %s, which has no file" % e.get("id"))
            if not str(e.get("blurb", "")).strip():
                bad("index.json", "%s has an empty blurb" % e.get("id"))

    print("%d passages checked" % len(passages))
    for p in passages:
        print("  %-30s %s  %3d words  %d questions" %
              (p["id"], p["level"], count_words(p["text"]), len(p.get("questions") or [])))

    if warnings:
        print("\n%d warnings:" % len(warnings))
        for w in warnings:
            print("  warning: " + w)

    if problems:
        print("\n%d problems:" % len(problems))
        for x in problems:
            print("  " + x)
        return 1
    print("\nno problems")
    return 0


if __name__ == "__main__":
    sys.exit(main())
