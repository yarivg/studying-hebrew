/* ============================================================
   audio.js - spoken Hebrew, straight from the browser.

   Uses the Web Speech API (speechSynthesis), so there are no
   sound files to ship and nothing to download. Every Hebrew
   example in a lesson becomes clickable: click it and a Hebrew
   voice reads it. Transliterations get a play button of their
   own, wired to the word they transcribe: /shalom/ is only
   useful if you can hear what it stands for.

   What is spoken always keeps its nikud, even when the page is
   showing the text without it: the points are what tell the
   voice which vowel to say.

   Preferences (on/off, slow, chosen voice) live in localStorage
   next to the rest of the app's state.
   ============================================================ */

window.Say = (function () {
  'use strict';

  var KEY = 'hamachberet.audio';
  var synth = window.speechSynthesis || null;

  var prefs = load();
  var voices = [];
  var current = null;      // the SpeechSynthesisVoice we speak with
  var speakingEl = null;

  function load() {
    var p = { on: true, slow: false, voice: '' };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (typeof saved.on === 'boolean') p.on = saved.on;
        if (typeof saved.slow === 'boolean') p.slow = saved.slow;
        if (typeof saved.voice === 'string') p.voice = saved.voice;
      }
    } catch (e) { /* corrupt or unavailable storage: defaults are fine */ }
    return p;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
  }

  /* ---------------------------------------------------------- voices */

  // Voices arrive asynchronously in most browsers, and Chrome only
  // populates the list after the first getVoices() call.
  var voiceSig = '';

  function refreshVoices() {
    if (!synth) return;
    voices = (synth.getVoices() || []).filter(function (v) {
      return /^he/i.test(v.lang);
    });
    current = pickVoice();
    // Chrome fires voiceschanged more than once, and redrawing the menu
    // while it is open throws away a select the user is in the middle of.
    var sig = voices.map(function (v) { return v.voiceURI; }).join('|');
    if (sig === voiceSig) return;
    voiceSig = sig;
    paintMenu();
  }

  // The Hebrew voices the systems ship. Carmit is Apple's, and is the one
  // worth installing; the Google voice is what Android and Chrome offer.
  var GOOD = ['carmit', 'google עברית', 'hebrew'];

  // Prefer the saved choice, then a natural-sounding Israeli voice that is
  // installed locally (those work offline and sound the least robotic).
  function pickVoice() {
    if (!voices.length) return null;
    var saved = voices.filter(function (v) { return v.voiceURI === prefs.voice; })[0];
    if (saved) return saved;

    var best = null, bestScore = -1;
    voices.forEach(function (v) {
      var name = v.name.toLowerCase();
      var score = 0;
      var rank = GOOD.indexOf(name.split(/[(]/)[0].trim());
      if (rank === -1) {
        // "Carmit (Enhanced)" and "Google עברית" both match on the first word.
        GOOD.forEach(function (g, i) { if (rank === -1 && name.indexOf(g) !== -1) rank = i; });
      }
      if (rank !== -1) score += 100 - rank;
      if (/^he[-_]?IL/i.test(v.lang)) score += 20;
      if (v.localService) score += 10;
      // Apple's "Eddy", "Grandma", "Rocko" and friends are jokes, not models.
      if (/\(/.test(v.name) && rank === -1) score -= 5;
      if (score > bestScore) { bestScore = score; best = v; }
    });
    return best;
  }

  function supported() { return !!synth; }
  function available() { return !!synth && voices.length > 0; }
  function enabled() { return prefs.on && available(); }
  // Whether the user has the voice switched on, regardless of whether a
  // Hebrew voice has been enumerated yet. Mobile browsers populate
  // getVoices() late or not at all, and speak() does not need the list: it
  // falls back to lang="he-IL" and lets the system choose. Anything that
  // only needs to know "would speaking work" asks this rather than
  // enabled(), which would answer no on a phone that speaks perfectly well.
  function on() { return !!synth && prefs.on; }

  /* ---------------------------------------------------------- speaking */

  // Strip the things that surround an example in the source text but
  // should not be read out: glosses in brackets, transliterations, markers.
  function clean(text) {
    return String(text || '')
      // Drop a transliteration, but only a real one: it is Latin letters
      // between slashes with no Hebrew in it. A slash between two Hebrew
      // forms is something else, and is handled below.
      .replace(/\/[^/]*\//g, function (m) {
        return /[a-z]/i.test(m) && !/[\u05D0-\u05EA]/.test(m) ? ' ' : m;
      })
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[*_`«»"]/g, ' ')
      // A slash between two Hebrew forms is the course's way of writing
      // "masculine / feminine". Read out it becomes "lokhsan", so say the
      // word instead: יָפֶה או יָפָה.
      .replace(/([\u05D0-\u05EA\u0591-\u05C7])\s*\/\s*(?=[\u05D0-\u05EA])/g, '$1 \u05d0\u05d5 ')
      .replace(/\//g, ' ')
      // An arrow means "becomes": the tables are full of "כּוֹתֵב ← כָּתַב".
      // Left in, a voice announces it as an arrow. A comma gives the pause
      // that makes the pair audible as two forms of one word.
      .replace(/\s*(→|⟶|⇒|->|←)\s*/g, ', ')
      .replace(/\s*[·-–]\s*/g, ', ')
      .replace(/‑/g, '-')
      .replace(/…/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Bumped by every speak() and every stop(), so an utterance that is
  // cancelled can tell it was cancelled: browsers are inconsistent about
  // whether cancel() arrives as `end` or as an `interrupted` error.
  var epoch = 0;

  // The last thing the engine complained about, for the Test button to show.
  // Nothing else reads it: a failure in the middle of a lesson should not put
  // an error message where the learner is trying to read.
  var lastError = '';
  // Set when the chosen voice turned out to be silent and the engine was
  // asked to pick instead. The Test button is the only thing that says so.
  var fellBack = false;

  /* Two long-standing engine bugs, both of which present as "the voice does
     not work at all", and neither of which is anything to do with the voice.

     Chrome and Edge drop an utterance queued in the same tick as a cancel().
     Every call here begins with a cancel, so on those browsers every click
     after the first was being swallowed.

     Chrome also stops mid-utterance after about fifteen seconds unless
     something pokes it. A passage read line by line runs straight into that.
     An engine that is not paused ignores resume(), so the timer below costs
     nothing anywhere else. */

  var ticker = null;

  /* A third failure, and the one that leaves a voice sitting in the menu
     doing nothing: the browser lists a voice it cannot actually drive.
     Chrome on macOS does this with the Apple voices. The utterance is
     accepted, `end` fires within a few milliseconds, and nothing is heard.

     There is no flag for it, so it is measured. Hebrew at the rate below
     runs about 78ms a character; an utterance that ends in a fraction of
     what it should have taken did not speak. Naming no voice at all and
     asking for he-IL usually works where naming one did not, because the
     engine then picks for itself. */

  var silent = {};      // voiceURI -> we have caught it returning silence

  function tooFast(say, rate, ms) {
    var should = say.length * 78 / (rate || 1);
    return ms < Math.min(500, should * 0.25);
  }

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      if (!synth || !synth.speaking) { stopTicker(); return; }
      if (synth.paused) synth.resume();
      else { synth.pause(); synth.resume(); }
    }, 5000);
  }

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  function speak(text, opts) {
    opts = opts || {};
    if (!synth || !prefs.on) return false;
    var say = clean(text);
    if (!say) return false;

    var mine = ++epoch;
    var busy = synth.speaking || synth.pending || synth.paused;
    synth.cancel();

    var el = opts.el || null;
    if (el) {
      speakingEl = el;
      el.classList.add('is-speaking');
    }

    // `finished` is false when something cancelled us - a new utterance, a
    // route change - which is how a caller reading a passage line by line
    // knows to stop rather than plough on.
    var settled = false;
    function done(finished) {
      if (settled) return;
      settled = true;
      stopTicker();
      if (el) {
        el.classList.remove('is-speaking');
        if (speakingEl === el) speakingEl = null;
      }
      if (opts.onEnd) opts.onEnd(finished && mine === epoch);
    }

    var rate = (opts.slow || prefs.slow) ? 0.6 : 0.9;
    var began = 0;

    // `named` is whether to hand the engine the chosen voice. False is the
    // fallback: lang alone, and let it choose.
    function go(named) {
      // Something else started speaking while we were waiting out the cancel.
      if (mine !== epoch) { done(false); return; }
      var use = named && current && !silent[current.voiceURI] ? current : null;
      var u = new SpeechSynthesisUtterance(say);
      u.lang = use ? use.lang : 'he-IL';
      if (use) u.voice = use;
      u.rate = rate;
      u.pitch = 1;
      u.onstart = function () { lastError = ''; startTicker(); };
      u.onend = function () {
        if (use && tooFast(say, rate, Date.now() - began)) {
          silent[use.voiceURI] = 1;
          fellBack = true;
          go(false);
          return;
        }
        done(true);
      };
      u.onerror = function (e) {
        var err = e && e.error;
        var ours = err !== 'interrupted' && err !== 'canceled';
        // Same fallback for a voice the engine refuses outright.
        if (ours && use) {
          silent[use.voiceURI] = 1;
          fellBack = true;
          go(false);
          return;
        }
        if (err && ours) lastError = err;
        done(ours);
      };
      began = Date.now();
      synth.speak(u);
      startTicker();
    }

    if (busy) setTimeout(function () { go(true); }, 140);
    else go(true);
    return true;
  }

  function stop() {
    epoch++;
    stopTicker();
    if (synth) synth.cancel();
    if (speakingEl) { speakingEl.classList.remove('is-speaking'); speakingEl = null; }
  }

  /* ---------------------------------------------------------- hydration */

  var SPEAKER =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z"/>' +
    '<path d="M15.6 9a4 4 0 0 1 0 6M18.3 6.5a7.6 7.6 0 0 1 0 11"/></svg>';

  // Italic text in a lesson is, by the convention of these notes, a Hebrew
  // example, and md.js wraps every Hebrew run in a .he span besides. Both
  // become something you can click and hear.
  // What a marked-up element should be read as. The page may be showing the
  // text with the points switched off, but the voice needs them: unpointed,
  // it has to guess the vowels, and a wrong guess is a different word. So
  // every Hebrew run carries its pointed source in data-he, and that is what
  // is read out.
  function source(el) {
    if (el.dataset && el.dataset.he) return el.dataset.he;
    var pointed = el.querySelectorAll ? el.querySelectorAll('[data-he]') : null;
    if (!pointed || !pointed.length) return el.textContent;
    var copy = el.cloneNode(true);
    var spans = copy.querySelectorAll('[data-he]');
    for (var i = 0; i < spans.length; i++) {
      spans[i].textContent = spans[i].getAttribute('data-he');
    }
    return copy.textContent;
  }

  function markExample(el) {
    if (el.dataset.say != null) return;
    if (el.closest('.ex-en, .v-en, .callout-label, .say-btn')) return;
    // A .he span inside an italic that is already wired would give the same
    // words a second control sitting inside the first.
    if (el.classList.contains('he') && el.closest('[data-say]')) return;
    var text = clean(source(el));
    // Short runs are examples; a long one is a sentence of English prose
    // being emphasised, and a Hebrew voice would mangle it.
    if (!text || text.length > 60 || text.split(/\s+/).length > 6) return;
    if (!Heb.hasHebrew(text)) return;
    el.dataset.say = text;
    el.classList.add('say');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Hear “' + text + '”');
  }

  // A transliteration cannot be spoken as written, so its play button reads
  // the Hebrew it belongs to: the example in the same table row, the
  // question above the answer, or the nearest Hebrew run before it.
  // The candidate inside `scope` that this transcription belongs to: the last
  // one before it, so a cell holding two pairs gives each its own word,
  // falling back to the first when the transcription comes before them all.
  function nearestEm(scope, el) {
    var best = '';
    scope.querySelectorAll('em, .he').forEach(function (candidate) {
      if (candidate.contains(el)) return;
      var text = clean(source(candidate));
      if (!Heb.hasHebrew(text)) return;
      if (el.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_PRECEDING) best = text;
    });
    if (best) return best;
    var all = scope.querySelectorAll('em, .he');
    for (var i = 0; i < all.length; i++) {
      var t = clean(source(all[i]));
      if (Heb.hasHebrew(t)) return t;
    }
    return '';
  }

  function trSource(el) {
    var td = el.closest('td, th');
    if (td) {
      // The word a transcription belongs to is nearly always beside it in the
      // same cell: "*grand* /gʁɑ̃/". That has to win, or a row built as
      // "*grand* /gʁɑ̃/ | *grande* /gʁɑ̃d/" makes the first button say
      // "grande", which is the opposite of the point being made.
      var own = nearestEm(td, el);
      if (own) return own;

      var row = td.closest('tr');
      var cells = row ? [].slice.call(row.cells) : [];
      // Examples live in the last column, so search the row right to left:
      // a stray italic in a Notes column should not win over them.
      for (var i = cells.length - 1; i >= 0; i--) {
        var em = cells[i].querySelector('em, .he');
        if (em && Heb.hasHebrew(em.textContent)) return clean(source(em));
      }
      // Nothing marked up anywhere in the row: some tables (the numbers, for
      // one) simply put the Hebrew word in the first column.
      if (cells.length && cells[0] !== td) {
        var first = clean(source(cells[0]));
        if (first && Heb.hasHebrew(first) && first.length <= 30 &&
            first.split(/\s+/).length <= 3) return first;
      }
    }

    var answer = el.closest('.exercise-a');
    if (answer) {
      var item = answer.closest('.exercise-item');
      var q = item && item.querySelector('.exercise-q');
      if (q) {
        var qEm = q.querySelector('em, .he');
        return clean(qEm ? source(qEm) : q.textContent.split(/[-?]/)[0]);
      }
    }

    var box = el.closest('li, p, .example, .callout, .exercise-item, td') || el.parentNode;
    return nearestEm(box, el);
  }

  function markTr(el) {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    var src = trSource(el);
    if (!src || !Heb.hasHebrew(src)) return;
    // One button per word per row. A note like "the s now sounds, as /z/"
    // holds a single phoneme, so it resolves to the word already wired beside
    // it, and two identical buttons in one row read as two different sounds.
    var row = el.closest('tr');
    if (row && [].some.call(row.querySelectorAll('.say-btn'), function (b) {
      return b.dataset.say === src;
    })) return;
    var btn = document.createElement('button');
    btn.className = 'say-btn';
    btn.type = 'button';
    btn.dataset.say = src;
    btn.setAttribute('aria-label', 'Hear “' + src + '”');
    btn.setAttribute('title', 'Hear “' + src + '”');
    btn.innerHTML = SPEAKER;
    el.insertAdjacentElement('afterend', btn);
  }

  // The Hebrew side of an examples block is the same kind of thing as an
  // italic in prose, but it is not italicised, so nothing above catches it.
  // These are the lines a learner most wants to hear, so they get a button.
  function markPhrase(el) {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    // Something inside it was already wired by markExample; a second
    // control for the same words would be noise.
    if (el.querySelector('.say')) return;
    var text = clean(source(el));
    if (!text || text.length > 80) return;
    if (!Heb.hasHebrew(text)) return;
    var btn = document.createElement('button');
    btn.className = 'say-btn';
    btn.type = 'button';
    btn.dataset.say = text;
    btn.setAttribute('aria-label', 'Hear “' + text + '”');
    btn.setAttribute('title', 'Hear “' + text + '”');
    btn.innerHTML = SPEAKER;
    el.appendChild(btn);
  }

  // Give a vocabulary row its own play button next to the Hebrew column.
  // The transliteration under it is Latin and must not be read out, so the
  // text comes from the Hebrew span alone.
  function markVocab(el) {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    var he = el.querySelector('.v-word');
    var text = clean(he ? source(he) : source(el));
    if (!text || !Heb.hasHebrew(text)) return;
    var btn = document.createElement('button');
    btn.className = 'say-btn';
    btn.type = 'button';
    btn.dataset.say = text;
    btn.setAttribute('aria-label', 'Hear “' + text + '”');
    btn.setAttribute('title', 'Hear “' + text + '”');
    btn.innerHTML = SPEAKER;
    // Inside the cell, not after it: the row is a fixed grid.
    el.appendChild(btn);
  }

  // Called after anything is rendered into the page.
  function hydrate(root) {
    if (!root || !supported()) return;
    // Italics first, so a .he span sitting inside one is skipped as already
    // covered rather than given a control of its own.
    root.querySelectorAll('em').forEach(markExample);
    root.querySelectorAll('.he').forEach(markExample);
    root.querySelectorAll('.tr').forEach(markTr);
    root.querySelectorAll('.ex-he').forEach(markPhrase);
    root.querySelectorAll('.v-he').forEach(markVocab);
  }

  /* ---------------------------------------------------------- controls */

  var btn = null, menu = null;

  function setup() {
    btn = document.getElementById('audioBtn');
    menu = document.getElementById('audioMenu');
    if (!btn || !menu) return;

    document.body.classList.toggle('audio-off', !prefs.on);

    if (!supported()) {
      btn.hidden = true;
      return;
    }

    refreshVoices();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', refreshVoices);
    else synth.onvoiceschanged = refreshVoices;
    // Safari sometimes reports an empty list on the first tick.
    setTimeout(refreshVoices, 400);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) paintMenu();
    });

    menu.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeMenu(); stop(); }
    });

    menu.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'audioOn') {
        prefs.on = t.checked;
        document.body.classList.toggle('audio-off', !prefs.on);
        if (!prefs.on) stop();
      } else if (t.id === 'audioSlow') {
        prefs.slow = t.checked;
      } else if (t.id === 'audioVoice') {
        prefs.voice = t.value;
        current = pickVoice();
      }
      save();
      paintMenu();
    });

    // The one place the engine is allowed to report a failure. If a browser
    // lists a voice it cannot actually drive, this is where that shows up,
    // rather than as words in a lesson that silently do nothing.
    menu.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="test"]')) return;
      var out = document.getElementById('audioResult');
      lastError = '';
      fellBack = false;
      if (out) out.textContent = 'Speaking\u2026';
      var started = speak(
        '\u05e9\u05c1\u05b8\u05dc\u05d5\u05b9\u05dd, \u05d0\u05b2\u05e0\u05b4\u05d9 ' +
        '\u05dc\u05d5\u05b9\u05de\u05b5\u05d3 \u05e2\u05b4\u05d1\u05b0\u05e8\u05b4\u05d9\u05ea.',
        { onEnd: function (finished) {
            if (!out) return;
            if (lastError) out.textContent = 'The browser refused: ' + lastError + '.';
            else if (fellBack) out.textContent = 'This browser lists ' +
              (current ? current.name : 'that voice') + ' but cannot drive it, ' +
              'so the system voice was used instead. Safari drives the Apple ' +
              'voices properly if this still sounds wrong.';
            else if (finished) out.textContent = 'That is ' +
              (current ? current.name : 'the system voice') + '.';
            else out.textContent = '';
          } });
      if (!started && out) {
        out.textContent = prefs.on ? 'Nothing to say.' : 'Reading aloud is switched off.';
      }
    });
  }

  function closeMenu() {
    if (menu && !menu.hidden) {
      menu.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  function paintMenu() {
    if (!menu || menu.hidden) return;
    var opts = voices.map(function (v) {
      var sel = current && v.voiceURI === current.voiceURI ? ' selected' : '';
      return '<option value="' + escapeAttr(v.voiceURI) + '"' + sel + '>' +
        escapeHtml(v.name) + ' (' + escapeHtml(v.lang) + ')</option>';
    }).join('');

    menu.innerHTML =
      '<div class="audio-menu-title">Audio</div>' +
      '<label class="audio-row"><input type="checkbox" id="audioOn"' + (prefs.on ? ' checked' : '') + '>' +
        '<span>Read examples aloud</span></label>' +
      '<label class="audio-row"><input type="checkbox" id="audioSlow"' + (prefs.slow ? ' checked' : '') + '>' +
        '<span>Speak slowly</span></label>' +
      (voices.length
        ? '<label class="audio-row audio-voice"><span>Voice</span>' +
            '<select id="audioVoice">' + opts + '</select></label>' +
          '<button class="btn" type="button" data-act="test">Test the voice</button>' +
          '<p class="audio-result" id="audioResult"></p>'
        : '<p class="audio-note">No Hebrew voice is installed in this browser. ' +
          'On macOS add Carmit under System Settings > Accessibility > Spoken Content > ' +
          'System Voice > Manage Voices. On iOS and Android it is built in.</p>') +
      (voices.length === 1
        ? '<p class="audio-note">Carmit is the only Hebrew voice Apple ships, so ' +
          'there is nothing else to pick here. If it stays silent, try the same ' +
          'page in Safari: Chrome lists the Apple voices but cannot always ' +
          'drive them.</p>'
        : '') +
      '<p class="audio-note">Click any Hebrew example to hear it. Shift-click reads it slowly.</p>';
  }

  /* ---------------------------------------------------------- events */

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-say]');
    if (!t || !prefs.on) return;
    e.preventDefault();
    speak(t.dataset.say, { slow: e.shiftKey, el: t });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = document.activeElement;
    if (!t || !t.matches || !t.matches('em.say')) return;
    e.preventDefault();
    speak(t.dataset.say, { slow: e.shiftKey, el: t });
  });

  // A page navigation should not leave a voice talking over the next lesson.
  window.addEventListener('hashchange', stop);
  window.addEventListener('beforeunload', function () { if (synth) synth.cancel(); });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  return {
    setup: setup, hydrate: hydrate, speak: speak, stop: stop,
    supported: supported, available: available, enabled: enabled, on: on
  };
})();
