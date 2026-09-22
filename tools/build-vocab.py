#!/usr/bin/env python3
"""Turn data/vocab-source.txt into data/vocab.json.

The source is a hand-written list, one word per line, pipe separated:

    # n. | hebrew with nikud | transliteration | english | pos[.gender] | themes | extra
    1. | שָׁלוֹם | shalom | hello, peace | noun.m | greetings,general |
    2. | לִכְתּוֹב | likhtov | to write | verb | school | root=כ-ת-ב;binyan=paal
    3. | יָפֶה / יָפָה | yafe / yafa | beautiful | adj | general |
    4. | סֵפֶר | sefer | book | noun.m | school | pl=סְפָרִים

Every field is validated, because a typo here is a word that renders wrong
in five places at once. Anything the list gets wrong that is worth recording
rather than silently fixing goes in the CORRECTIONS table below and is
written out to CORRECTIONS.md.

Run:  python3 tools/build-vocab.py
"""

import io
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "vocab-source.txt")
OUT = os.path.join(ROOT, "data", "vocab.json")
CORR = os.path.join(ROOT, "CORRECTIONS.md")

# ---------------------------------------------------------------- corrections
# n -> (new_hebrew | None, new_english | None, reason)
CORRECTIONS = {}

# ---------------------------------------------------------------- the rules

POS = {"noun", "verb", "adj", "phrase", "connector", "grammar", "number", "other"}
# Only these may carry a gender. A number carries the gender it counts in.
GENDERED = {"noun", "number"}
GENDERS = {"m", "f", "pl", "mf"}
BINYANIM = {"paal", "piel", "hifil", "hitpael", "nifal", "pual", "hufal"}
EXTRA_KEYS = {"root", "binyan", "pl"}

THEMES = {
    "greetings", "general", "food", "home", "family", "people", "body", "health",
    "clothes", "city", "travel", "work", "school", "nature", "animals", "time",
    "numbers", "colours", "feelings", "connectors", "grammar", "phrases",
    "israel", "religion", "slang",
}

# The same set hebrew.js strips: pointing, not punctuation.
MARKS = re.compile("[֑-ׇֽֿׁׂׅׄ]")
LETTER = re.compile("[א-ת]")
FINALS = {"ך": "כ", "ם": "מ", "ן": "נ",
          "ף": "פ", "ץ": "צ"}


def strip_nikud(s):
    return MARKS.sub("", unicodedata.normalize("NFC", s))


def unfinal(s):
    return "".join(FINALS.get(c, c) for c in s)


def dkey(s):
    """Dedupe key: the word as a learner would type it, finals levelled."""
    k = strip_nikud(s)
    k = re.sub("[־‐-―-]", " ", k)
    k = re.sub("[׳״‘’“”'\"]", "", k)
    return unfinal(re.sub(r"\s+", " ", k).strip())


def has_hebrew(s):
    return bool(LETTER.search(s))


# ---------------------------------------------------------------- parsing

problems = []


def bad(n, msg):
    problems.append("line %s: %s" % (n, msg))


def parse_extra(n, raw):
    """`root=כ-ת-ב;binyan=paal` -> {'root': ..., 'binyan': ...}"""
    out = {}
    for piece in raw.split(";"):
        piece = piece.strip()
        if not piece:
            continue
        if "=" not in piece:
            bad(n, "extra field %r is not key=value" % piece)
            continue
        k, v = piece.split("=", 1)
        k, v = k.strip(), v.strip()
        if k not in EXTRA_KEYS:
            bad(n, "unknown extra key %r (known: %s)" % (k, ", ".join(sorted(EXTRA_KEYS))))
            continue
        out[k] = v
    return out


def parse_line(raw, lineno):
    cells = [c.strip() for c in raw.split("|")]
    if len(cells) < 5:
        bad(lineno, "needs at least five fields (n | hebrew | tr | english | pos)")
        return None
    cells += [""] * (7 - len(cells))

    m = re.match(r"^(\d+)[.)]?$", cells[0])
    if not m:
        bad(lineno, "first field %r is not a number" % cells[0])
        return None
    n = int(m.group(1))

    he, tr, en, pos_raw, themes_raw, extra_raw = cells[1], cells[2], cells[3], cells[4], cells[5], cells[6]

    if n in CORRECTIONS:
        new_he, new_en, _reason = CORRECTIONS[n]
        if new_he:
            he = new_he
        if new_en:
            en = new_en

    if not has_hebrew(he):
        bad(n, "the Hebrew field %r has no Hebrew letter in it" % he)
        return None
    if not en:
        bad(n, "no English")
        return None

    pos, _, gender = pos_raw.partition(".")
    pos, gender = pos.strip(), gender.strip()
    if pos not in POS:
        bad(n, "pos %r is not one of %s" % (pos, ", ".join(sorted(POS))))
        return None
    if gender:
        if pos not in GENDERED:
            bad(n, "a %s may not carry a gender (%r)" % (pos, gender))
            gender = ""
        elif gender not in GENDERS:
            bad(n, "gender %r is not m, f, pl or mf" % gender)
            gender = ""
    elif pos == "noun":
        bad(n, "a noun needs a gender: write noun.m, noun.f, noun.pl or noun.mf")

    themes = [t.strip() for t in themes_raw.split(",") if t.strip()]
    for t in themes:
        if t not in THEMES:
            bad(n, "theme %r is not in the list (add it to THEMES if it should be)" % t)
    themes = [t for t in themes if t in THEMES] or ["general"]

    extra = parse_extra(n, extra_raw)
    if "binyan" in extra and extra["binyan"] not in BINYANIM:
        bad(n, "binyan %r is not one of %s" % (extra["binyan"], ", ".join(sorted(BINYANIM))))
        extra.pop("binyan")
    if "root" in extra and not has_hebrew(extra["root"]):
        bad(n, "root %r has no Hebrew in it" % extra["root"])
        extra.pop("root")
    if "pl" in extra and not has_hebrew(extra["pl"]):
        bad(n, "pl %r has no Hebrew in it" % extra["pl"])
        extra.pop("pl")
    if pos == "verb" and "binyan" not in extra:
        bad(n, "a verb should say which binyan it is in: binyan=paal")

    entry = {
        "n": n,
        "he": unicodedata.normalize("NFC", he),
        "tr": tr,
        "en": en,
        "pos": pos,
        "g": gender,
        "themes": sorted(set(themes)),
        "id": "w%d" % n,
    }
    for k in ("root", "binyan", "pl"):
        if extra.get(k):
            entry[k] = unicodedata.normalize("NFC", extra[k]) if k != "binyan" else extra[k]
    if not tr:
        bad(n, "no transliteration")
    return entry


