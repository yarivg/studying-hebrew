# Reading passage format

One JSON file per passage in `content/reading/`, listed in
`content/reading/index.json`.

```json
{
  "id": "a1-01-ha-boker",
  "title": "הַבֹּקֶר שֶׁל יוּלִי",
  "level": "A1",
  "blurb": "One morning, start to finish. Present tense, the definite article and telling the time.",
  "grammar": ["present-paal", "ha-article", "time-place-adverbs"],
  "text": "יוּלִי קָמָה בְּשֵׁשׁ וָחֵצִי.\nהִיא לֹא אוֹהֶבֶת לְאַחֵר.\n\nבַּחוּץ יוֹרֵד גֶּשֶׁם.",
  "gloss": { "לְאַחֵר": "to be late", "בַּחוּץ": "outside" },
  "aloud": ["יוּלִי קָמָה בְּשֵׁשׁ וָחֵצִי."],
  "questions": [ ... ]
}
```

| field | notes |
|---|---|
| `id` | matches the filename without `.json`. Progress is keyed on it, so never change one. |
| `level` | `A1`, `A2`, `B1` or `B2` |
| `blurb` | one line of English, saying what grammar the passage exercises |
| `grammar` | chapter slugs from `content/manifest.json`. Used to link back to the lesson. |
| `text` | the passage, **with full nikud**. One sentence per line; a blank line starts a new paragraph. The reader makes every line separately playable, so a line must be a sensible thing to hear on its own. |
| `gloss` | Hebrew word or phrase → English, for anything the reader will not know. Matched against the passage with the points stripped, longest first, so the key may be written with or without them. |
| `aloud` | one or two lines from the passage to read into the microphone. Each must be 3-10 words, copied from `text` exactly, nikud and all. |
| `questions` | comprehension questions, in the **same format as the test banks** - see `content/tests/SCHEMA.md`. Use `mcq`, `fill` and `open` only; the passage is already on screen, so `listen` and `say` add nothing. |

Questions are asked in Hebrew once the learner is past Part I; before that,
ask in English and answer in Hebrew. `why` is always English prose, and may
quote Hebrew.

## Writing rules

- **Length by level:** A1 60-100 words, A2 100-150, B1 150-220, B2 220-300.
  Hebrew is denser than English on the page: no separate articles, prefixes
  glued on, the subject pronoun folded into a past-tense verb. These ranges
  are the same reading load as the longer English ones.
  A serialised story is the one exception: a chapter runs 350-450 words,
  because a plot needs room and the reader is already past the level.
  Chapters are numbered in the title (`א.`, `ב.`) and say which chapter they
  are in the blurb, since the list groups by level rather than by series.
- **Full nikud on everything**, including the gloss keys and the `aloud`
  lines. The nikud toggle in the topbar is what lets a learner read the same
  passage without them; that only works if the points are there to remove.
- **Full spelling (ktiv male) with the nikud on top**, so that switching the
  points off leaves ordinary written Hebrew rather than a defective spelling.
- **Only grammar the course has already taught**, and only what the named
  chapters cover. An A1 passage may not use the past tense.
- **Vocabulary:** prefer words already in `data/vocab.json`. Anything outside
  it that a learner would not guess belongs in `gloss`. A word wearing a
  prefix (הַ, וְ, בְּ, לְ, מִ, כְּ, שֶׁ) is found without one, so gloss the bare word.
- **5 to 7 questions**, or 8 for a story chapter, which is longer. At least
  two must need the passage rather than general knowledge, and at least one
  must ask about a grammar point rather than the plot. The last one should be
  `open`.
- **Write something worth reading.** A person, a situation, a small turn. Not
  a list of sentences that happen to share a tense.
- The Hebrew must sound like Hebrew rather than English with Hebrew words:
  Hebrew says הַיּוֹם יוֹם שְׁלִישִׁי, not הַיּוֹם הוּא יוֹם שְׁלִישִׁי.

Then run `python3 tools/check-reading.py`, and fix the warnings as well as the
errors.
