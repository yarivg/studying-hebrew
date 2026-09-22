#!/usr/bin/env python3
"""Check every question bank against what assets/test.js is willing to run.

The banks are hand-written JSON, so this is the guard rail: a typo in a
field name would otherwise only show up as a broken question mid-test.

Run:  python3 tools/check-tests.py
"""

import collections
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, "content", "tests")
MANIFEST = os.path.join(ROOT, "content", "manifest.json")

TYPES = {"mcq", "fill", "order", "listen", "say", "open"}

# The same set hebrew.js strips: pointing, not punctuation.
MARKS = re.compile("[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]")
LETTER = re.compile("[\u05D0-\u05EA]")
FINALS = {"\u05da": "\u05db", "\u05dd": "\u05de", "\u05df": "\u05e0",
          "\u05e3": "\u05e4", "\u05e5": "\u05e6"}

problems = []
warnings = []
counts = collections.Counter()


def bad(path, qid, msg):
    problems.append("%s [%s] %s" % (os.path.relpath(path, ROOT), qid or "-", msg))


def warn(path, qid, msg):
    warnings.append("%s [%s] %s" % (os.path.relpath(path, ROOT), qid or "-", msg))


def has_hebrew(s):
    return bool(LETTER.search(str(s)))


def has_nikud(s):
    return bool(MARKS.search(unicodedata.normalize("NFC", str(s))))


def unfinal(s):
    return "".join(FINALS.get(c, c) for c in str(s))


