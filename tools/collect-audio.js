/* ============================================================
   collect-audio.js - every Hebrew string the app can be asked to speak.

   Writes one job per string: the text to record and the name of the file it
   belongs in. tools/build-audio.py reads that and does the recording, so the
   names are decided here and only here. That matters more than it sounds: a
   clip is found at runtime by hashing the text, and if the builder hashed it
   even slightly differently every clip would be invisible. So this loads the
   real assets/audio.js and calls its own clean() and key().

   Where the strings come from, which is every path that reaches Say.speak():

     data/vocab.json        the word list, one clip per word
     content/tests          the `say` and `target` of every question
     content/reading        every line of every passage, and every word in it
     content/partN/*.md     every Hebrew run in every lesson, taken from the
                            rendered HTML rather than the markdown, because
                            that is what the page puts a play button on

   Run:  node tools/collect-audio.js [out.json]
   ============================================================ */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.dirname(__dirname);

/* The two modules need a window, a document that swallows listeners, and a
   localStorage. Neither touches the DOM at load beyond registering handlers. */
global.window = global;
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };
global.document = { addEventListener: function () {} };
global.addEventListener = function () {};

require(path.join(ROOT, 'assets', 'hebrew.js'));
require(path.join(ROOT, 'assets', 'md.js'));
require(path.join(ROOT, 'assets', 'audio.js'));

function read(p) { return fs.readFileSync(p, 'utf8'); }
function json(p) { return JSON.parse(read(p)); }
function ls(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(function (f) { return f.slice(-ext.length) === ext; })
    .map(function (f) { return path.join(dir, f); });
}

var jobs = {};      // key -> text
var seen = {};      // where each one came from, for the report
var counts = {};

function add(raw, where) {
  var say = Say.clean(raw);
  if (!say || !Heb.hasHebrew(say)) return;
  var k = Say.key(say);
  if (!jobs[k]) {
    jobs[k] = say;
    seen[k] = where;
    counts[where] = (counts[where] || 0) + 1;
  }
}

/* ---------------------------------------------------------- vocabulary */

var vocab = path.join(ROOT, 'data', 'vocab.json');
if (fs.existsSync(vocab)) {
  json(vocab).words.forEach(function (w) { add(w.he, 'vocabulary'); });
}

/* ---------------------------------------------------------- test banks */

['part1', 'part2', 'part3', 'part4'].forEach(function (part) {
  ls(path.join(ROOT, 'content', 'tests', part), '.json').forEach(function (f) {
    (json(f).questions || []).forEach(function (q) {
      if (q.say) add(q.say, 'test banks');
      if (q.target) add(q.target, 'test banks');
    });
  });
});

/* ---------------------------------------------------------- passages

   read.js speaks a passage a line at a time, and a tapped word on its own,
   so both are recorded. The line is the trimmed line; the word is the
   whitespace token, exactly as textHtml() splits them. */

ls(path.join(ROOT, 'content', 'reading'), '.json').forEach(function (f) {
  if (path.basename(f) === 'index.json') return;
  var p = json(f);
  String(p.text || '').split('\n').forEach(function (line) {
    line = line.trim();
    if (!line) return;
    add(line, 'passage lines');
    line.split(/\s+/).forEach(function (tok) { add(tok, 'passage words'); });
  });
});

/* ---------------------------------------------------------- lessons

   md.js wraps every Hebrew run in a span carrying the pointed text in
   data-he, and audio.js turns exactly those into play buttons. So the
   rendered HTML is the list, and nothing has to guess at the markdown. */

var manifest = json(path.join(ROOT, 'content', 'manifest.json'));
manifest.parts.forEach(function (part) {
  part.chapters.forEach(function (ch) {
    var file = path.join(ROOT, 'content', ch.file);
    if (!fs.existsSync(file)) return;
    var html = MD.render(read(file));
    var re = /data-he="([^"]*)"/g, m;
    while ((m = re.exec(html))) {
      add(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>').replace(/&amp;/g, '&'), 'lessons');
    }
  });
});

/* ---------------------------------------------------------- the rest */

// What the audio menu's Test button says.
add('שָׁלוֹם, אֲנִי ' +
    'לוֹמֵד עִבְרִית.', 'the voice test');

/* ---------------------------------------------------------- output */

var keys = Object.keys(jobs).sort();
var out = process.argv[2] || path.join(ROOT, 'audio', 'jobs.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  voice: 'Carmit',
  jobs: keys.map(function (k) { return { key: k, text: jobs[k] }; })
}, null, 0) + '\n');

var chars = keys.reduce(function (n, k) { return n + jobs[k].length; }, 0);
Object.keys(counts).sort().forEach(function (w) {
  console.log('  %s: %d', w, counts[w]);
});
console.log('%d strings, %d characters, about %d minutes of speech',
  keys.length, chars, Math.round(chars * 0.078 / 60));
console.log('wrote %s', path.relative(ROOT, out));
