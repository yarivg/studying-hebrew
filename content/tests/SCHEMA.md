# Test bank format

One JSON file per chapter, at `content/tests/<part>/<same-basename-as-the-chapter>.json`.
So `content/part1/03-nikud.md` is tested by `content/tests/part1/03-nikud.json`.

The chapter test reads its own file. A whole-part test samples across every
file in that part. Nothing else builds or bundles these: the app fetches them
as they are.

```json
{
  "ch": "nikud",
  "title": "Nikud: the vowel points",
  "questions": [ ... ]
}
```

`ch` must equal the chapter's `slug` in `content/manifest.json`.

## How Hebrew is graded

Three rules decide everything below, so read them before writing a question.

1. **Nikud is never graded.** Both the answer and what the learner typed have
   their points stripped before they are compared, along with the maqaf, the
   geresh and the gershayim. Write every Hebrew string with full nikud anyway:
   the points are what let the voice read it, and what let the learner read it
   back.
2. **Write Hebrew in full spelling (ktiv male) with nikud.** `שׁוּלְחָן`, not
   `שֻׁלְחָן`. Taking the points off the first leaves `שולחן`, which is what a
   learner types; the second leaves `שלחן`, which nobody does.
3. **A wrong final letter is a slip, not a mistake.** Typing `שולחנ` for
   `שׁוּלְחָן` is marked correct with the proper spelling shown. That is
   automatic; nothing in the bank controls it.

Where both the full and the defective spelling are genuinely common, list both
in `a`. The grader does not guess between them.

## Every question

| field | required | notes |
|---|---|---|
| `id` | yes | unique inside the file, e.g. `nikud-07`. Progress is keyed on it, so **never renumber an existing id** - add new ones at the end. |
| `type` | yes | one of the six below |
| `q` | yes | the prompt. English, usually, quoting Hebrew inside it. Plain text, no markdown. |
| `why` | yes | one or two sentences explaining the answer, in English, quoting Hebrew with nikud. Shown after grading, right or wrong. This is the part that teaches, so make it worth reading. |
| `tags` | no | array of extra strings, e.g. `["translit"]`, which is the one tag with a meaning: it lets a typed answer be Latin letters. |

## Types

### `mcq` - pick one
```json
{ "id": "nikud-03", "type": "mcq",
  "q": "Which vowel sign is under the first letter of בַּיִת?",
  "choices": ["פַּתָּח", "קָמָץ", "סֶגּוֹל", "צֵירֵי"],
  "a": 1,
  "why": "It is a קָמָץ. In modern Israeli Hebrew קָמָץ and פַּתָּח both say /a/, which is why they have to be told apart by shape rather than by sound." }
```
`a` is the **index** into `choices`. 3-4 choices. Wrong choices must be
plausible mistakes a learner actually makes, not filler. This is the type to
reach for whenever the answer would be impossible to type.

A question may turn on the difference between two forms that are spelled alike
and pointed differently, such as מַה שְׁלוֹמְךָ against מַה שְׁלוֹמֵךְ. That is
allowed. The app notices that hiding the points would leave two identical
buttons and keeps them on every choice in that question, whatever the nikud
toggle says. `order` chips work the same way. The checker reports it as a
warning so it is never done by accident.

### `fill` - type the answer
```json
{ "id": "nouns-gender-05", "type": "fill",
  "q": "Write the plural of סֵפֶר.",
  "a": ["סְפָרִים"],
  "why": "A masculine noun takes ־ִים. The vowels inside the word shift as well: סֵפֶר becomes סְפָרִים, not סֵפֶרִים." }
```
`a` is an array of every acceptable answer; the first is the model answer shown
on failure. Grading strips case, the nikud, surrounding punctuation and outer
whitespace. Never ask the learner to type nikud: it will not be graded, and
they cannot type it.

Where the question is specifically asking for the unpointed spelling, which
happens in the chapter about full spelling and nowhere else, tag it
`"tags": ["unpointed"]` so the checker knows the missing points are the answer
rather than an omission.

