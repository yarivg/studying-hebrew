# המחברת

A Hebrew course for an English speaker starting from the alef-bet, built as a
static site. Lessons, a question bank behind every chapter, reading passages
you can hear and read back, a searchable vocabulary and spaced-repetition
flashcards. It works offline, installs as an app, and syncs between devices
through a private GitHub gist.

No build step, no dependencies, no third-party scripts, no tracking. It is
HTML, CSS and JavaScript served as files.

## The course

| Part | Level | Chapters | What it covers |
|---|---|---|---|
| I. Foundations | A1 | 26 | The letters and the vowel points, then the noun, the adjective and the present tense. |
| II. Building fluency | A2 to B1 | 20 | Past and future, the seven verb patterns, and the system that generates them. |
| III. Refining | B2 | 13 | The passive, longer sentences, register, idiom, and the pairs that stay confusing. |
| IV. Reference | | 4 | Tables to come back to: the alef-bet, the verbs, the prepositions, and how to use the course. |

Plus ten reading passages and a ten-chapter serial, and a word list of around
seven hundred entries with gender, transliteration, root and binyan.

## How Hebrew is graded

Everything in the course is written with full nikud, because the vowel points
are what let a beginner read a word and what let the browser's voice say it.
Nothing you type is ever graded on them.

- **Nikud is ignored on both sides.** So are the maqaf, the geresh and the
  gershayim. Type `שולחן` for `שׁוּלְחָן` and it is correct.
- **A wrong final letter is a slip, not a mistake.** Typing `שולחנ` where `ן`
  belongs is marked **correct, spelling aside**, and you are shown the right
  spelling. The same for ך ם ף ץ.
- **Both spellings are listed** where the full and the defective forms are
  both in use. The grader does not guess between them.
- **You are never asked to type nikud.** A question whose answer would be a
  vowel sign is asked as a multiple choice instead.

### The nikud toggle

The button next to the theme switch in the top bar takes the points off every
Hebrew word on the page, and puts them back. That is the whole difference
between a textbook and a street sign, and it is a deliberate practice tool:
read a chapter with the points, then read it again without.

The course is written in **full spelling with the points on top**, so
switching them off leaves ordinary written Hebrew rather than a defective
spelling nobody uses. What is spoken always keeps its points, whatever the
page is showing.

### The letter bar

Nobody starting Hebrew has a Hebrew keyboard, so every typed answer has the
alef-bet under it, running right to left, with the five final forms in their
alphabetical places. Click a letter to insert it. On a real keyboard, typing
the same base letter twice swaps it for its final form: `כ` then `כ` gives
`ך`.

## The six question types

| Type | What it asks |
|---|---|
| `mcq` | Pick one of three or four. |
| `fill` | Type the answer. |
| `order` | Put the words in order by tapping chips. |
| `listen` | Hear a phrase and write it down. |
| `say` | Read a phrase aloud; the browser transcribes you and marks the words it did not hear as you meant them. |
| `open` | Answer in your own words, reveal the model answer, mark yourself. |

A chapter test runs its own bank. A part exam samples across every chapter in
that part. A group test crosses chapter lines, for the things that get
confused together: gender agreement, the present tense, the little words.

The score is evidence, not a verdict. At the end of a test you mark the
chapter yourself: not yet, shaky, or confident. That mark is what moves the
progress ring.

## Audio

Speech comes from the browser, so there are no sound files to download and it
works offline once a voice is installed.

- **macOS**: add Carmit under System Settings, Accessibility, Spoken Content,
  System Voice, Manage Voices.
- **iOS and Android**: a Hebrew voice is built in.
- **Firefox and older Safari** cannot listen, so `say` questions fall back to
  hearing the model and marking yourself.

Click any Hebrew example to hear it. Shift-click reads it slowly. A
transliteration in the text gets a play button of its own, wired to the Hebrew
word it transcribes.

## Fonts

Two Hebrew faces ship with the repo, under the SIL Open Font License: Noto
Sans Hebrew for the interface and Frank Ruhl Libre for reading passages and
flashcards. They are here rather than on a CDN for one reason: a system Hebrew
font draws the letters but places the nikud roughly, and a pointed word turns
to mush at body size. Both of these carry proper mark attachment. The licences
are in `assets/fonts/`.

## Sync

Progress lives in this browser, under the key `hamachberet.v1`. To carry it
between devices, the Progress page can push and pull a private GitHub gist:
create a token with the `gist` scope, paste it once per device, and each
device merges rather than overwrites. Nothing is sent anywhere else, and the
page's content security policy only permits GitHub's gist API.

You can also export and import a JSON file by hand, from the same page.

## Offline

The service worker precaches the shell and every lesson, bank, passage and
font, so the whole course works with no connection after the first visit. It
installs as an app from the browser's own menu.

For somewhere with no server at all, `python3 tools/build-single-file.py`
writes `hamachberet-offline.html`, one file holding the entire course
including the fonts, which opens from a USB stick or an email attachment.

## Running it locally

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` straight from disk
does not work: the browser blocks the requests the page makes.

## Editing

| To change | Edit | Then run |
|---|---|---|
| a lesson | `content/partN/NN-slug.md` | nothing |
| a test bank | `content/tests/partN/NN-slug.json` | `python3 tools/check-tests.py` |
| a passage | `content/reading/*.json` | `python3 tools/check-reading.py` |
| the word list | `data/vocab-source.txt` | `python3 tools/build-vocab.py` |
| anything with Hebrew in it | | `python3 tools/check-hebrew.py` |
| a bank's answers | | `node tools/check-grading.js` |
| the chapter list | `content/manifest.json` | nothing |
| the icons | `tools/make-icons.py` | `python3 tools/make-icons.py` |

`content/tests/SCHEMA.md` and `content/reading/SCHEMA.md` are the authority on
the two JSON formats.

## Writing Hebrew in this repo

- Full nikud on every Hebrew string, everywhere.
- Full spelling with the points on top: `שׁוּלְחָן`, not `שֻׁלְחָן`.
- Inline Hebrew in a lesson goes in italics: `*שָׁלוֹם*`. The renderer wraps
  every Hebrew run in its own right-to-left span, so you never write HTML.
- A transliteration goes in slashes after the first occurrence of a word:
  `*שָׁלוֹם* /shalom/`. Latin letters only, never IPA.
- The transliteration scheme: `kh` for כ and ח, `tz` for צ, `sh` for שׁ, `'`
  for ע and for א between vowels, `ei` for tzere plus yod, and `a e i o u`.
  Stress is not marked, because the audio carries it.
- No em dash anywhere.
