/* ============================================================
   check-grading.js - run every bank answer through the real grader.

   check-tests.py validates the shape of a bank. This validates its
   behaviour, by loading assets/test.js itself and asking it to grade each
   model answer against its own question. Two things have to hold:

     the answer as written grades as correct
     the answer with the nikud stripped grades as correct too

   The second is the one that matters. The course writes Hebrew in full
   spelling with the points on top precisely so that taking the points off
   leaves what a learner types. If an answer was written in defective
   spelling, stripping the points leaves something nobody would type, and
   this is where that shows up.

   Run:  node tools/check-grading.js
   ============================================================ */

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.dirname(__dirname);

// test.js is a browser module: give it the handful of globals it touches at
// load time, and nothing more.
global.window = global;
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };
global.document = { addEventListener: function () {}, querySelector: function () { return null; } };
global.Data = { json: function () { return Promise.resolve(null); } };
global.Progress = {
  setEx: function () {}, recordTest: function () {},
  mastery: function () { return { level: 0 }; },
  testScore: function () { return { runs: 0 }; }
};

require(path.join(ROOT, 'assets', 'hebrew.js'));
require(path.join(ROOT, 'assets', 'test.js'));

function findBanks(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (name) {
    var p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) return findBanks(p, out);
    if (name.slice(-5) === '.json' && name !== 'groups.json') out.push(p);
  });
  return out;
}

function main() {
  var files = findBanks(path.join(ROOT, 'content', 'tests'), []).sort();
  var checked = 0;
  var problems = [];

  files.forEach(function (file) {
    var rel = path.relative(ROOT, file);
    var bank;
    try {
      bank = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      problems.push(rel + ': not valid JSON: ' + e.message);
      return;
    }

    (bank.questions || []).forEach(function (q) {
      var where = rel + ' [' + (q.id || '-') + ']';

      if (q.type === 'fill' || q.type === 'listen') {
        if (!Array.isArray(q.a) || !q.a.length) return;   // check-tests.py says so
        checked++;
        var asWritten = Test.gradeText(q, q.a[0]);
        if (asWritten !== true) {
          problems.push(where + ': the model answer does not grade as correct (' + asWritten + ')');
        }
        var unpointed = Test.gradeText(q, Heb.strip(q.a[0]));
        if (unpointed !== true) {
          problems.push(where + ': the answer with the nikud stripped grades as ' + unpointed +
            '; it is probably written in defective spelling, so taking the points off ' +
            'leaves ' + Heb.strip(q.a[0]) + ' rather than what a learner types');
        }
      }

      if (q.type === 'order') {
        if (!Array.isArray(q.a)) return;
        checked++;
        if (Test.gradeOrder(q, q.a) !== true) {
          problems.push(where + ': the stated order does not grade as correct');
        }
      }

      if (q.type === 'mcq') {
        checked++;
        if (!Array.isArray(q.choices) || !(q.a >= 0 && q.a < q.choices.length)) {
          problems.push(where + ': answer index out of range');
        }
      }
    });
  });

  console.log(files.length + ' banks checked, ' + checked + ' auto-graded questions');

  if (problems.length) {
    console.log('\n' + problems.length + ' problems:');
    problems.forEach(function (p) { console.log('  ' + p); });
    process.exit(1);
  }
  console.log('\nno problems');
}

main();