If the prompt prints the words either side of the gap, put them in `pre` and
`post` and the whole sentence counts as right too.

### `order` - put the words in order
```json
{ "id": "adjectives-08", "type": "order",
  "q": "Build the phrase: the big house",
  "words": ["הַבַּיִת", "הַגָּדוֹל"],
  "a": ["הַבַּיִת", "הַגָּדוֹל"],
  "why": "The adjective follows the noun and repeats its ה: הַבַּיִת הַגָּדוֹל. Without the second ה it reads as a sentence, \"the house is big\"." }
```
`words` is what gets shuffled and shown as chips; `a` is the correct order.
Add `"also": [[...]]` for other orders that are equally correct.

A chip is one Hebrew word, or a fixed pair that is written apart but read as
one thing (`בֵּית סֵפֶר`). Prefixes stay glued to their word: `בַּבַּיִת` is one
chip, never `בְּ` plus `הַבַּיִת`. Leave the final `?` or `!` out. Every chip must
be used, and only one arrangement should read as correct - otherwise list the
rest in `also`.

### `listen` - hear it, write it
```json
{ "id": "dagesh-shin-11", "type": "listen",
  "say": "שָׁלוֹשׁ שָׁעוֹת",
  "q": "Type what you hear.",
  "a": ["שלוש שעות", "שָׁלוֹשׁ שָׁעוֹת"],
  "why": "Both words start with שׁ, and the second has an ע the ear cannot hear at all: the vowel is the only clue that it is there." }
```
`say` is what the speech synthesiser reads, and it must carry nikud, because
the points are how the voice knows which vowel to say. Never put the answer in
`q`. Keep `say` to six words or fewer - that is what the voices do well.

### `say` - read it aloud
```json
{ "id": "first-words-12", "type": "say",
  "q": "Say this out loud.",
  "target": "נָעִים מְאֹד",
  "why": "The stress is on the last syllable of both words: na-IM me-OD. English speakers put it on the first and it stops sounding like Hebrew." }
```
`target` is what the microphone is checked against, and it carries nikud so the
"hear it first" button reads it properly. One to six words, no more: the
recogniser guesses long sentences from context and stops being evidence of
anything. No `a` field.

### `open` - free answer, you mark it
```json
{ "id": "nouns-gender-14", "type": "open",
  "q": "Name three endings that usually mean a noun is feminine, with an example each.",
  "a": ["ָה as in מִשְׁפָּחָה, ־ת as in רַכֶּבֶת, ־וּת as in חֲנוּת - and the body parts that are feminine with no ending at all, like יָד and רֶגֶל"],
  "why": "Endings are the only systematic handle on Hebrew gender; the rest is memory, and the paired body parts are the list worth memorising." }
```
`a[0]` is the model answer, revealed when you ask for it. You grade yourself.

## Writing rules

- **12 to 15 questions per chapter.** Cover the whole chapter, not just its
  first section. Read the chapter markdown before writing.
- **Only test what the chapter teaches.** No vocabulary the chapter never used,
  no grammar from a later chapter.
- **Mix the types.** Per chapter, roughly: 5 `mcq`, 3-4 `fill`, 1-2 `order`,
  1 `listen`, 1-2 `say`, 1 `open`. The reading and sound chapters (Part I,
  1-7) lean harder on `listen` and `say`, and use `mcq` for "which letter is
  this"; grammar chapters lean on `fill` and `order`.
- **Never ask the learner to type nikud**, and never make the answer to a
  question be a vowel sign that has to be typed. Ask it as an `mcq`.
- **Order easy to hard** inside the file.
- **The Hebrew must be correct modern Israeli Hebrew.** Check every string for:
  the wrong final letter, a missing dagesh in בּ כּ פּ, kamatz against patach,
  shva against a chataf vowel, and full spelling used consistently.
- **`why` is not optional and not a restatement of the answer.** It gives the
  rule, and where useful the contrast that makes the rule stick.

Then run `python3 tools/check-tests.py`, and fix the warnings as well as the
errors.
