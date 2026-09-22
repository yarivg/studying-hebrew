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
audio/xx/<hash>.m4a     Carmit reading every Hebrew string in the course
audio/index.json        the key list, read only by "Save all audio offline"
tools/                  the build scripts and the checkers
```

## Audio

Nearly every Hebrew string is a recording, made on a Mac with `say -v Carmit`
and played by the app in preference to the browser's own voice. That is not a
nicety: browsers list Hebrew voices they will not drive, and several have none
at all, so the recording is the only thing that sounds the same everywhere.

A clip is named after the text it holds. `Say.key()` in `assets/audio.js`
hashes the *cleaned* string and that is the filename, so nothing is looked up
and no index is loaded at startup. A string with no clip 404s once and the
browser voice takes it.

**Only `Say.key()` ever computes a name.** `tools/collect-audio.js` loads the
real module and calls it, and `tools/build-audio.py` only ever writes the
names it is handed. Reimplementing the hash anywhere else would make every
clip invisible at once.

Clips are never precached: 44 MB before the first lesson is not a trade worth
making. They are cached as they play, and the Audio menu has a button that
fetches the lot for a flight.

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
node tools/check-clean.js           # checks the text reaching the voice is intact
python3 tools/build-reading-index.py  # rebuilds content/reading/index.json
node tools/collect-audio.js         # lists every string that needs a recording
python3 tools/build-audio.py        # records the missing ones (macOS, ~30 min)
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
