/* ============================================================
   read.js - reading practice.

   A passage is one JSON file (see content/reading/SCHEMA.md). The
   reader does four things with it: play any line, gloss any word,
   ask comprehension questions, and listen to you read a line back.

   Questions reuse the test engine rather than growing a second one,
   so a passage marks its own mastery the same way a chapter test does.
   ============================================================ */

window.Read = (function () {
  'use strict';

  var index = null;
  var cache = {};

  function loadIndex() {
    if (index) return Promise.resolve(index);
    return Data.json('content/reading/index.json')
      .then(function (json) {
        // A passage listed but not yet written must not break the list.
        index = json.passages.filter(function (p) { return p && p.id && p.file; });
        return index;
      });
  }

  function loadPassage(entry) {
    if (cache[entry.id]) return Promise.resolve(cache[entry.id]);
    return Data.json('content/reading/' + entry.file)
      .then(function (p) { cache[entry.id] = p; return p; });
  }

  function byId(id) {
    return (index || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  /* ---------------------------------------------------------- glossing */

  // Longest first, so "avoir hâte" wins over "avoir".
  function glossIndex(passage) {
    var pairs = [];
    for (var k in passage.gloss) {
      if (Object.prototype.hasOwnProperty.call(passage.gloss, k)) {
        pairs.push([k.toLowerCase(), passage.gloss[k]]);
      }
    }
    return pairs.sort(function (a, b) { return b[0].length - a[0].length; });
  }

  function strip(s) { return Heb.plain(s); }

  // The one-letter prefixes a Hebrew word can wear, in the order worth
  // peeling them: the definite ה, then the conjunction and the prepositions.
  // Only one comes off at a time, and never if what is left is too short to
  // be a word, which is what stops בו turning into ו.
  var PREFIXES = ['ה', 'ו', 'ב', 'ל', 'מ', 'כ', 'ש'];

  // What a word means: the passage's own gloss first, then the course
  // vocabulary, trying the word bare and then with each prefix taken off.
  function lookup(word, pairs) {
    var w = strip(String(word).replace(/^["'(\[]+|[.,;:!?\u2026"'\)\]]+$/g, ''));
    if (!w) return null;

    for (var i = 0; i < pairs.length; i++) {
      var k = strip(pairs[i][0]);
      if (k === w || k.indexOf(w) === 0) return pairs[i][1];
    }

    // The bare word first: an exact hit beats one that needed a prefix off.
    var tries = [w];
    PREFIXES.forEach(function (p) {
      if (w.charAt(0) === p && w.length >= 4) tries.push(w.slice(1));
    });
    // הבית wears one prefix; ושהוא can wear two.
    if (tries.length > 1 && tries[1].length >= 4) {
      PREFIXES.forEach(function (p) {
        if (tries[1].charAt(0) === p) tries.push(tries[1].slice(1));
      });
    }

    // Endings that turn a dictionary word into the form on the page. Tried
    // after the bare word, so an exact hit always wins.
    var ENDINGS = ['\u05d9\u05d9\u05dd', '\u05d5\u05ea', '\u05d9\u05dd', '\u05d4', '\u05ea'];

    var words = Vocab.all();

    function exact(form) {
      for (var j = 0; j < words.length; j++) {
        if (strip(words[j].he) === form) return words[j].en;
        if (words[j].pl && strip(words[j].pl) === form) return words[j].en;
      }
      return null;
    }

    for (var t = 0; t < tries.length; t++) {
      var found = exact(tries[t]);
      if (found) return found;
    }

    // Match on the root before touching the endings, because a root is hard
    // evidence and an ending is a guess. Every verb in the word list carries
    // its three or four root letters, and a conjugated verb is those letters
    // in order with a pattern wrapped round them. Doing this first is what
    // stops מְדַבֶּרֶת being read as מִדְבָּר, a desert, by way of chopping
    // off what looks like a feminine ת.
    var bareWord = tries[0];

    function rootMatch(word) {
      var root = word.root;
      if (!root) return -1;
      var letters = strip(root).replace(/[^\u05D0-\u05EA]/g, '');
      if (letters.length < 3) return -1;
      // A weak root loses its last letter in most of its forms: ר-צ-ה gives
      // רָצִיתִי with no ה in it at all. So a final ה or י is optional.
      var forms = [letters];
      if (/[\u05d4\u05d9]$/.test(letters)) forms.push(letters.slice(0, -1));
      for (var f = 0; f < forms.length; f++) {
        var want = forms[f];
        var extra = bareWord.length - want.length;
        if (extra < 0 || extra > 3) continue;
        var at = 0, ok = true, first = -1, last = -1;
        for (var c = 0; c < want.length; c++) {
          at = bareWord.indexOf(want.charAt(c), at);
          if (at === -1) { ok = false; break; }
          // A pattern puts at most one letter in front of the root.
          if (c === 0 && at > 1) { ok = false; break; }
          if (first === -1) first = at;
          last = at;
          at++;
        }
        // The root letters have to sit close together. A pattern inserts at
        // most one letter between them, so a root spread any wider than that
        // is a coincidence: תְּמוּנוֹת holds מ, ו and ת in order and has
        // nothing to do with לָמוּת.
        if (ok && last - first + 1 > want.length + 1) ok = false;
        if (ok) return extra;
      }
      return -1;
    }

    var best = null, bestExtra = 99;
    for (var k = 0; k < words.length; k++) {
      var extra = rootMatch(words[k]);
      // The closer the word is to the bare root, the likelier the match.
      if (extra >= 0 && extra < bestExtra) { best = words[k]; bestExtra = extra; }
    }
    if (best) return best.en;

    // Last resort: take a plural or feminine ending off and look again, so
    // תְּמוּנוֹת finds תְּמוּנָה and יְלָדִים finds יֶלֶד.
    for (var t2 = 0; t2 < tries.length; t2++) {
      for (var e = 0; e < ENDINGS.length; e++) {
        var end = ENDINGS[e];
        var stem = tries[t2];
        if (stem.length > end.length + 1 && stem.slice(-end.length) === end) {
          var cut = stem.slice(0, -end.length);
          var found2 = exact(cut) || exact(cut + '\u05d4');
          if (found2) return found2;
        }
      }
    }

    return null;
  }

  /* ---------------------------------------------------------- rendering */

  function textHtml(passage) {
    return passage.text.split(/\n\s*\n/).map(function (para) {
      var lines = para.split('\n').filter(function (l) { return l.trim(); });
      return '<p class="rd-para">' + lines.map(function (line, i) {
        // data-line, not data-say: audio.js claims every [data-say] on the
        // document and speaks it alone, which would cancel a run of lines
        // one line in. The reader drives its own playback.
        // data-line keeps the full nikud, whatever the page is showing:
        // the points are what tell the voice which vowel to read.
        return '<span class="rd-line" data-line="' + escapeAttr(line.trim()) + '" tabindex="0" ' +
          'role="button">' + line.trim().split(/(\s+)/).map(function (tok) {
            return /\S/.test(tok)
              ? '<span class="rd-w" data-w="' + escapeAttr(tok) + '">' +
                escapeHtml(Heb.show(tok)) + '</span>'
              : escapeHtml(tok);
          }).join('') + '</span>' + (i < lines.length - 1 ? ' ' : '');
      }).join('') + '</p>';
    }).join('');
  }

  function render(host, entry, opts) {
    opts = opts || {};
    return loadPassage(entry).then(function (passage) {
      var m = Progress.mastery('read:' + passage.id);
      var pairs = glossIndex(passage);

      host.innerHTML =
        '<div class="eyebrow">' +
          '<a href="#/read" style="color:inherit;text-decoration:none">← All passages</a>' +
          '<span class="dot"></span>' +
          '<span class="pill pill-' + passage.level.toLowerCase() + '">' + escapeHtml(passage.level) + '</span>' +
        '</div>' +
        '<h1>' + escapeHtml(passage.title) + '</h1>' +
        '<p class="lead">' + escapeHtml(passage.blurb || '') + '</p>' +
        (passage.grammar && passage.grammar.length
          ? '<p class="rd-grammar">Uses: ' + passage.grammar.map(function (g) {
              return '<a class="' + (Progress.studied(g) ? '' : 'is-unread') +
                '" href="#/' + g + '">' + escapeHtml(titleOf(g)) + '</a>';
            }).join(' · ') + '</p>' + needHtml(passage, true)
          : '') +
        '<div class="rd-toolbar">' +
          (window.Say && Say.supported()
            ? '<button class="btn" data-act="playall" id="rdPlay">🔊 Read it to me</button>' +
              '<button class="btn" data-act="top" id="rdTop" hidden>⤒ From the top</button>' +
              '<button class="btn" data-act="stop">Stop</button>' : '') +
          '<span class="rd-hint">Tap a line to read on from there. Tap a word for the meaning.</span>' +
        '</div>' +
        '<div class="rd-text" id="rdText" lang="he" dir="rtl">' + textHtml(passage) + '</div>' +
        '<div class="rd-gloss" id="rdGloss" hidden></div>' +
        (passage.aloud && passage.aloud.length ? aloudHtml(passage) : '') +
        '<h2>Did you follow it?</h2>' +
        '<div id="rdQuiz"></div>' +
        '<p class="rd-next" id="rdNext" hidden><a class="btn" href="#/test/translate-' + escapeAttr(passage.id) + '">' +
          'Now write it: English sentences to put into Hebrew, with this story\'s words \u2192</a></p>' +
        (m.level ? '<p class="rd-mark">You marked this <strong>' +
          ['', 'shaky', 'confident'][m.level] + '</strong>.</p>' : '');

      bindText(host, passage, pairs);
      if (passage.aloud && passage.aloud.length) bindAloud(host, passage);
      // Only a story that has a translation drill offers one.
      Test.loadTranslate(passage.id).then(function (bank) {
        var next = host.querySelector('#rdNext');
        if (bank && next) next.hidden = false;
      });

      Test.start(host.querySelector('#rdQuiz'), {
        id: 'read:' + passage.id,
        title: passage.title,
        masteryKey: 'read:' + passage.id,
        questions: passage.questions || [],
        onDone: function (r) {
          if (r.retry && opts.onRetry) opts.onRetry();
        }
      });

      return passage;
    });
  }

  function bindText(host, passage, pairs) {
    var text = host.querySelector('#rdText');
    var gloss = host.querySelector('#rdGloss');

    // Where the reading is up to. A passage is long enough that you stop in
    // the middle of it, and starting again from the first line is not where
    // you were. This is the resume point: the line you last touched, or the
    // line the voice had reached when you pressed Stop.
    var at = 0;

    // The word the gloss is showing, as the quick add should receive it.
    var pending = null;

    // The few words in front of a tapped one, which are what say whether it
    // is a verb or a plural. The same line only: a line is a sentence or less.
    function before(word) {
      var ws = [].slice.call(word.closest('.rd-line').querySelectorAll('.rd-w'));
      var i = ws.indexOf(word);
      return ws.slice(Math.max(0, i - 3), i).map(function (el) {
        return el.dataset.w || el.textContent;
      }).join(' ');
    }

    function lines() {
      return [].slice.call(text.querySelectorAll('.rd-line'));
    }

    function clearMarks(ls) {
      (ls || lines()).forEach(function (l) { l.classList.remove('is-playing'); });
    }

    // Reflects the resume point in the toolbar: the main button says where it
    // would start, and the way back to the beginning only exists once you
    // have left it.
    function paintControls() {
      var play = host.querySelector('#rdPlay');
      var top = host.querySelector('#rdTop');
      if (play) play.innerHTML = at > 0 ? '🔊 Read on from here' : '🔊 Read it to me';
      if (top) top.hidden = at <= 0;
    }

    // Play from line i to the end, each one starting when the last has
    // finished. `at` tracks the line being spoken, so a Stop halfway leaves
    // the resume point on the line you actually heard.
    function playFrom(i) {
      var ls = lines();
      if (!ls.length || !(window.Say && Say.supported())) return;
      if (i < 0) i = 0;
      if (i >= ls.length) i = 0;

      (function next(k) {
        clearMarks(ls);
        if (k >= ls.length) { at = 0; paintControls(); return; }
        at = k;
        paintControls();
        ls[k].classList.add('is-playing');
        ls[k].scrollIntoView({ block: 'nearest' });
        Say.speak(ls[k].dataset.line, {
          onEnd: function (finished) {
            ls[k].classList.remove('is-playing');
            if (finished) next(k + 1);
          }
        });
      })(i);
    }

    text.addEventListener('click', function (e) {
      var word = e.target.closest('.rd-w');
      if (word) {
        // The word as written, points and all: that is what the list and
        // the voice both want, whatever the page is currently showing.
        var full = word.dataset.w || word.textContent;
        var meaning = lookup(full, pairs);
        var base = null, via = '';
        if (!meaning) {
          // Not as it stands: try it as the list would have it, a plural made
          // singular or a verb taken back to its infinitive.
          base = Vocab.baseForm(full, { before: before(word) });
          var hit = base.he !== full && Vocab.findExisting(base.he);
          if (hit) { meaning = hit.en; via = hit.he; }
        }
        pending = base;
        gloss.hidden = false;
        gloss.innerHTML = '<strong lang="he" dir="rtl">' + escapeHtml(Heb.show(full)) + '</strong>' +
          (via ? '<span class="rd-via" lang="he" dir="rtl">\u2190 ' + escapeHtml(Heb.show(via)) + '</span>' : '') +
          (meaning ? '<span>' + escapeHtml(meaning) + '</span>'
                   : '<span class="rd-nogloss">not in the word list</span>' +
                     '<button class="btn btn-sm" data-act="addword" data-word="' +
                       escapeAttr(full) + '">+ Add to my words</button>') +
          (window.Say && Say.supported()
            ? '<button class="btn btn-sm" data-say="' + escapeAttr(full) + '">\ud83d\udd0a</button>' : '');
        text.querySelectorAll('.rd-w.is-looked').forEach(function (el) { el.classList.remove('is-looked'); });
        word.classList.add('is-looked');
        return;
      }
      var line = e.target.closest('.rd-line');
      if (line) playFrom(lines().indexOf(line));
    });

    text.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var line = e.target.closest('.rd-line');
      if (!line) return;
      e.preventDefault();
      playFrom(lines().indexOf(line));
    });

    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      // Stop keeps the resume point: that is the whole reason it exists.
      if (act === 'stop') { Say.stop(); clearMarks(); return void paintControls(); }
      if (act === 'top') { at = 0; return playFrom(0); }
      if (act === 'playall') return playFrom(at);
      // Opens the quick add with the word already in it, less what the
      // sentence put in front of it.
      if (act === 'addword') {
        document.dispatchEvent(new CustomEvent('quickadd:open', {
          detail: pending || Vocab.baseForm(b.dataset.word)
        }));
      }
    });
  }

  /* ---------------------------------------------------------- read aloud */

  function aloudHtml(passage) {
    return '<h2>Read it back</h2>' +
      '<p class="rd-aloud-note">' + (window.Speech && Speech.supported()
        ? 'Say the line out loud. The browser transcribes you and marks the words it did not hear ' +
          'as you meant them. It is checking that you are understandable, not that you sound Israeli.'
        : 'This browser cannot listen. Play the line, say it back, and judge it yourself.') + '</p>' +
      '<div class="rd-aloud">' + passage.aloud.map(function (line, i) {
        return '<div class="rd-aloud-item" data-i="' + i + '">' +
          '<p class="rd-aloud-line" lang="he" dir="rtl">' + escapeHtml(Heb.show(line)) + '</p>' +
          '<div class="rd-aloud-actions">' +
            (window.Say && Say.supported()
              ? '<button class="btn" data-act="model" data-say="' + escapeAttr(line) + '">🔊 Hear it</button>' : '') +
            (window.Speech && Speech.supported()
              ? '<button class="btn btn-primary" data-act="rec">🎤 Say it</button>' : '') +
          '</div>' +
          '<div class="rd-aloud-result"></div>' +
          '</div>';
      }).join('') + '</div>';
  }

  function bindAloud(host, passage) {
    var wrap = host.querySelector('.rd-aloud');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act="rec"]');
      if (!b) return;
      var item = b.closest('.rd-aloud-item');
      var line = passage.aloud[Number(item.dataset.i)];
      var out = item.querySelector('.rd-aloud-result');

      b.disabled = true;
      b.textContent = '🎤 Listening…';
      Say.stop();

      Speech.check(line, {
        onPartial: function (t) { b.textContent = '🎤 ' + t; }
      }).then(function (r) {
        b.disabled = false;
        b.textContent = '🎤 Again';
        // A transcript that is not a possible attempt at the line says
        // nothing about how you read it, so it is not scored.
        if (r.unclear) {
          out.innerHTML = '<p class="test-note is-bad">The recogniser did not make that out - ' +
            'it heard <em>' + escapeHtml(r.heard || 'nothing') + '</em>. It guesses a real word ' +
            'when a phrase is short or rushed. Try again a little slower.</p>';
          return;
        }
        out.innerHTML =
          '<p class="test-heard" lang="he" dir="rtl">' + r.words.map(function (w) {
            return '<span class="hw hw-' + w.state + '">' + escapeHtml(w.word) + '</span>';
          }).join(' ') + '<span class="test-heard-pct">' + r.pct + '%</span></p>' +
          '<p class="test-note">' + (r.pass
            ? 'Understandable.'
            : 'The underlined words did not come through. Hear the model, then try those again.') +
          ' Heard: ' + escapeHtml(r.heard || '-') + '</p>';
      }).catch(function (err) {
        b.disabled = false;
        b.textContent = '🎤 Try again';
        out.innerHTML = '<p class="test-note is-bad">' + escapeHtml(err.message) + '</p>';
      });
    });
  }

  /* ---------------------------------------------------------- readiness */

  // A passage leans on a handful of chapters, named in its `grammar`
  // array. Saying which of them you have not covered yet turns "this one
  // is too hard" into a short list of links. Nothing is ever blocked:
  // reading above your level is how you find out what to study next.
  function unread(entry) {
    return (entry.grammar || []).filter(function (slug) {
      return !Progress.studied(slug);
    });
  }

  // Chapter titles live in the manifest, which app.js owns. It hands a
  // lookup over once that has loaded; until then the slug will do.
  var titleOf = function (slug) { return slug.replace(/-/g, ' '); };

  function useTitles(fn) { if (typeof fn === 'function') titleOf = fn; }

  function chapterLink(slug) {
    return '<a href="#/' + slug + '">' + escapeHtml(titleOf(slug)) + '</a>';
  }

  // One line under the card. On the list three links are enough, or the
  // warning outgrows the blurb it sits beneath; inside the passage there
  // is room to name them all.
  function needHtml(entry, all) {
    var missing = unread(entry);
    if (!missing.length) return '<p class="rd-need rd-ready">Ready.</p>';
    var shown = all ? missing : missing.slice(0, 3);
    var rest = missing.length - shown.length;
    return '<p class="rd-need">Study first: ' + shown.map(chapterLink).join(' · ') +
      (rest > 0 ? ' <span class="rd-need-more">+' + rest + ' more</span>' : '') + '</p>';
  }

  /* ---------------------------------------------------------- list */

  function listHtml(passages) {
    var byLevel = {};
    passages.forEach(function (p) { (byLevel[p.level] = byLevel[p.level] || []).push(p); });
    return ['A1', 'A2', 'B1', 'B2'].filter(function (l) { return byLevel[l]; }).map(function (level) {
      return '<h2>' + level + '</h2><div class="rd-grid">' + byLevel[level].map(function (p) {
        var m = Progress.mastery('read:' + p.id);
        var s = Progress.testScore('read:' + p.id);
        // A div, not an anchor: the readiness line carries links of its
        // own, and an anchor inside an anchor is not valid HTML.
        return '<div class="rd-card lv' + m.level + (unread(p).length ? ' is-early' : '') + '">' +
          '<a class="rd-card-main" href="#/read/' + p.id + '">' +
            '<span class="rd-card-title">' + escapeHtml(p.title) + '</span>' +
            '<span class="rd-card-blurb">' + escapeHtml(p.blurb || '') + '</span>' +
            '<span class="rd-card-meta">' + (s.runs ? 'best ' + s.best + '%' : 'not read yet') + '</span>' +
          '</a>' + needHtml(p) +
          '</div>';
      }).join('') + '</div>';
    }).join('');
  }

  /* ---------------------------------------------------------- library */

  // Real stories, read on the sites that host them. The page keeps only
  // what the course can add: an order to read them in, where you are with
  // each, and the words you noted on the way.
  var library = null;

  function loadLibrary() {
    if (library) return Promise.resolve(library);
    return Data.json('content/library.json').then(function (j) { library = j; return j; });
  }

  function libItems(lib) {
    return lib.groups.reduce(function (all, g) { return all.concat(g.items); }, []);
  }

  // What to open next: the story you are in the middle of, else the
  // first one in reading order you have not finished.
  function upNext(lib) {
    var items = libItems(lib);
    return items.filter(function (it) { return Progress.lib(it.id).s === 'reading'; })[0] ||
      items.filter(function (it) { return Progress.lib(it.id).s !== 'done'; })[0] || null;
  }

  function tabsHtml(current) {
    return '<nav class="rd-tabs" aria-label="Reading">' +
      '<a href="#/read"' + (current === 'passages' ? ' class="is-current" aria-current="page"' : '') + '>Passages</a>' +
      '<a href="#/read/library"' + (current === 'library' ? ' class="is-current" aria-current="page"' : '') + '>Library</a>' +
      '</nav>';
  }

  function heHtml(s) {
    return '<span lang="he" dir="rtl">' + escapeHtml(Heb.show(s)) + '</span>';
  }

  function titleHtml(it) {
    return '<span class="lb-title">' + heHtml(it.title) + '</span>' +
      (it.en ? '<span class="lb-en">' + escapeHtml(it.en) + '</span>' : '');
  }

  function metaLine(it) {
    var bits = [escapeHtml(it.author)];
    if (it.words) {
      bits.push('~' + (it.words >= 1000 ? (Math.round(it.words / 100) / 10) + 'k' : it.words) + ' words');
      // A learner reads Hebrew slower than English, and every word carries
      // more: 70 a minute is a fair pace with the points on. Past a long
      // story, minutes stop meaning anything; say what it is.
      bits.push(it.words > 10000 ? 'a book' : '~' + Math.max(5, Math.round(it.words / 70 / 5) * 5) + ' min');
    }
    return bits.join(' · ');
  }

  function linksHtml(it) {
    // A hash link is a passage in this app: same tab, no arrow.
    return it.links.map(function (l) {
      var inApp = l.url.charAt(0) === '#';
      return '<a class="btn' + (inApp ? ' btn-primary' : '') + '" href="' + escapeAttr(l.url) + '"' +
        (inApp ? '' : ' target="_blank" rel="noopener"') + '>' +
        escapeHtml(l.label) + (inApp ? '' : ' \u2197') + '</a>';
    }).join('');
  }

  var STATUS = [['', 'To read'], ['reading', 'Reading'], ['done', 'Done']];

  function storyHtml(it, n) {
    var e = Progress.lib(it.id);
    return '<li class="lb-item is-' + (e.s || 'todo') + '" data-id="' + escapeAttr(it.id) + '">' +
      '<div class="lb-head">' +
        '<span class="lb-num">' + n + '</span>' +
        '<div class="lb-titles">' + titleHtml(it) +
          '<span class="lb-meta">' + metaLine(it) + '</span>' +
        '</div>' +
      '</div>' +
      '<p class="lb-blurb">' + escapeHtml(it.blurb) +
        (it.note ? ' <span class="lb-note">' + escapeHtml(it.note) + '</span>' : '') + '</p>' +
      '<div class="lb-actions">' +
        '<div class="lb-links">' + linksHtml(it) + '</div>' +
        '<div class="lb-status" role="group" aria-label="Status">' + STATUS.map(function (st) {
          return '<button type="button" data-s="' + st[0] + '" aria-pressed="' + (e.s === st[0]) + '">' + st[1] + '</button>';
        }).join('') + '</div>' +
      '</div>' +
      '<details class="lb-notes">' +
        '<summary>Words I noted' + (e.n.trim() ? ' <span class="lb-count">' + countLines(e.n) + '</span>' : '') + '</summary>' +
        '<textarea rows="4" spellcheck="false" dir="auto" placeholder="One per line: \u05DC\u05B0\u05E4\u05B6\u05EA\u05B7\u05E2 - suddenly">' + escapeHtml(e.n) + '</textarea>' +
        '<span class="lb-saved" aria-live="polite"></span>' +
      '</details>' +
      '</li>';
  }

  function countLines(t) { return t.split('\n').filter(function (l) { return l.trim(); }).length; }

  function libraryHtml(lib) {
    var items = libItems(lib);
    var done = items.filter(function (it) { return Progress.lib(it.id).s === 'done'; }).length;
    var reading = items.filter(function (it) { return Progress.lib(it.id).s === 'reading'; }).length;
    var next = upNext(lib);
    var n = 0;
    return tabsHtml('library') +
      '<h1>Library</h1>' +
      '<p class="lead">' + escapeHtml(lib.intro) + '</p>' +
      '<p class="lb-progress">' + done + ' of ' + items.length + ' finished' + (reading ? ' · ' + reading + ' in progress' : '') + '</p>' +
      (next ? '<div class="lb-next"><span class="eyebrow">' + (Progress.lib(next.id).s === 'reading' ? 'Carry on with' : 'Up next') + '</span>' +
        titleHtml(next) +
        '<span class="lb-meta">' + metaLine(next) + '</span>' +
        '<div class="lb-links">' + linksHtml(next) + '</div></div>' : '') +
      '<details class="lb-help"><summary>How to read these</summary><ul>' +
        lib.tips.map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; }).join('') + '</ul></details>' +
      '<details class="lb-help"><summary>' + escapeHtml(lib.older.title) + '</summary>' +
        '<p class="lb-help-note">' + escapeHtml(lib.older.note) + '</p>' +
        '<table class="lb-ps"><tbody>' +
        lib.older.rows.map(function (r) {
          return '<tr><td><b>' + heHtml(r[0]) + '</b></td><td>' + heHtml(r[1]) + '</td><td>' + escapeHtml(r[2]) + '</td></tr>';
        }).join('') + '</tbody></table></details>' +
      '<div class="lb-tools">' +
        '<button type="button" class="btn" data-act="copy">Copy my words</button>' +
        '<label><input type="checkbox" data-act="hide"' + (hideDone() ? ' checked' : '') + '> Hide finished</label>' +
      '</div>' +
      '<div class="lb-groups' + (hideDone() ? ' hide-done' : '') + '">' +
      lib.groups.map(function (g) {
        return '<section class="lb-group"><h2>' + escapeHtml(g.title) + '</h2>' +
          '<p class="lb-group-note">' + escapeHtml(g.note) + '</p>' +
          '<ol class="lb-list">' + g.items.map(function (it) { return storyHtml(it, ++n); }).join('') + '</ol></section>';
      }).join('') + '</div>' +
      '<h2>More</h2><ul class="lb-more">' + lib.more.map(function (l) {
        return '<li><a href="' + escapeAttr(l.url) + '" target="_blank" rel="noopener">' + escapeHtml(l.label) + ' \u2197</a></li>';
      }).join('') + '</ul>';
  }

  // A view preference, so it stays on this device and out of the sync.
  function hideDone() { try { return localStorage.getItem('hamachberet.lib.hide') === '1'; } catch (e) { return false; } }
  function setHideDone(on) { try { localStorage.setItem('hamachberet.lib.hide', on ? '1' : '0'); } catch (e) {} }

  function wordsReport(lib) {
    var out = [];
    libItems(lib).forEach(function (it) {
      var e = Progress.lib(it.id);
      if (e.n.trim()) out.push('## ' + it.title + (it.en ? ', ' + it.en : '') + ' (' + it.author + ')\n\n' +
        e.n.split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return '- ' + l.trim(); }).join('\n'));
    });
    return out.length ? '# Words from my reading\n\n' + out.join('\n\n') : '';
  }

  // The view element outlives this page, so the listeners go on a wrapper
  // that is thrown away with each render rather than piling up on it.
  function renderLibrary(host) {
    return loadLibrary().then(function (lib) {
      var page = document.createElement('div');
      page.className = 'lb-page';
      page.innerHTML = libraryHtml(lib);
      host.innerHTML = '';
      host.appendChild(page);
      bindLibrary(page, lib, function () { renderLibrary(host); });
    });
  }

  function bindLibrary(host, lib, rerender) {
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !host.contains(b)) return;
      if (b.dataset.act === 'copy') {
        var txt = wordsReport(lib);
        if (!txt) { b.textContent = 'No words noted yet'; return; }
        var ok = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy my words'; }, 1600); };
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, function () { b.textContent = 'Copy failed'; });
        return;
      }
      var li = b.closest('.lb-item');
      if (li && b.hasAttribute('data-s')) {
        Progress.setLib(li.dataset.id, { s: b.dataset.s });
        rerender();
      }
    });
    host.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.act === 'hide') {
        setHideDone(e.target.checked);
        host.querySelector('.lb-groups').classList.toggle('hide-done', e.target.checked);
      }
    });
    var timers = {};
    host.addEventListener('input', function (e) {
      if (e.target.tagName !== 'TEXTAREA') return;
      var li = e.target.closest('.lb-item');
      if (!li) return;
      var id = li.dataset.id, ta = e.target, flag = li.querySelector('.lb-saved');
      clearTimeout(timers[id]);
      timers[id] = setTimeout(function () {
        Progress.setLib(id, { n: ta.value });
        flag.textContent = 'Saved';
        setTimeout(function () { flag.textContent = ''; }, 1200);
      }, 400);
    });
  }

  /* ---------------------------------------------------------- helpers */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var escapeAttr = escapeHtml;

  return {
    loadIndex: loadIndex, loadPassage: loadPassage, byId: byId,
    render: render, listHtml: listHtml, lookup: lookup, glossIndex: glossIndex,
    unread: unread, useTitles: useTitles,
    tabsHtml: tabsHtml, renderLibrary: renderLibrary
  };
})();
