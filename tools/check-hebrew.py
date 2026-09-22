#!/usr/bin/env python3
"""Check every Hebrew string in the repo for the mistakes a reader would see.

The two schema checkers validate the shape of a test bank and a passage. This
one validates the Hebrew itself, everywhere it appears: lessons, banks,
passages and the word list. It is the guard rail for the rules in CLAUDE.md.

What it looks for:

  error    a final letter (ך ם ן ף ץ) somewhere other than the end of a word
  error    text that is not NFC normalised
  error    an em dash, anywhere at all
  error    a vowel sign stranded after a Latin letter or a digit
  error    two vowel signs on one letter
  warning  a Hebrew word of two letters or more carrying no nikud
  warning  defective spelling where full spelling is the house rule

The nikud warning has exceptions, because some unpointed Hebrew is deliberate:
a root written as bare letters, a letter named as a letter, a word being shown
as it looks with the points taken off. Those are listed below.

Run:  python3 tools/check-hebrew.py
"""

import io
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MARKS = "֑-ׇֽֿׁׂׅׄ"
LETTER = "א-ת"
FINALS = "ךםןףץ"

MARK_RE = re.compile("[" + MARKS + "]")
# A word is a run of letters and the marks hanging off them, plus the geresh
# and gershayim that sit inside abbreviations.
WORD_RE = re.compile("[" + LETTER + "][" + LETTER + MARKS + "׳״']*")
# A final letter with a letter after it: the mark of a word broken in two.
BAD_FINAL_RE = re.compile("[" + FINALS + "][" + MARKS + "]*[" + LETTER + "]")
# A pointing mark that has landed on a Latin letter or a digit, which only
# happens when a word has been cut in the wrong place. A mark standing on its
# own is NOT this: a grammar lesson names an ending by printing the bare sign,
# as in "the feminine ending ָה", and that is correct.
STRANDED_MARK_RE = re.compile("[A-Za-z0-9][" + MARKS + "]")

# The vowel signs proper, as against the dagesh, the shin dot and the meteg.
# Two of these on one letter is a typo: a letter carries one vowel.
VOWELS = "\u05B0-\u05BB\u05C7"
TWO_VOWELS_RE = re.compile("[" + VOWELS + "][\u05BC\u05C1\u05C2]*[" + VOWELS + "]")

# Defective spellings whose full form is the house rule. The left side is what
# must not appear; the right side is what to write instead.
DEFECTIVE = {
    "שֻׁלְחָן": "שׁוּלְחָן",
    "פִּעֵל": "פִּיעֵל",
    "פֻּעַל": "פּוּעַל",
    "הֻפְעַל": "הוּפְעַל",
    "בִּנְיָן": "בִּנְיָין",
}

# Unpointed Hebrew that is there on purpose. A root written as bare letters
# joined by hyphens, a single letter named as a letter, and the words the
# lessons deliberately print without their points to show what that looks
# like. Anything here is exempt from the nikud warning.
ALLOWED_BARE = {
    # shown unpointed on purpose in the reading and spelling chapters
    "שלום", "בית", "ספר", "ספרים",
    "שולחן", "שלחן", "שוק", "עיר",
    "טוב", "גדול", "קום", "מיץ",
    "איש", "מצווה", "אוויר",
    "בניינים", "בבית", "והילד",
    "מהעיר", "שאני", "מדבר",
    "מסביר", "התלבש", "ספריה",
    "של", "את", "זה", "לא", "יש", "אין",
    "עם", "כל", "אני", "הוא", "היא",
    "יפה", "רצה", "רוצה", "כתבת",
    "דיבר", "לימד", "סיפר",
    "תיכף", "היתה", "הייתה",
    "שמאלה", "צהריים", "אמא",
    "מילה", "ששי", "אסע", "אקח",
    # endings and digraphs named as themselves in a grammar table
    "ים", "ות", "וו", "יי", "יו", "יה", "ית", "ת",
    # pairs the lessons print unpointed to show that the points are the only
    # thing telling them apart
    "עליו", "עליה", "אליו", "אליה", "אם", "ספריו",
    "עליי", "אליי", "לפניי", "אחריי", "יו", "נכתב",
    "ורד", "ילד", "תשפ",
    # the confusables chapter prints these bare to show that one unpointed
    # spelling carries two words: a year and sleep, an uncle and a boiler
    "שנה", "שינה", "דוד",
    # the course's own name, set unpointed as a wordmark
    "המחברת",
}

# Files whose subject IS unpointed Hebrew, or the difference between two
# spellings. Printing a word without its points is the point of them, so the
# nikud warning and the spelling warning are both switched off here.
SPELLING_FILES = {
    "content/part1/05-vav-yod.md",
    "content/part1/07-reading-without-nikud.md",
    "content/part2/05-roots-patterns.md",
    "content/part2/20-headlines.md",
    "content/tests/part2/20-headlines.json",
    "content/part3/10-ktiv-male-rules.md",
    # the bank for that chapter asks for the unpointed spelling as its answer
    "content/tests/part3/10-ktiv-male-rules.json",
    "content/tests/SCHEMA.md",
    "content/reading/SCHEMA.md",
}

