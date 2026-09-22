/* ============================================================
   hebrew.js - the few things every other module needs to know
   about Hebrew text.

   Three jobs. Strip the vowel points from a string, because
   grading never looks at them and the reading toggle hides them.
   Reduce a string to what a learner could reasonably type, which
   is what an answer is compared against. And tell a final letter
   from its ordinary form, because writing one for the other is a
   spelling slip rather than a wrong answer.

   Loaded before everything except data.js, so anything may call it.
   ============================================================ */

window.Heb = (function () {
  'use strict';

  var KEY = 'hamachberet.nikud';

  // Cantillation, the vowel points, dagesh, the shin and sin dots, meteg
  // and rafe. Deliberately not here: maqaf U+05BE, paseq U+05C0, sof pasuq
  // U+05C3 and nun hafukha U+05C6, which are punctuation, not pointing.
  var MARKS = /[֑-ׇֽֿׁׂׅׄ]/g;
  var LETTER = /[א-ת]/;

  var FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  var TO_FINAL = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };

  function strip(s) {
    return String(s == null ? '' : s).normalize('NFC').replace(MARKS, '');
  }

  function hasHebrew(s) { return LETTER.test(String(s == null ? '' : s)); }

  // Everything a learner cannot be expected to type, gone: the points, the
  // maqaf and every other dash, geresh and gershayim, straight and curly
  // quotes. What is left is letters, digits and single spaces.
  function plain(s) {
    return strip(s)
      .replace(/[־‐-―\-]/g, ' ')
      .replace(/[׳״‘’“”'"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // The same letter whether or not it is in its final form. Used only to
  // decide that an answer is right apart from the shape of one letter.
  function unfinal(s) {
    return String(s == null ? '' : s).replace(/[ךםןףץ]/g, function (c) { return FINALS[c]; });
  }

  var on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* private mode */ }

  function nikudOn() { return on; }

  function setNikud(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* private mode */ }
  }

  // What to draw: the text as it was written, or with the points taken out.
  // Never used for anything handed to speech synthesis, which wants them.
  function show(s) { return on ? String(s == null ? '' : s) : strip(s); }

  return {
    strip: strip, plain: plain, unfinal: unfinal, hasHebrew: hasHebrew,
    show: show, nikudOn: nikudOn, setNikud: setNikud,
    FINALS: FINALS, TO_FINAL: TO_FINAL, MARKS: MARKS
  };
})();
