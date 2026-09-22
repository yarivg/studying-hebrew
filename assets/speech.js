/* ============================================================
   speech.js - checking that what you said is recognisable as
   the Hebrew you were asked to say.

   The browser's speech recogniser transcribes you, and we compare
   its transcript to the target. That measures intelligibility, not
   accent: the recogniser has a language model, so it will forgive a
   sloppy vowel in a word it can guess from context. Short targets
   keep it honest, which is why the test bank caps `say` items at a
   few words.

   Where recognition is missing (Firefox, older Safari) the caller
   falls back to hearing the model and marking yourself.
   ============================================================ */

window.Speech = (function () {
  'use strict';

  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;

  function supported() { return !!Rec; }

  /* ---------------------------------------------------------- listening */

  var active = null;

  // Resolves with the best transcript, or rejects with a message worth
  // showing. Only one recogniser may run at a time.
  function listen(opts) {
    opts = opts || {};
    if (!Rec) return Promise.reject(new Error('This browser cannot listen.'));
    stop();

    return new Promise(function (resolve, reject) {
      var rec = new Rec();
      rec.lang = opts.lang || 'he-IL';
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      rec.continuous = false;

      var settled = false;
      var alternatives = [];

      // Some platforms end the session without ever firing `result`.
      var guard = setTimeout(function () { try { rec.stop(); } catch (e) {} }, opts.timeout || 8000);

      rec.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (!r.isFinal) {
            if (opts.onPartial) opts.onPartial(r[0].transcript);
            continue;
          }
          for (var j = 0; j < r.length; j++) alternatives.push(r[j].transcript);
        }
      };

      rec.onerror = function (e) {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        reject(new Error(errorMessage(e.error)));
      };

      rec.onend = function () {
        clearTimeout(guard);
        active = null;
        if (settled) return;
        settled = true;
        if (!alternatives.length) {
          reject(new Error('I did not catch anything. Try again, a little louder.'));
        } else {
          resolve(alternatives);
        }
      };

      try {
        rec.start();
        active = rec;
        if (opts.onStart) opts.onStart();
      } catch (e) {
        settled = true;
        clearTimeout(guard);
        reject(new Error('Could not start the microphone.'));
      }
    });
  }

  function stop() {
    if (!active) return;
    try { active.stop(); } catch (e) { /* already stopping */ }
    active = null;
  }

  function errorMessage(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'The microphone is blocked. Allow it for this site and try again.';
      case 'no-speech':
        return 'I did not hear anything.';
      case 'audio-capture':
        return 'No microphone found.';
      case 'network':
        return 'Speech recognition needs a connection, and it could not reach the service.';
      case 'aborted':
        return 'Stopped.';
      default:
        return 'The recogniser failed (' + code + ').';
    }
  }

  /* ---------------------------------------------------------- comparing */

  // The points never survive a recogniser, and the course writes them, so
  // both sides are flattened to bare letters, digits and spaces.
  function normalise(s) {
    return Heb.plain(String(s || ''))
      .toLowerCase()
      .replace(/[^\u05D0-\u05EA0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Recognisers write numbers as digits; the course writes them as words,
     and a Hebrew number has one form for each gender. Either form counts,
     because the recogniser hands back the digit and cannot say which of the
     two was actually spoken. */
  var NUMBERS = {
    '0': ['אפס'], '1': ['אחת', 'אחד'], '2': ['שתיים', 'שניים', 'שתי', 'שני'],
    '3': ['שלוש', 'שלושה'], '4': ['ארבע', 'ארבעה'], '5': ['חמש', 'חמישה'],
    '6': ['שש', 'שישה'], '7': ['שבע', 'שבעה'], '8': ['שמונה'],
    '9': ['תשע', 'תשעה'], '10': ['עשר', 'עשרה'],
    '20': ['עשרים'], '30': ['שלושים'], '40': ['ארבעים'], '50': ['חמישים'],
    '100': ['מאה'], '1000': ['אלף']
  };

  // The raw token is kept: compare() below is what knows a digit and a
  // number word are the same thing, and it needs both sides as written.
  function tokens(s) {
    return normalise(s).split(' ').filter(Boolean);
  }

  // A digit on one side and its word on the other is not a mistake.
  function sameNumber(a, b) {
    var forms = NUMBERS[a];
    if (forms && forms.indexOf(b) !== -1) return true;
    forms = NUMBERS[b];
    return !!forms && forms.indexOf(a) !== -1;
  }

  /* A rough spelling-to-sound key, so a word the recogniser heard right but
     wrote in another of its spellings still counts. Hebrew has several
     letters per sound and two spellings per word, and the recogniser picks
     whichever its language model prefers. Deliberately crude: it only has
     to stop false failures, not transcribe Hebrew. */
  function sounds(word) {
    var w = Heb.unfinal(word);
    // Alef, ayin and hei carry little or no sound of their own, and a
    // recogniser drops them as readily as it writes them.
    w = w.replace(/[אעה]/g, '');
    // Vav and yod are the whole difference between full and defective
    // spelling: שָׁלוֹם is written שלום and heard back as שלם, מְאוֹד as מאד.
    // Since the recogniser picks whichever it likes, neither side keeps them.
    // This does conflate a few real pairs, which is the price of a key that
    // is only ever used to soften a near miss, never to declare a match.
    w = w.replace(/[וי]/g, '');
    // Letters that share one sound in Israeli Hebrew.
    w = w.replace(/[תט]/g, 'ת').replace(/[כק]/g, 'כ').replace(/[סש]/g, 'ס');
    w = w.replace(/(.)\1+/g, '$1');
    return w || word;
  }

  /* Score one attempt against the target.

     Returns { pct, words: [{ word, state }], heard } where state is
     'ok' (heard as written), 'close' (right sound, other spelling) or
     'miss'. Alignment is a plain edit-distance table over the two word
     lists, so a dropped or inserted word shifts nothing after it. */
  function compare(target, heard) {
    var t = tokens(target), h = tokens(heard);
    var ts = t.map(sounds), hs = h.map(sounds);

    var n = t.length, m = h.length;
    var d = [], i, j;
    for (i = 0; i <= n; i++) { d[i] = [i]; }
    for (j = 0; j <= m; j++) { d[0][j] = j; }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var exact = t[i - 1] === h[j - 1] || sameNumber(t[i - 1], h[j - 1]);
        var cost = exact ? 0 : (ts[i - 1] === hs[j - 1] ? 0.25 : 1);
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      }
    }

    // Walk the table back to find what happened to each target word.
    var states = new Array(n);
    i = n; j = m;
    while (i > 0) {
      if (j > 0) {
        var hit = t[i - 1] === h[j - 1] || sameNumber(t[i - 1], h[j - 1]);
        var sub = hit ? 0 : (ts[i - 1] === hs[j - 1] ? 0.25 : 1);
        if (d[i][j] === d[i - 1][j - 1] + sub) {
          states[i - 1] = sub === 0 ? 'ok' : sub === 0.25 ? 'close' : 'miss';
          i--; j--;
          continue;
        }
      }
      if (d[i][j] === d[i - 1][j] + 1) { states[i - 1] = 'miss'; i--; continue; }
      j--;   // an extra word in the transcript; nothing to blame on the target
    }

    var got = 0;
    states.forEach(function (s) { if (s === 'ok') got += 1; else if (s === 'close') got += 0.9; });
    var extra = Math.max(0, m - n);
    // Words you said that were not asked for still cost something, or
    // reading the whole page aloud would score full marks.
    var pct = n ? Math.round(Math.max(0, (got - extra * 0.5) / n) * 100) : 0;

    return {
      pct: pct,
      heard: h.join(' '),
      words: t.map(function (w, k) {
        return { word: Heb.plain(target).split(/\s+/)[k] || w, state: states[k] || 'miss' };
      })
    };
  }

  // Recognisers return several guesses; the kindest one is the fairest,
  // since a lower-ranked alternative matching means the sounds were there.
  function best(target, alternatives) {
    var top = null;
    (alternatives || []).forEach(function (alt) {
      var r = compare(target, alt);
      if (!top || r.pct > top.pct) top = r;
    });
    return top || { pct: 0, heard: '', words: [] };
  }

  var PASS = 80;

  /* A transcript can fail in two different ways, and they deserve different
     answers. Either the recogniser understood you and you said the wrong
     thing, or it did not produce anything usable, most often by collapsing
     a short phrase into one real word that happens to fit the sounds. The
     second is not evidence about your pronunciation, so it must not be
     reported as a failed attempt. */
  function unusable(target, r) {
    var want = tokens(target).length, got = r.heard ? r.heard.split(' ').length : 0;
    if (!got) return true;
    // Fewer words than asked for, and nothing matched: it guessed a word
    // rather than transcribing what it heard.
    if (got < want && r.pct < 50) return true;
    // Every single word missed on a short phrase is far likelier to be a
    // bad transcript than a person who got every sound wrong.
    if (want <= 3 && r.pct === 0) return true;
    return false;
  }

  function check(target, opts) {
    return listen(opts).then(function (alternatives) {
      var r = best(target, alternatives);
      r.pass = r.pct >= PASS;
      r.unclear = !r.pass && unusable(target, r);
      return r;
    });
  }

  return {
    supported: supported, listen: listen, stop: stop, check: check,
    compare: compare, best: best, normalise: normalise, sounds: sounds,
    PASS: PASS
  };
})();
