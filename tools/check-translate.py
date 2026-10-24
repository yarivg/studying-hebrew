#!/usr/bin/env python3
"""Check the translation drills in content/tests/translate/.

One bank per reading passage, English sentences to put into Hebrew. The
answers are patterns, [a|b] for either and [a|] for optional, which the
grader expands into every sentence it will accept. This checks the shape of
each bank and that every pattern expands into something sane.

check-grading.js then runs every expanded sentence through the real grader.

Run:  python3 tools/check-translate.py
"""

import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRILLS = os.path.join(ROOT, "content", "tests", "translate")
READING = os.path.join(ROOT, "content", "reading", "index.json")

# Must match EXPAND_MAX in assets/test.js: past it the grader stops expanding.
EXPAND_MAX = 4000
MIN_SENTENCES = 10

MARKS = re.compile("[֑-ׇֽֿׁׂׅׄ]")
LETTER = re.compile("[א-ת]")
GROUP = re.compile(r"\[([^\[\]]*)\]")

problems = []
warnings = []


def bad(path, qid, msg):
    problems.append("%s [%s] %s" % (os.path.relpath(path, ROOT), qid or "-", msg))


def warn(path, qid, msg):
    warnings.append("%s [%s] %s" % (os.path.relpath(path, ROOT), qid or "-", msg))


def size(pattern):
    """How many sentences a pattern expands into, without expanding it."""
    n = 1
    for m in GROUP.finditer(pattern):
        n *= len(m.group(1).split("|"))
    return n


def balanced(pattern):
    depth = 0
    for c in pattern:
        if c == "[":
            depth += 1
            if depth > 1:
                return False
        elif c == "]":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def check_bank(path, passages):
    name = os.path.basename(path)[:-5]
    try:
        with open(path, encoding="utf-8") as fh:
            bank = json.load(fh)
    except ValueError as e:
        bad(path, None, "not valid JSON: %s" % e)
        return 0

    if bank.get("passage") != name:
        bad(path, None, "passage must be %r, the file name" % name)
    if name not in passages:
        bad(path, None, "no reading passage called %r" % name)
    if bank.get("id") != "translate-" + name:
        bad(path, None, "id must be %r" % ("translate-" + name))
    if not str(bank.get("title", "")).strip():
        bad(path, None, "no title")

    questions = bank.get("questions")
    if not isinstance(questions, list) or not questions:
        bad(path, None, "no questions")
        return 0
    if len(questions) < MIN_SENTENCES:
        warn(path, None, "only %d sentences; a drill wants %d or more" % (len(questions), MIN_SENTENCES))

    seen = set()
    for i, q in enumerate(questions):
        qid = q.get("id")
        if not qid:
            bad(path, None, "question %d has no id" % (i + 1))
            continue
        if qid in seen:
            bad(path, qid, "duplicate id")
        seen.add(qid)
        if not re.match(r"^translate-%s-\d{2,}$" % re.escape(name), qid):
            bad(path, qid, "id must be translate-%s-NN" % name)
        if q.get("type") != "translate":
            bad(path, qid, "type must be translate")
        prompt = str(q.get("q", "")).strip()
        if not prompt:
            bad(path, qid, "no English sentence in q")
        elif LETTER.search(prompt):
            warn(path, qid, "the English prompt has Hebrew in it")
        why = str(q.get("why", "")).strip()
        if not why:
            bad(path, qid, "no why")
        elif LETTER.match(MARKS.sub("", why)):
            # The verdict takes its direction from the first letter, so a
            # why that opens in Hebrew is laid out right to left.
            bad(path, qid, "why must start with an English word, not Hebrew")

        a = q.get("a")
        if not isinstance(a, list) or not a or not all(isinstance(x, str) and x.strip() for x in a):
            bad(path, qid, "a must be a list of answer patterns")
            continue
        model = a[0]
        if "[" in model or "|" in model:
            bad(path, qid, "a[0] is the model answer the learner is shown: no [ ] patterns in it")
        if not MARKS.search(model):
            bad(path, qid, "a[0] must carry full nikud")
        total = 0
        for p in a:
            if not unicodedata.is_normalized("NFC", p):
                bad(path, qid, "not NFC: %s" % p)
            if not balanced(p):
                bad(path, qid, "unbalanced or nested [ ] in %s" % p)
                continue
            if "|" in GROUP.sub("", p):
                bad(path, qid, "a | outside any [ ] in %s" % p)
            n = size(p)
            if n > EXPAND_MAX:
                bad(path, qid, "%s expands into %d sentences; the grader stops at %d" % (p, n, EXPAND_MAX))
            total += n
        if total < 2:
            warn(path, qid, "only one accepted sentence; there is almost always another way to say it")

        hint = q.get("hint")
        if hint is not None:
            if not isinstance(hint, list) or not all(isinstance(h, str) and MARKS.search(h) for h in hint):
                bad(path, qid, "hint must be a list of pointed Hebrew words")
    return len(questions)


def main():
    with open(READING, encoding="utf-8") as fh:
        passages = {p["id"] for p in json.load(fh)["passages"]}
    if not os.path.isdir(DRILLS):
        print("no translation drills")
        return 0
    files = sorted(f for f in os.listdir(DRILLS) if f.endswith(".json"))
    total = 0
    for f in files:
        total += check_bank(os.path.join(DRILLS, f), passages)

    print("%d drills checked, %d sentences" % (len(files), total))
    missing = sorted(passages - {f[:-5] for f in files})
    if missing:
        print("  passages with no drill yet: " + ", ".join(missing))

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
