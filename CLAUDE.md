# HaMachberet

A Hebrew course for an English speaker starting from zero, built as a static
site: HTML, CSS and ES5 JavaScript served as files. No build step, no
dependencies, no third-party scripts, no webfonts from a CDN. Keep it that way.

## Layout

```
index.html              app shell; script tags in load order
sw.js                   service worker; SHELL lists every file to precache
assets/*.js             the engine, one IIFE module per file on window
assets/hebrew.js        window.Heb: strip, plain, unfinal, show, the nikud toggle
assets/fonts/           two self-hosted OFL Hebrew faces, for nikud positioning
content/manifest.json   the four parts and every chapter
content/partN/*.md      lessons
content/tests/          question banks, one JSON per chapter, plus groups.json
content/reading/        passages, plus index.json
data/vocab-source.txt   the word list, hand written
data/vocab.json         built from it by tools/build-vocab.py
tools/                  four python3 scripts
```

## Content rules

- **Full nikud on every Hebrew string**, everywhere: lessons, tables, examples,
  test banks, reading passages, the word list.
- **Full spelling (ktiv male) with the points on top**: שׁוּלְחָן, not שֻׁלְחָן.
  Stripping the nikud must leave exactly what an Israeli writes unpointed.
  This is what makes the nikud toggle useful rather than misleading.
- **No em dash anywhere.** Hyphen, colon, comma, brackets, or restructure.
- **Question ids are never renumbered.** Progress is keyed on them. Add new
  questions at the end of a bank.
- **List both spellings in `a`** where the full and defective forms are both
  common. The grader strips nikud and forgives a wrong final letter; it does
  not guess between spellings.
- Only teach what the course has already covered. `content/manifest.json` is
  the order of record.
- Schemas: `content/tests/SCHEMA.md` and `content/reading/SCHEMA.md`.

## After editing

Everything at once, which is the right thing to run before handing work back:

```
sh tools/check-all.sh
```

Individually:

```
node --check assets/*.js            # after any JS change
python3 tools/build-vocab.py        # after editing data/vocab-source.txt
python3 tools/check-tests.py        # after editing a test bank
python3 tools/check-reading.py      # after editing a passage
python3 tools/check-hebrew.py       # after editing anything with Hebrew in it
node tools/check-grading.js         # grades every bank answer with the real grader
node tools/check-gloss.js           # checks a tapped word in a passage resolves
node tools/check-speech.js          # checks a spoken answer is scored fairly
python3 tools/build-reading-index.py  # rebuilds content/reading/index.json
python3 tools/build-single-file.py  # regenerates hamachberet-offline.html
python3 -m http.server 8000         # then open http://localhost:8000
```

Fix the warnings as well as the errors. A warning about missing nikud is a
real defect: the voice cannot read an unpointed string correctly.

`check-hebrew.py` is the repo-wide Hebrew linter. It reads every Hebrew string
in `content/` and `data/` and errors on a final letter inside a word, text that
is not NFC, an em dash, a vowel sign stranded on a Latin letter, and two vowel
signs on one letter. It warns on unpointed Hebrew and on defective spelling.
Where unpointed Hebrew is the subject of the chapter, add the file to
`SPELLING_FILES` at the top of the script rather than silencing the check.

## Never commit or push without being asked.