# ---------------------------------------------------------------- main

def main():
    if not os.path.exists(SRC):
        print("no %s yet; nothing to build" % os.path.relpath(SRC, ROOT))
        return 1

    entries = []
    last_n = 0
    for lineno, raw in enumerate(io.open(SRC, encoding="utf-8").read().split("\n"), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        e = parse_line(line, lineno)
        if not e:
            continue
        if e["n"] <= last_n:
            bad(e["n"], "out of order: %d comes after %d" % (e["n"], last_n))
        last_n = max(last_n, e["n"])
        entries.append(e)

    # ------------------------------------------------------------ dedupe
    #
    # Two entries are the same word only when they are written the same way,
    # points and all. Stripping the points first would merge מַה שְׁלוֹמְךָ with
    # מַה שְׁלוֹמֵךְ, which are the masculine and the feminine of one question
    # and two different things to learn. But an unpointed pair is still worth
    # knowing about, because the grader cannot tell them apart either.
    seen, near, merged, dupes, collisions = {}, {}, [], [], []
    for e in entries:
        exact = unicodedata.normalize("NFC", e["he"])
        if exact in seen:
            first = seen[exact]
            dupes.append((e["n"], e["he"], e["en"], first["n"], first["en"]))
            # Keep a second gloss when it genuinely adds meaning.
            if e["en"].lower() not in first["en"].lower():
                first["en"] = first["en"] + "; " + e["en"]
            continue
        seen[exact] = e

        k = dkey(e["he"])
        if k in near:
            collisions.append((e["n"], e["he"], near[k]["n"], near[k]["he"]))
        else:
            near[k] = e
        merged.append(e)

    theme_counts = {}
    pos_counts = {}
    for e in merged:
        pos_counts[e["pos"]] = pos_counts.get(e["pos"], 0) + 1
        for t in e["themes"]:
            theme_counts[t] = theme_counts.get(t, 0) + 1

    payload = {
        "count": len(merged),
        "source_count": len(entries),
        "themes": dict(sorted(theme_counts.items(), key=lambda kv: -kv[1])),
        "words": merged,
    }
    io.open(OUT, "w", encoding="utf-8").write(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n")

    # ------------------------------------------------------------ report
    print("%d entries read, %d written (%d duplicates merged)"
          % (len(entries), len(merged), len(dupes)))
    print("  by type:  " + ", ".join("%s %d" % kv for kv in sorted(pos_counts.items())))
    print("  by theme: " + ", ".join("%s %d" % kv
                                     for kv in sorted(theme_counts.items(), key=lambda kv: -kv[1])))
    for n, he, en, first_n, first_en in dupes:
        print("  duplicate: %d %s (%s) already at %d (%s)" % (n, he, en, first_n, first_en))
    for n, he, first_n, first_he in collisions:
        print("  note: %d %s and %d %s are the same once the points come off, "
              "so an answer typed without nikud matches either" % (n, he, first_n, first_he))

    # ------------------------------------------------------------ corrections doc
    applied = [(n,) + v for n, v in sorted(CORRECTIONS.items())]
    if applied:
        md = ["# Corrections to the word list", "",
              "Changes made to `data/vocab-source.txt` while building it. If you disagree",
              "with a call, edit the source or the `CORRECTIONS` table in",
              "`tools/build-vocab.py` and run the script again.", "",
              "| # | Now | Why |", "|---|---|---|"]
        for n, new_he, new_en, reason in applied:
            md.append("| %d | %s | %s |" % (n, new_he or new_en, reason))
        io.open(CORR, "w", encoding="utf-8").write("\n".join(md) + "\n")
        print("  wrote %s" % os.path.relpath(CORR, ROOT))

    if problems:
        print("\n%d problems:" % len(problems))
        for p in problems:
            print("  " + p)
        return 1
    print("\nno problems")
    return 0


if __name__ == "__main__":
    sys.exit(main())