def plain(s):
    """Mirror of Heb.plain(): the points, the maqaf and the quotes all go."""
    s = MARKS.sub("", unicodedata.normalize("NFC", str(s)))
    s = re.sub("[\u05BE\u2010-\u2015-]", " ", s)
    s = re.sub("[\u05F3\u05F4\u2018\u2019\u201c\u201d'\"]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def norm(s):
    """Mirror of Test.norm()."""
    out = plain(str(s).lower())
    return re.sub(r'^[\s.,;:!?«»"]+|[\s.,;:!?«»"]+$', "", out).strip()


def words_of(s):
    """Word count after the maqaf has become a space, the way a reader hears it."""
    return [w for w in plain(s).split(" ") if w]


def check_bank(path, slugs):
    with open(path, encoding="utf-8") as fh:
        try:
            bank = json.load(fh)
        except ValueError as e:
            bad(path, None, "not valid JSON: %s" % e)
            return

    ch = bank.get("ch")
    if ch not in slugs:
        bad(path, None, "ch %r is not a slug in manifest.json" % ch)
    if not bank.get("title"):
        bad(path, None, "no title")

    questions = bank.get("questions")
    if not isinstance(questions, list) or not questions:
        bad(path, None, "no questions")
        return

    seen = set()
    for q in questions:
        qid = q.get("id")
        counts[q.get("type")] += 1

        if not qid:
            bad(path, None, "a question has no id")
        elif qid in seen:
            bad(path, qid, "duplicate id")
        seen.add(qid)

        if q.get("type") not in TYPES:
            bad(path, qid, "unknown type %r" % q.get("type"))
            continue
        if not str(q.get("q", "")).strip():
            bad(path, qid, "empty q")
        if not str(q.get("why", "")).strip():
            bad(path, qid, "empty why - that is the part that teaches")

        t = q["type"]

        if t == "mcq":
            choices = q.get("choices")
            if not isinstance(choices, list) or not 2 <= len(choices) <= 5:
                bad(path, qid, "mcq needs 2-5 choices")
                continue
            if not isinstance(q.get("a"), int) or not 0 <= q["a"] < len(choices):
                bad(path, qid, "mcq answer index out of range")
            if len(set(map(str, choices))) != len(choices):
                bad(path, qid, "mcq has two identical choices")
            elif len(set(map(norm, choices))) != len(choices):
                # Legitimate: a question may turn on the difference between
                # two forms that are spelled alike and pointed differently.
                # test.js spots this and keeps the points on every choice,
                # overriding the nikud toggle, so the buttons stay distinct.
                warn(path, qid, "two choices differ only in their nikud, so this "
                                "question keeps the points on whatever the toggle says")

        elif t in ("fill", "listen"):
            answers = q.get("a")
            if not isinstance(answers, list) or not answers:
                bad(path, qid, "%s needs a non-empty array of answers" % t)
                continue
            if any(not str(a).strip() for a in answers):
                bad(path, qid, "%s has an empty answer" % t)
            if t == "listen":
                if not str(q.get("say", "")).strip():
                    bad(path, qid, "listen needs a `say` string")
                elif len(words_of(q["say"])) > 6:
                    bad(path, qid, "listen `say` is longer than six words")
                elif not has_nikud(q["say"]):
                    warn(path, qid, "`say` has no nikud; the voice needs it to pick a vowel")

            # Nikud is stripped before grading, so a prompt that already
            # prints the answer without its points is giving it away.
            first = str(answers[0]) if answers else ""
            if first:
                stripped = norm(first)
                if stripped and re.search(r"(?:^|\s)%s(?:$|\s)" % re.escape(stripped),
                                          norm(q.get("q", ""))):
                    bad(path, qid,
                        "the prompt already contains the answer once the nikud is off; "
                        "make this an mcq")

        elif t == "order":
            words, answer = q.get("words"), q.get("a")
            if not isinstance(words, list) or not isinstance(answer, list):
                bad(path, qid, "order needs `words` and `a` arrays")
                continue
            # Compared after the points come off, so an `also` order written
            # without nikud still counts as the same set of chips.
            if sorted(map(norm, words)) != sorted(map(norm, answer)):
                bad(path, qid, "order `words` is not a rearrangement of `a`")
            for alt in q.get("also", []):
                if sorted(map(norm, alt)) != sorted(map(norm, words)):
                    bad(path, qid, "an `also` order uses different words")
            for chip in words:
                if not has_hebrew(chip):
                    bad(path, qid, "order chip %r has no Hebrew in it" % chip)
                elif len(norm(chip)) >= 2 and not has_nikud(chip):
                    warn(path, qid, "order chip %r has no nikud" % chip)

        elif t == "say":
            target = q.get("target", "")
            if not str(target).strip():
                bad(path, qid, "say needs a `target`")
            elif not 1 <= len(words_of(target)) <= 6:
                bad(path, qid, "say target must be 1-6 words (recogniser guesses longer ones)")
            elif not has_hebrew(target):
                bad(path, qid, "say target has no Hebrew in it")
            elif not has_nikud(target):
                warn(path, qid, "`target` has no nikud; the model reading needs it")
            if "a" in q:
                bad(path, qid, "say must not have an `a`")

        elif t == "open":
            answers = q.get("a")
            if not isinstance(answers, list) or not answers or not str(answers[0]).strip():
                bad(path, qid, "open needs a model answer in a[0]")

        # A typed answer must be Hebrew, because the letter bar is what the
        # learner has instead of a keyboard. The one exception is a question
        # that asks for a transliteration, which is tagged as such.
        typed = []
        if t in ("fill", "listen"):
            typed = q.get("a") or []
        translit = "translit" in (q.get("tags") or [])
        for a in typed:
            if translit:
                continue
            if re.search("[A-Za-z]", str(a)):
                bad(path, qid,
                    "a typed answer contains Latin letters; tag the question "
                    "\"translit\" if that is the point of it")
            elif not has_hebrew(a):
                bad(path, qid, "a typed answer has no Hebrew in it")
        # Nikud belongs on everything the course prints, so it can be read
        # aloud. It is never required of the learner.
        # The one chapter that asks for the unpointed spelling tags its
        # questions "unpointed", because there the missing points are the
        # answer rather than an omission.
        unpointed_ok = "unpointed" in (q.get("tags") or [])
        if (typed and not translit and not unpointed_ok
                and not has_nikud(typed[0]) and len(norm(typed[0])) >= 2):
            warn(path, qid, "the model answer %r has no nikud" % typed[0])


def main():
    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    slugs = {c["slug"] for p in manifest["parts"] for c in p["chapters"]}
    expected = {
        c["file"].replace(".md", ".json"): c["slug"]
        for p in manifest["parts"] for c in p["chapters"]
    }

    found = 0
    for rel, slug in sorted(expected.items()):
        path = os.path.join(TESTS, rel)
        if not os.path.exists(path):
            continue
        found += 1
        check_bank(path, slugs)

    print("%d banks checked, %d questions" % (found, sum(counts.values())))
    if counts:
        print("  " + ", ".join("%s %d" % (t, n) for t, n in sorted(counts.items())))

    if warnings:
        print("\n%d warnings:" % len(warnings))
        for w in warnings:
            print("  warning: " + w)

    if problems:
        print("\n%d problems:" % len(problems))
        for p in problems:
            print("  " + p)
        return 1
    print("\nno problems")
    return 0


if __name__ == "__main__":
    sys.exit(main())
