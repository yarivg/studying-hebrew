/* ============================================================
   check-clean.js - does the text reach the voice intact?

   audio.js strips the things that surround an example in the source but
   should not be read out: a transliteration, a gloss in brackets, the arrow
   in a table of forms. Everything spoken goes through it, so a mistake there
   is silent in the worst way: the voice is handed rubbish and gets the blame.

   That is not hypothetical. The separator class was written [·-–], which is
   a *range* from U+00B7 to U+2013, and the Hebrew block sits inside it. Every
   line handed to the voice came back as a row of commas. It shipped, and it
   was diagnosed twice as a broken voice before anyone looked at the string.

   So: Hebrew in, Hebrew out, and the tidying still does its job.

   Run:  node tools/check-clean.js
   ============================================================ */

'use strict';

var path = require('path');
var ROOT = path.dirname(__dirname);

global.window = global;
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };
global.document = { addEventListener: function () {} };
global.addEventListener = function () {};

require(path.join(ROOT, 'assets', 'hebrew.js'));
require(path.join(ROOT, 'assets', 'audio.js'));

/* in, out, what it is testing */
var CASES = [
  ['שָׁלוֹם', 'שָׁלוֹם',
   'a pointed word survives untouched'],
  ['מַה שְׁלוֹמְךָ?',
   'מַה שְׁלוֹמְךָ?',
   'a question mark is kept, the points are kept'],
  ['בַיִת /bayit/', 'בַיִת',
   'a transliteration in slashes goes'],
  ['סֵפֶר (book)', 'סֵפֶר',
   'a gloss in brackets goes'],
  ['כּוֹתֵב ← כָתַב',
   'כּוֹתֵב, כָתַב',
   'an arrow becomes a pause, not the word "arrow"'],
  ['יָפֶה / יָפָה',
   'יָפֶה או יָפָה',
   'a slash between two Hebrew forms is read as "or"'],
  ['אֶחָד - שְׁנַיִם',
   'אֶחָד, שְׁנַיִם',
   'a hyphen between words becomes a pause'],
  ['אֶחָד · שְׁנַיִם',
   'אֶחָד, שְׁנַיִם',
   'so does a middot'],
  ['*בַיִת*', 'בַיִת',
   'the markdown emphasis marks go']
];

function main() {
  var failures = [];

  CASES.forEach(function (c) {
    var got = Say.clean(c[0]);
    if (got !== c[1]) {
      failures.push(c[2] + '\n      wanted ' + JSON.stringify(c[1]) +
        '\n      got    ' + JSON.stringify(got));
    }
  });

  // The blunt version of the same check, over the whole word list: nothing
  // that went in with Hebrew in it may come out without.
  var lost = 0, words = [];
  try {
    words = require(path.join(ROOT, 'data', 'vocab.json')).words;
  } catch (e) { /* not built yet */ }
  words.forEach(function (w) {
    if (Heb.hasHebrew(w.he) && !Heb.hasHebrew(Say.clean(w.he))) lost++;
  });
  if (lost) failures.push(lost + ' of ' + words.length +
    ' words in the list lose their Hebrew on the way to the voice');

  console.log(CASES.length + ' clean() cases checked, ' + words.length +
    ' words checked for loss');

  if (failures.length) {
    console.log('\n' + failures.length + ' problems:');
    failures.forEach(function (f) { console.log('  ' + f); });
    process.exit(1);
  }
  console.log('\nno problems');
}

main();
