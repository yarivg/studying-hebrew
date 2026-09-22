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

  /* ---------------------------------------------------------- direction

     The page is left to right and stays that way. But a block whose text is
     Hebrew - a chapter heading, the title of a story, an answer - reads from
     the right edge, and left where it lands it sits against the English
     margin with a ragged right side, which is the wrong way round.

     The browser's own `dir="auto"` cannot decide this for us. It ignores any
     descendant that carries a direction of its own, and md.js wraps every
     Hebrew run in exactly such a span, so a heading made entirely of them
     looks empty of strong characters and comes out left to right. So the
     call is made here, on the text.

     Applied by an observer rather than at each of the three dozen places
     that write innerHTML: those are spread across eight modules and several
     promises, and one missed call is a heading in the wrong place. */

  // Hebrew letters against Latin ones. A block is Hebrew when it has Hebrew
  // in it and no more Latin than that: "shalom, שָׁלוֹם" is a bilingual line
  // and stays left to right, "הַבֹּקֶר שֶׁל דָּנָה" does not.
  var LATIN = /[A-Za-z]/g;
  var HEBREW = /[א-ת]/g;

  function isRtl(s) {
    s = String(s == null ? '' : s);
    var he = (s.match(HEBREW) || []).length;
    if (!he) return false;
    return he > (s.match(LATIN) || []).length;
  }

  // Text blocks only. Nothing here is a flex or grid container, so setting a
  // direction on one cannot reorder a layout, only the text inside it.
  var BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,figcaption,blockquote,summary,' +
    '.rd-card-title,.rd-card-blurb,.sr-title,.v-en,.test-answer,.tr-mine,' +
    '.card h3,.card p,.flash-front,.flash-back,.gl-en';

  function mark(el) {
    // Already decided, by us or by whoever wrote the markup.
    if (el.hasAttribute('dir') || el.hasAttribute('data-dir')) return;
    el.setAttribute('data-dir', '1');
    if (!isRtl(el.textContent)) return;
    el.classList.add('he-rtl');
    el.setAttribute('dir', 'rtl');
    el.removeAttribute('data-dir');
  }

  // Run over anything newly rendered. Cheap: each element is visited once,
  // and marked so a later pass skips it.
  function autoDir(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.nodeType === 1 && root.matches && root.matches(BLOCKS)) mark(root);
    var all = root.querySelectorAll(BLOCKS);
    for (var i = 0; i < all.length; i++) mark(all[i]);
  }

  function watch() {
    var body = document.body;
    if (!body) return;
    autoDir(body);
    if (!window.MutationObserver) return;
    var queued = null;
    // childList only, so setting dir and class below cannot feed the
    // observer its own output.
    new MutationObserver(function (records) {
      if (queued) return;
      queued = records;
      requestAnimationFrame(function () {
        var seen = queued;
        queued = null;
        for (var i = 0; i < seen.length; i++) {
          var added = seen[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j].nodeType === 1) autoDir(added[j]);
          }
        }
      });
    }).observe(body, { childList: true, subtree: true });
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', watch);
    } else {
      watch();
    }
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
    isRtl: isRtl, autoDir: autoDir,
    FINALS: FINALS, TO_FINAL: TO_FINAL, MARKS: MARKS
  };
})();
