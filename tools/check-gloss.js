/* ============================================================
   check-gloss.js - does tapping a word in a passage explain it?

   read.js resolves a tapped word against the passage's own gloss and then
   against data/vocab.json. That is harder in Hebrew than it sounds: the word
   list holds dictionary forms (the infinitive, the singular) and the passage
   holds inflected ones, so כָּתַבְתִּי has to find לִכְתּוֹב. The lookup does it
   with three tricks, in order: peel the one-letter prefixes, match on the
   root the word list stores for every verb, then take a plural or feminine
   ending off.

   The root match is a heuristic, so it is worth pinning down. This file does
   two things:

     1. runs a fixed list of inflected words and checks each resolves to the
        right entry, which catches a change that loosens or breaks the match
     2. reports what share of the words in the real passages resolve at all

   The share is information, not a threshold. A passage is allowed to contain
   words the word list has never heard of; that is what the `gloss` field is
   for, and check-reading.py is what enforces the rest.

   Run:  node tools/check-gloss.js
   ============================================================ */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.dirname(__dirname);

global.window = global;
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };
global.document = { addEventListener: function () {} };
global.Progress = {
  mastery: function () { return { level: 0 }; },
  testScore: function () { return { runs: 0 }; }
};
global.Test = { start: function () {} };
global.Data = { json: function () { return Promise.resolve(null); } };

require(path.join(ROOT, 'assets', 'hebrew.js'));

var vocabPath = path.join(ROOT, 'data', 'vocab.json');
var words = fs.existsSync(vocabPath)
  ? JSON.parse(fs.readFileSync(vocabPath, 'utf8')).words : [];
global.Vocab = { all: function () { return words; } };

require(path.join(ROOT, 'assets', 'read.js'));

/* The word as it appears in a passage, and a word that must be in the gloss
   it resolves to. One line per thing the lookup has to be able to do. */
var CASES = [
  ['כָּתַבְתִּי', 'write'],        // past, sound root
  ['כּוֹתֶבֶת', 'write'],          // present feminine
  ['יִכְתּוֹב', 'write'],          // future
  ['הָלַכְנוּ', 'go'],             // irregular root
  ['אָכַלְתִּי', 'eat'],           // guttural first letter
  ['רָצִיתִי', 'want'],            // weak root, the ה is gone
  ['שׁוֹתָה', 'drink'],            // weak root, present
  ['מְדַבֶּרֶת', 'speak'],         // pi'el, and must not find מִדְבָּר
  ['יְלָדִים', 'child'],           // masculine plural
  ['תְּמוּנוֹת', 'picture'],       // feminine plural, and must not find לָמוּת
  ['סְפָרִים', 'book'],            // plural with a vowel change
  ['נָשִׁים', 'woman'],            // irregular plural, listed on the entry
  ['בָּתִּים', 'house'],           // irregular plural
  ['הַבַּיִת', 'house'],           // one prefix
  ['וּבָעִיר', 'city']             // two prefixes
];

function main() {
  var failures = [];

  CASES.forEach(function (c) {
    var got = Read.lookup(c[0], []);
    if (!got || got.toLowerCase().indexOf(c[1]) === -1) {
      failures.push(c[0] + ' should resolve to something meaning "' + c[1] +
        '", got ' + (got ? '"' + got + '"' : 'nothing'));
    }
  });

  console.log(CASES.length + ' lookup cases checked');

  // How much of the real reading material resolves, for information.
  var index = path.join(ROOT, 'content', 'reading', 'index.json');
  if (fs.existsSync(index)) {
    var passages = JSON.parse(fs.readFileSync(index, 'utf8')).passages || [];
    var total = 0, hit = 0;
    passages.forEach(function (e) {
      var file = path.join(ROOT, 'content', 'reading', e.file);
      if (!fs.existsSync(file)) return;
      var p = JSON.parse(fs.readFileSync(file, 'utf8'));
      var pairs = Read.glossIndex(p);
      var seen = {};
      (p.text.match(/[א-ת][א-ת֑-ׇ]*/g) || [])
        .forEach(function (w) {
          if (seen[w]) return;
          seen[w] = 1;
          total++;
          if (Read.lookup(w, pairs)) hit++;
        });
    });
    if (total) {
      console.log('  ' + hit + ' of ' + total + ' distinct words across ' +
        passages.length + ' passages resolve (' +
        Math.round(100 * hit / total) + '%)');
    }
  }

  if (failures.length) {
    console.log('\n' + failures.length + ' problems:');
    failures.forEach(function (f) { console.log('  ' + f); });
    process.exit(1);
  }
  console.log('\nno problems');
}

main();
