/* ============================================================
   check-speech.js - does a `say` answer get judged fairly?

   speech.js scores what the browser's recogniser transcribed against what
   the question asked for. In Hebrew that is harder than it looks, because
   the recogniser and the course do not agree on spelling: the course writes
   שָׁלוֹם and מְאוֹד in full spelling, and the recogniser hands back שלם and
   מאד. None of that is a pronunciation mistake, and none of it should cost
   the learner a mark.

   speech.js absorbs it with a deliberately crude sound key, and a crude
   heuristic is exactly the thing that rots silently when someone tidies it.
   So this pins down both directions:

     a real answer, however the recogniser chose to spell it, passes
     an answer that is actually wrong still fails

   Run:  node tools/check-speech.js
   ============================================================ */

'use strict';

var path = require('path');
var ROOT = path.dirname(__dirname);

global.window = global;
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };

require(path.join(ROOT, 'assets', 'hebrew.js'));
require(path.join(ROOT, 'assets', 'speech.js'));

/* target, what the recogniser wrote, must it pass, what it is testing */
var CASES = [
  ['שָׁלוֹם, מַה נִשְׁמָע', 'שלום מה נשמע', true,
   'the same words, unpointed, which is all a recogniser ever returns'],
  ['תּוֹדָה רַבָּה', 'תודה רבה', true,
   'exact match once the points are off'],
  ['נָעִים מְאוֹד', 'נעים מאד', true,
   'the recogniser chose defective spelling for מאוד'],
  ['שָׁלוֹם', 'שלם', true,
   'defective spelling, a whole letter shorter'],
  ['אֲנִי לוֹמֵד עִבְרִית', 'אני לומד עברית', true,
   'a whole sentence'],
  ['שָׁלוֹשׁ שָׁעוֹת', '3 שעות', true,
   'a digit where the course wrote the number as a word'],
  ['שְׁתֵּי דַּקּוֹת', '2 דקות', true,
   'the same, with the feminine form of the number'],
  ['בֵּית סֵפֶר', 'משהו אחר לגמרי', false,
   'nothing to do with the target'],
  ['תּוֹדָה רַבָּה', 'שלום', false,
   'a real Hebrew phrase, but not this one']
];

function main() {
  var failures = [];

  CASES.forEach(function (c) {
    var target = c[0], heard = c[1], shouldPass = c[2], what = c[3];
    var r = Speech.compare(target, heard);
    var passed = r.pct >= Speech.PASS;
    if (passed !== shouldPass) {
      failures.push(what + ': scored ' + r.pct + '%, which ' +
        (passed ? 'passes' : 'fails') + ', and it should ' +
        (shouldPass ? 'pass' : 'fail'));
    }
  });

  console.log(CASES.length + ' speech cases checked (pass mark ' + Speech.PASS + '%)');

  if (failures.length) {
    console.log('\n' + failures.length + ' problems:');
    failures.forEach(function (f) { console.log('  ' + f); });
    process.exit(1);
  }
  console.log('\nno problems');
}

main();