# The one file that must show a defective spelling: the chapter that explains
# what a kubutz is cannot avoid printing one.
DEFECTIVE_OK = {
    "content/part1/03-nikud.md",
    # the alef-bet chart has to print a kubutz to name it
    "content/part4/01-alef-bet-chart.md",
    # the reference chart has the same problem: the kubutz row has to show one
    "content/part4/01-alef-bet-chart.md",
    # the header comment of the word list states the rule by showing both
    "data/vocab-source.txt",
}

problems = []
warnings = []


def bad(where, msg):
    problems.append("%s: %s" % (where, msg))


def warn(where, msg):
    warnings.append("%s: %s" % (where, msg))


def has_nikud(word):
    return bool(MARK_RE.search(word))


def bare(word):
    return MARK_RE.sub("", word)


def check_text(where, text, exempt=None):
    """Every check that applies to one blob of text."""
    exempt = exempt or set()
    if not unicodedata.is_normalized("NFC", text):
        bad(where, "not NFC normalised")

    # Written as an escape on purpose: a find-and-replace that sweeps em
    # dashes out of the repo must not be able to disarm the check that
    # catches them.
    EM_DASH = "\u2014"
    if EM_DASH in text:
        line = text[:text.index(EM_DASH)].count("\n") + 1
        bad(where, "em dash on line %d" % line)

    for m in BAD_FINAL_RE.finditer(text):
        bad(where, "final letter inside a word: %r" % m.group(0))

    for m in STRANDED_MARK_RE.finditer(text):
        bad(where, "a vowel sign stranded on a Latin letter, near %r"
            % text[max(0, m.start() - 12):m.start() + 6])

    for m in TWO_VOWELS_RE.finditer(text):
        bad(where, "two vowel signs on one letter, near %r"
            % text[max(0, m.start() - 6):m.start() + 8])

    if where not in SPELLING_FILES and where not in DEFECTIVE_OK:
        for defective, full in DEFECTIVE.items():
            if defective in text:
                warn(where, "defective spelling %s; the house rule is %s" % (defective, full))

    if where in SPELLING_FILES:
        return
    for m in WORD_RE.finditer(text):
        word = m.group(0)
        # An abbreviation or a Hebrew numeral is written with a geresh or a
        # gershayim and never carries points: א׳ for "first", צה"ל for the
        # army. The mark may fall inside the word or right after it, and the
        # word pattern stops before a quote, so look at both.
        after = text[m.end():m.end() + 1]
        if any(c in word for c in "\u05f3\u05f4'\"") or after in ("\u05f3", "\u05f4", '"', "'"):
            continue
        if len(bare(word)) < 2:
            continue                      # a single letter named as a letter
        if has_nikud(word):
            continue
        if bare(word) in ALLOWED_BARE:
            continue
        if text in exempt:
            continue        # a spelling variant listed beside its pointed form
        warn(where, "no nikud on %s" % word)


def answer_variants(values):
    """The unpointed spellings an answer list may legitimately carry.

    A question lists every acceptable spelling in `a`, and the whole reason
    for listing more than one is that the full and the defective spelling
    differ by a letter, not by a point. Those extra entries are written
    unpointed on purpose, so they are exempt from the nikud warning as long
    as the list also holds a pointed form of the same word.
    """
    pointed = [v for v in values if isinstance(v, str) and MARK_RE.search(v)]
    if not pointed:
        return set()
    return {v for v in values if isinstance(v, str) and not MARK_RE.search(v)}


def walk_json(where, node, exempt=None):
    """Every string inside a bank or a passage, wherever it is nested."""
    exempt = exempt or set()
    if isinstance(node, str):
        check_text(where, node, exempt)
    elif isinstance(node, list):
        for item in node:
            walk_json(where, item, exempt)
    elif isinstance(node, dict):
        for key, value in node.items():
            here = exempt
            if key in ("a", "also") and isinstance(value, list):
                here = exempt | answer_variants(value)
            walk_json(where, value, here)


def main():
    files = 0

    for sub in ("content", "data"):
        base = os.path.join(ROOT, sub)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, names in os.walk(base):
            for name in sorted(names):
                if name.startswith("_") or not name.endswith((".md", ".json", ".txt")):
                    continue
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, ROOT)
                text = io.open(path, encoding="utf-8").read()
                files += 1
                if name.endswith(".json"):
                    try:
                        walk_json(rel, json.loads(text))
                    except ValueError as e:
                        bad(rel, "not valid JSON: %s" % e)
                else:
                    check_text(rel, text)

    print("%d files checked" % files)

    if warnings:
        print("\n%d warnings:" % len(warnings))
        for w in warnings[:80]:
            print("  warning: " + w)
        if len(warnings) > 80:
            print("  ... and %d more" % (len(warnings) - 80))

    if problems:
        print("\n%d problems:" % len(problems))
        for p in problems:
            print("  " + p)
        return 1

    print("\nno problems")
    return 0


if __name__ == "__main__":
    sys.exit(main())
