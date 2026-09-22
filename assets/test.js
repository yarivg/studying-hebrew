/* ============================================================
   test.js - the tests that sit behind each chapter and each part.

   A bank is one JSON file per chapter (see content/tests/SCHEMA.md).
   A chapter test runs its own bank; a part test samples across every
   chapter in that part.

   Grading is automatic for five of the six question types, but the
   score is only evidence. Whether a chapter counts as learned is your
   call, made with the buttons at the end and stored as `mastery`.
   ============================================================ */

window.Test = (function () {
  'use strict';

  var cache = {};

  /* ---------------------------------------------------------- loading */

  // content/part1/04-liaisons.md -> content/tests/part1/04-liaisons.json
  function pathFor(ch) { return 'content/tests/' + ch.file.replace(/\.md$/, '.json'); }

  function loadChapter(ch) {
    var path = pathFor(ch);
    if (cache[path]) return Promise.resolve(cache[path]);
    return Data.json(path)
      .catch(function () { return null; })
      .then(function (bank) {
        if (bank && Array.isArray(bank.questions)) {
          bank.questions.forEach(function (q) { q.ch = bank.ch; q.chTitle = bank.title; });
          cache[path] = bank;
          return bank;
        }
        return null;
      })
      .catch(function () { return null; });   // a chapter with no bank yet
  }

  function loadPart(part) {
    return Promise.all(part.chapters.map(loadChapter))
      .then(function (banks) { return banks.filter(Boolean); });
  }

  // A group is a named set of chapters that cross part and chapter lines,
  // because what you get wrong rarely respects either. Defined in
  // content/tests/groups.json; the banks themselves are untouched.
  var groupsCache = null;

  function loadGroups() {
    if (groupsCache) return Promise.resolve(groupsCache);
    return Data.json('content/tests/groups.json')
      .then(function (doc) {
        groupsCache = (doc && Array.isArray(doc.groups)) ? doc.groups : [];
        return groupsCache;
      })
      .catch(function () { groupsCache = []; return groupsCache; });
  }

  function findGroup(id) {
    return loadGroups().then(function (list) {
      for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
      return null;
    });
  }

  // Every chapter named by a group, from any part, resolved through the manifest.
  function loadGroupBanks(group, manifest) {
    var wanted = {};
    group.chapters.forEach(function (slug) { wanted[slug] = true; });
    var chapters = [];
    manifest.parts.forEach(function (part) {
      (part.chapters || []).forEach(function (ch) { if (wanted[ch.slug]) chapters.push(ch); });
    });
    return Promise.all(chapters.map(loadChapter))
      .then(function (banks) { return banks.filter(Boolean); });
  }

  function hasBank(ch) {
    // A HEAD request would bypass the offline cache, which only serves GET,
    // so ask for the bank itself -- it is cached, and loadChapter memoises it.
    return loadChapter(ch).then(function (bank) { return !!bank; });
  }

  /* ---------------------------------------------------------- picking */

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // A part exam takes a few from every chapter rather than a flat random
  // sample, so one long chapter cannot crowd the others out.
  function sample(banks, perChapter) {
    var out = [];
    banks.forEach(function (b) {
      out = out.concat(shuffle(b.questions).slice(0, perChapter));
    });
    return shuffle(out);
  }

  /* ---------------------------------------------------------- grading */

  // Nikud is never graded, on either side: the course writes it so the word
  // can be read aloud, not so it can be typed. Heb.plain also takes out the
  // maqaf, the geresh and the gershayim, none of which a learner will type.
  function norm(s) {
    return Heb.plain(String(s == null ? '' : s).toLowerCase())
      .replace(/^[\s.,;:!?"«»]+|[\s.,;:!?"«»]+$/g, '')
      .trim();
  }

  // What is left once the only thing that could still be wrong is the shape
  // of a final letter. Used for the 'slip' verdict, which counts as right:
  // the word is the right word, written with כ where ך belongs.
  function bare(s) {
    return Heb.unfinal(s);
  }

  // Three outcomes, not two. An answer that is right apart from a final
  // letter is the right word spelled the way a beginner spells it, so it
  // counts as right, but it comes back as 'slip' so the verdict can show the
  // proper spelling. The letter bar is there for anyone with no Hebrew
  // keyboard.
  // The words a prompt already prints, either side of its gap. Writing only the
  // missing piece and writing the whole sentence out are both right answers, so
  // the question carries `pre` and `post` and we try the answer glued to them.
  function candidates(q, given) {
    var out = [given];
    if (q.pre) out.push(q.pre + ' ' + given);
    if (q.post) out.push(given + ' ' + q.post);
    if (q.pre && q.post) out.push(q.pre + ' ' + given + ' ' + q.post);
    return out;
  }

  // For questions that ask for a set - 'name the three verbs' - the order they
  // come out in carries no meaning, so compare the words as a bag.
  function bag(s) { return s.split(' ').filter(Boolean).sort().join(' '); }

  function gradeText(q, given) {
    var answers = Array.isArray(q.a) ? q.a : [q.a];
    if (!norm(given)) return false;
    var mine = candidates(q, given).map(function (c) { return norm(c); });
    // Expand the keys the same way: the bank stores the gap filler, and the
    // whole sentence is that filler sitting between `pre` and `post`.
    var keys = [];
    answers.forEach(function (a) {
      candidates(q, a).forEach(function (c) { keys.push(norm(c)); });
    });
    var same = q.anyorder
      ? function (a, b) { return bag(a) === bag(b); }
      : function (a, b) { return a === b; };
    var hit = mine.some(function (m) {
      return keys.some(function (k) { return same(k, m); });
    });
    if (hit) return true;
    // Same again, with every final letter put back to its ordinary shape.
    var flatMine = mine.map(bare), flatKeys = keys.map(bare);
    return flatMine.some(function (m) {
      return flatKeys.some(function (k) { return same(k, m); });
    }) ? 'slip' : false;
  }

  // Chips are clicked, never typed, so they arrive spelled exactly as the
  // bank wrote them. `also` lists are hand-written though, and one written
  // without nikud should still match, so both sides go through norm().
  function gradeOrder(q, given) {
    var ok = [q.a].concat(q.also || []);
    var mine = given.map(norm);
    return ok.some(function (order) {
      return order.length === mine.length &&
        order.every(function (w, i) { return norm(w) === mine[i]; });
    });
  }

  function modelAnswer(q) {
    if (q.type === 'mcq') return q.choices[q.a];
    if (q.type === 'order') return q.a.join(' ');
    if (q.type === 'say') return q.target;
    return Array.isArray(q.a) ? q.a[0] : String(q.a == null ? '' : q.a);
  }

  /* ---------------------------------------------------------- running */

  var run = null;

  function start(container, opts) {
    run = {
      host: container,
      id: opts.id,
      title: opts.title,
      subtitle: opts.subtitle || '',
      questions: opts.questions,
      masteryKey: opts.masteryKey || opts.id,
      onDone: opts.onDone,
      // {href, label} for the summary, when there is somewhere to go after
      // this test. The router knows the chapter order; this does not.
      next: opts.next || null,
      i: 0,
      right: 0,
      answered: []
    };
    render();
  }

  function stop() {
    if (window.Speech) Speech.stop();
    run = null;
  }

  function render() {
    var s = run;
    if (!s) return;
    if (s.i >= s.questions.length) return renderSummary();

    var q = s.questions[s.i];
    var pct = Math.round((s.i / s.questions.length) * 100);

    s.host.innerHTML =
      '<div class="test-head">' +
        '<div class="test-bar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="test-meta">' +
          (s.i ? '<button class="test-back" type="button" data-act="back" ' +
            'title="Go back and answer it again (left arrow)">' +
            '<span class="test-back-arrow" aria-hidden="true">←</span>Back</button>' : '') +
          '<span>Question ' + (s.i + 1) + ' of ' + s.questions.length + '</span>' +
          '<span>' + s.right + ' right</span>' +
        '</div>' +
      '</div>' +
      '<div class="test-card">' +
        (q.chTitle && s.subtitle === 'part'
          ? '<span class="pill test-ch">' + escapeHtml(q.chTitle) + '</span>' : '') +
        '<p class="test-q" dir="auto">' + escapeHtml(Heb.show(q.q)) + '</p>' +
        '<div class="test-body" id="testBody"></div>' +
        '<div class="test-verdict" id="testVerdict" hidden></div>' +
      '</div>' +
      '<div class="test-actions" id="testActions"></div>';

    var back = s.host.querySelector('[data-act="back"]');
    if (back) back.addEventListener('click', goBack);

    var body = s.host.querySelector('#testBody');
    var actions = s.host.querySelector('#testActions');
    BODY[q.type](body, actions, q);

    // Anything you answer by typing gets the caret straight away, so a run of
    // written questions never needs a click between them. preventScroll keeps
    // the question itself in view: the field is below it, and letting the
    // browser scroll to the field pushed the prompt off a short screen.
    var typed = body.querySelector('#testIn');
    if (typed && !typed.disabled) typed.focus({ preventScroll: true });
  }

  // Step back and ask it again. Anything already recorded for the question we
  // land on is thrown away first, along with the answer to the one we are
  // leaving if it had been graded: otherwise a second pass at either would
  // count as an extra question and a better second guess would inflate the
  // score. answered runs in step with i, so everything from i onwards goes.
  function goBack() {
    var s = run;
    if (!s || !s.i) return;
    s.i--;
    while (s.answered.length > s.i) {
      var a = s.answered.pop();
      if (a.right) s.right--;
      Progress.setEx(a.ch || s.id, 'test', a.id, null);
    }
    if (window.Speech) Speech.stop();
    if (window.Say) Say.stop();
    render();
  }

  // Each type fills the body and decides what the action row does. All of
  // them finish by calling settle().
  var BODY = {};

  // Every point in a test where you are picking from a short list is worked
  // the same way: the button carries data-key, wears the digit that presses
  // it, and onKey below finds it without knowing what it does. The chips are
  // hidden on a touch screen by the stylesheet, where there is no keyboard.
  function key(n) { return '<kbd class="test-key">' + n + '</kbd>'; }

  // A question can turn on the difference between two forms that are spelled
  // alike and pointed differently: מַה שְׁלוֹמְךָ against מַה שְׁלוֹמֵךְ. With the
  // points switched off those are the same two buttons, and the question
  // becomes unanswerable. So the toggle yields here: if hiding the points
  // would make any two choices identical, every choice keeps them.
  function pointedChoices(choices) {
    var seen = {};
    for (var i = 0; i < choices.length; i++) {
      var flat = Heb.strip(choices[i]);
      if (seen[flat]) return true;
      seen[flat] = 1;
    }
    return false;
  }

  BODY.mcq = function (body, actions, q) {
    var keepPoints = pointedChoices(q.choices);
    body.innerHTML = '<div class="test-choices">' + q.choices.map(function (c, i) {
      return '<button class="test-choice" dir="auto" data-i="' + i + '" data-key="' + (i + 1) + '">' +
        key(i + 1) + escapeHtml(keepPoints ? c : Heb.show(c)) + '</button>';
    }).join('') + '</div>' +
      '<p class="test-keyhint">Press 1-' + q.choices.length + ', or click.</p>';

    body.addEventListener('click', function (e) {
      var b = e.target.closest('.test-choice');
      if (!b || body.classList.contains('is-done')) return;
      body.classList.add('is-done');
      var chosen = Number(b.dataset.i);
      var right = chosen === q.a;
      body.querySelectorAll('.test-choice').forEach(function (el, i) {
        el.disabled = true;
        if (i === q.a) el.classList.add('is-right');
        else if (i === chosen) el.classList.add('is-wrong');
      });
      // The choice itself, not its number: the summary shows what you picked.
      settle(q, right, q.choices[chosen]);
    });
  };

  BODY.fill = function (body, actions, q) {
    body.innerHTML =
      '<input class="test-input" id="testIn" autocomplete="off" autocapitalize="off" ' +
      'spellcheck="false" dir="auto" lang="he" placeholder="Type your answer">' + keyBar();
    var input = body.querySelector('#testIn');
    bindKeys(body, input);
    actions.innerHTML = '<button class="btn btn-primary btn-lg" data-act="check">Check</button>';
    actions.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="check"]')) return;
      input.disabled = true;
      settle(q, gradeText(q, input.value), input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); enterStep(); }
    });
  };

  BODY.listen = function (body, actions, q) {
    if (!window.Say || !Say.supported()) {
      // No voices: show the sentence and fall back to self-marking.
      body.innerHTML = '<p class="test-note">No speech voice in this browser, so here it is written: ' +
        '<strong lang="he" dir="rtl">' + escapeHtml(Heb.show(q.say)) + '</strong></p>';
      return selfMark(body, actions, q);
    }
    body.innerHTML =
      '<div class="test-listen">' +
        '<button class="btn btn-primary btn-lg" data-act="play">🔊 Play it</button>' +
        '<button class="btn" data-act="slow">Slower</button>' +
      '</div>' +
      '<input class="test-input" id="testIn" autocomplete="off" autocapitalize="off" ' +
      'spellcheck="false" dir="auto" lang="he" placeholder="Type what you hear">' + keyBar();
    var input = body.querySelector('#testIn');
    bindKeys(body, input);
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      Say.speak(q.say, { slow: b.dataset.act === 'slow' });
    });
    // Deliberately not played on render. The hash survives a reload, so
    // autoplay meant reopening the site spoke a sentence at you unasked.
    actions.innerHTML = '<button class="btn btn-primary btn-lg" data-act="check">Check</button>';
    actions.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="check"]')) return;
      input.disabled = true;
      settle(q, gradeText(q, input.value), input.value);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); enterStep(); }
    });
  };

  BODY.order = function (body, actions, q) {
    var picked = [];
    var pool = shuffle(q.words);
    // Same reasoning as the multiple choice above: two chips that look alike
    // once the points come off cannot be told apart in the pool.
    var keepPoints = pointedChoices(q.words);
    var chip = function (w) { return escapeHtml(keepPoints ? w : Heb.show(w)); };

    function paint() {
      body.innerHTML =
        '<div class="test-slot" id="slot" dir="rtl">' + (picked.length
          // `picked` holds pool indexes, so the chip text comes from the pool.
          ? picked.map(function (n, i) {
              return '<button class="chip chip-set" lang="he" data-drop="' + i + '">' +
                chip(pool[n]) + '</button>';
            }).join('')
          : '<span class="test-slot-empty" dir="ltr">Tap the words in order</span>') +
        '</div>' +
        '<div class="test-pool" dir="rtl">' + pool.map(function (w, i) {
          return picked.indexOf(i) === -1
            ? '<button class="chip" lang="he" data-pick="' + i + '">' +
              chip(w) + '</button>' : '';
        }).join('') + '</div>' +
        '<p class="test-keyhint">Keys: a number picks the next word, Enter checks it, ' +
        'Enter again moves on.</p>';
    }

    // `picked` holds pool indexes, not words, so repeated words behave.
    function words() { return picked.map(function (i) { return pool[i]; }); }

    body.addEventListener('click', function (e) {
      if (body.classList.contains('is-done')) return;
      var pick = e.target.closest('[data-pick]');
      var drop = e.target.closest('[data-drop]');
      if (pick) picked.push(Number(pick.dataset.pick));
      else if (drop) picked.splice(Number(drop.dataset.drop), 1);
      else return;
      paint();
    });

    actions.innerHTML = '<button class="btn btn-primary btn-lg" data-act="check">Check</button>';
    actions.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="check"]')) return;
      // Enter reaches this button too, so an empty slot must not be graded as
      // a wrong answer just because the key was pressed early.
      if (!picked.length) return;
      body.classList.add('is-done');
      settle(q, gradeOrder(q, words()), words().join(' '));
    });
    paint();
  };

  BODY.say = function (body, actions, q) {
    var canHear = window.Say && Say.supported();
    body.innerHTML =
      '<p class="test-target" lang="he" dir="rtl">' + escapeHtml(Heb.show(q.target)) + '</p>' +
      (canHear ? '<button class="btn" data-act="model">🔊 Hear it first</button>' : '');

    if (canHear) {
      body.addEventListener('click', function (e) {
        if (e.target.closest('[data-act="model"]')) Say.speak(q.target, {});
      });
    }

    if (!window.Speech || !Speech.supported()) {
      var note = document.createElement('p');
      note.className = 'test-note';
      note.textContent = 'This browser cannot listen, so mark yourself: say it out loud, ' +
        'then compare with the model.';
      body.appendChild(note);
      return selfMark(body, actions, q);
    }

    actions.innerHTML = '<button class="btn btn-primary btn-lg" data-act="rec">🎤 Say it</button>' +
      '<button class="btn" data-act="skip">Skip</button>';

    // Three goes, best one counts. The recogniser is the unreliable half of
    // this exchange, so a single bad transcript should not decide anything.
    var TRIES = 3;
    var tries = 0;
    var bestTry = null;
    var out = document.createElement('div');
    body.appendChild(out);

    actions.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'skip') {
        return settle(q, bestTry ? bestTry.pass : false,
          bestTry ? bestTry.heard : '(skipped)', bestTry);
      }
      if (b.disabled) return;

      b.disabled = true;
      b.textContent = '🎤 Listening…';
      Say.stop();   // the model voice must not be recorded as your answer

      Speech.check(q.target, {
        onPartial: function (text) { b.textContent = '🎤 ' + text; }
      }).then(function (r) {
        if (!bestTry || r.pct > bestTry.pct) bestTry = r;

        // An unusable transcript costs nothing: it is the recogniser's
        // failure, not yours, so it does not consume an attempt.
        if (r.unclear) {
          b.disabled = false;
          b.textContent = '🎤 Again';
          out.innerHTML =
            '<p class="test-note is-bad">The recogniser did not make that out - it heard ' +
            '<em>' + escapeHtml(r.heard || 'nothing') + '</em>, which is not a possible ' +
            'attempt at this. Short phrases confuse it, so it guesses a real word that ' +
            'fits the sounds. Say it again, a little slower, with a gap between the words.</p>' +
            '<p class="test-note">If it keeps failing, hear the model and mark yourself.</p>' +
            selfMarkHtml();
          wireSelfMark(out, q);
          return;
        }

        tries++;
        out.innerHTML = heardHtml(r);
        if (r.pass || tries >= TRIES) {
          return settle(q, bestTry.pass, bestTry.heard, bestTry);
        }
        b.disabled = false;
        b.textContent = '🎤 Again (' + (TRIES - tries) + ' left)';
        out.insertAdjacentHTML('beforeend',
          '<p class="test-note">Best so far ' + bestTry.pct + '%. The underlined words are the ' +
          'ones to fix.</p>');
      }).catch(function (err) {
        b.disabled = false;
        b.textContent = '🎤 Try again';
        out.innerHTML = '<p class="test-note is-bad">' + escapeHtml(err.message) + '</p>';
      });
    });
  };

  // Offered when the microphone route has failed us rather than the learner.
  function selfMarkHtml() {
    return '<div class="test-actions">' +
      '<button class="btn btn-keyed btn-ok" data-self="ok" data-key="1">' +
        key(1) + 'I said it right</button>' +
      '<button class="btn btn-keyed btn-again" data-self="no" data-key="2">' +
        key(2) + 'I did not</button>' +
      '</div>';
  }

  function wireSelfMark(host, q) {
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-self]');
      if (!b) return;
      settle(q, b.dataset.self === 'ok', '(marked by you)', null, true);
    });
  }

  BODY.open = function (body, actions, q) {
    body.innerHTML = '<textarea class="test-input" id="testIn" rows="3" dir="auto" lang="he" ' +
      'placeholder="Answer in your own words, then reveal the model answer."></textarea>' +
      keyBar();
    var input = body.querySelector('#testIn');
    bindKeys(body, input);
    selfMark(body, actions, q);
    // The caret is in the box from the start, so the global Enter shortcut
    // never sees the key. Shift-Enter is left as the way to a new line.
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      e.preventDefault();
      enterStep();
    });
  };

  /* -------------------------------------------------------- letter bar */

  // Nobody starting Hebrew has a Hebrew keyboard, and an answer that cannot
  // be typed is not a question. The bar is the alef-bet in order, right to
  // left, with the five final forms in their alphabetical places.
  var LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'כ', 'ך', 'ל',
                 'מ', 'ם', 'נ', 'ן', 'ס', 'ע', 'פ', 'ף', 'צ', 'ץ', 'ק', 'ר', 'ש', 'ת'];

  function keyBar() {
    return '<div class="key-bar" role="group" aria-label="Insert a Hebrew letter" dir="rtl">' +
      LETTERS.map(function (c) {
        var fin = /[ךםןףץ]/.test(c) ? ' key-final' : '';
        return '<button class="key-letter' + fin + '" type="button" tabindex="-1" ' +
          'data-ch="' + c + '" lang="he">' + c + '</button>';
      }).join('') +
      '<span class="key-note" dir="ltr">or type a letter twice for its final form</span>' +
      '</div>';
  }

  function bindKeys(body, input) {
    var bar = body.querySelector('.key-bar');
    if (!bar || !input) return;

    // mousedown, not click: the button must not take focus off the field,
    // or the caret position is lost before the character is inserted.
    bar.addEventListener('mousedown', function (e) {
      var b = e.target.closest('[data-ch]');
      if (!b) return;
      e.preventDefault();
      insert(input, b.dataset.ch);
    });

    input.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      var at = input.selectionStart;
      if (at === null || at !== input.selectionEnd || at === 0) return;
      var prev = input.value.charAt(at - 1);
      // The same base letter again: swap the one already there for its final
      // form, which is the only way to type ך on a keyboard that has no
      // Hebrew layout at all.
      if (Heb.TO_FINAL[prev] && e.key === prev) {
        e.preventDefault();
        input.setRangeText(Heb.TO_FINAL[prev], at - 1, at, 'end');
      }
    });
  }

  function insert(input, ch) {
    var at = input.selectionStart;
    if (at === null) { input.value += ch; return; }
    input.setRangeText(ch, at, input.selectionEnd, 'end');
    input.focus();
  }

  // Types the machine cannot judge: reveal the model answer, you decide.
  // A digit is only offered when there is nothing to type into. On an open
  // answer the caret is in the box, where a "1" is a character you meant, so
  // the buttons wear no digit rather than advertising a key that types.
  function selfMark(body, actions, q) {
    var typed = !!body.querySelector('#testIn');
    // One attribute, not two: a second class="" on the same element is thrown
    // away by the parser, taking btn-lg with it.
    var btn = function (extra, n) {
      return ' class="btn btn-lg' + (extra ? ' ' + extra : '') + (typed ? '' : ' btn-keyed') + '"' +
        (typed ? '' : ' data-key="' + n + '"');
    };
    var chip = function (n) { return typed ? '' : key(n); };

    actions.innerHTML = '<button' + btn('', 1) + ' data-act="reveal">' +
      chip(1) + 'Show the answer</button>';
    actions.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'reveal') {
        body.insertAdjacentHTML('beforeend',
          '<p class="test-model" dir="auto"><span>Model answer</span>' +
          escapeHtml(Heb.show(modelAnswer(q))) + '</p>');
        actions.innerHTML =
          '<button' + btn('btn-ok', 1) + ' data-act="got">' + chip(1) + 'I had it</button>' +
          '<button' + btn('btn-again', 2) + ' data-act="missed">' + chip(2) + 'Not quite</button>';
        return;
      }
      settle(q, b.dataset.act === 'got', null, null, true);
    });
  }

  function heardHtml(r) {
    return '<p class="test-heard" lang="he" dir="rtl">' + r.words.map(function (w) {
      return '<span class="hw hw-' + w.state + '">' + escapeHtml(w.word) + '</span>';
    }).join(' ') + '<span class="test-heard-pct">' + r.pct + '%</span></p>' +
      '<p class="test-note">Heard: ' + escapeHtml(r.heard || '-') + '</p>';
  }

  /* ---------------------------------------------------------- keyboard */

  // One Enter, one step: it grades what is on screen, and only a second Enter
  // moves on. Pressing it once used to skip past the verdict on anything that
  // was graded by another route, which is the half of a test worth reading.
  function enterStep() {
    if (!run) return;
    var step = run.host.querySelector('[data-act="next"]') ||
      run.host.querySelector('[data-act="check"]') ||
      run.host.querySelector('[data-act="reveal"]');
    if (step && !step.disabled) step.click();
  }

  // A digit presses whatever wears it: a multiple choice, the two self-marks,
  // the three mastery levels, another go at a spoken answer. Anything without
  // a digit of its own falls through to the ordering pool, where a digit picks
  // the next word. Enter is handled by enterStep above.
  function onKey(e) {
    if (!run) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && t.matches && t.matches('input, textarea, select')) return;

    // Left arrow goes back a question, wherever you are in one. A text field
    // has already claimed the key above, where the caret needs it.
    if (e.key === 'ArrowLeft') {
      var back = run.host.querySelector('[data-act="back"]');
      if (back) { e.preventDefault(); back.click(); }
      return;
    }

    var next = run.host.querySelector('[data-act="next"]');
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterStep();
      return;
    }

    if (!/^[1-9]$/.test(e.key)) return;
    var n = Number(e.key);

    // A button that has been graded is disabled, and one on a panel that is
    // no longer showing has no layout box, so neither can be pressed.
    var keyed = run.host.querySelector('[data-key="' + n + '"]:not([disabled])');
    if (keyed && keyed.offsetParent !== null) { e.preventDefault(); keyed.click(); return; }

    if (next) return;
    var chips = run.host.querySelectorAll('.test-pool [data-pick]');
    if (chips[n - 1]) { e.preventDefault(); chips[n - 1].click(); }
  }

  document.addEventListener('keydown', onKey);

  /* ---------------------------------------------------------- verdict */

  function settle(q, right, given, extra, selfMarked) {
    var s = run;
    if (!s) return;
    if (right) s.right++;
    // The question itself is kept, not just its id: the summary lists what you
    // got wrong, and it needs the prompt and the model answer to do that.
    s.answered.push({
      id: q.id, ch: q.ch, right: !!right, given: given || '', q: q, selfMarked: !!selfMarked
    });

    // Chapter exercises and tests share the same store, so a test answer
    // shows up in the chapter's accuracy too.
    Progress.setEx(q.ch || s.id, 'test', q.id, right ? 'ok' : 'again');

    // A final-letter slip is a pass, but the spelling is still worth seeing,
    // so it gets the model answer that a plain pass does not.
    var slip = right === 'slip';
    var v = s.host.querySelector('#testVerdict');
    v.hidden = false;
    v.className = 'test-verdict ' + (right ? 'is-right' : 'is-wrong') + (slip ? ' is-slip' : '');
    v.innerHTML =
      '<strong>' + (right
        ? (slip ? 'Correct, spelling aside' : selfMarked ? 'Marked as known' : 'Correct')
        : 'Not quite') + '</strong>' +
      (slip || (!right && !selfMarked && q.type !== 'say')
        ? '<p class="test-answer" dir="auto">' + escapeHtml(Heb.show(modelAnswer(q))) + '</p>' : '') +
      (slip ? '<p class="test-slip-note">A final letter was off: ' +
        '<span lang="he" dir="rtl">\u05da \u05dd \u05df \u05e3 \u05e5</span> ' +
        'only at the end of a word.</p>' : '') +
      '<p dir="auto">' + escapeHtml(Heb.show(q.why || '')) + '</p>';

    // Swap the whole row rather than its contents: the question type that
    // just finished left a click handler on it, and that handler would
    // otherwise also catch the Next click and settle the following
    // question before it had been answered.
    var stale = s.host.querySelector('#testActions');
    var actions = stale.cloneNode(false);
    stale.parentNode.replaceChild(actions, stale);

    var last = s.i === s.questions.length - 1;
    // A spoken answer is the one type where the verdict can be the tool's
    // fault: a noisy room or a recogniser that guessed a real word. Offer the
    // question back rather than making you live with that.
    actions.innerHTML =
      (q.type === 'say'
        ? '<button class="btn btn-lg btn-keyed" data-act="redo" data-key="1">' +
          key(1) + '🎤 Say it again</button>' : '') +
      '<button class="btn btn-primary btn-lg" data-act="next">' +
      (last ? 'See the score' : 'Next') + '</button>';

    var redo = actions.querySelector('[data-act="redo"]');
    if (redo) {
      redo.addEventListener('click', function () {
        // Undo the mark first, or a second go would count as a second
        // question and a lucky retry would inflate the score.
        var prev = s.answered.pop();
        if (prev && prev.right) s.right--;
        Progress.setEx(q.ch || s.id, 'test', q.id, null);
        render();
      });
    }

    var next = actions.querySelector('[data-act="next"]');
    next.addEventListener('click', function () { s.i++; render(); });
    next.focus();
  }

  /* ---------------------------------------------------------- summary */

  function renderSummary() {
    var s = run;
    var pct = s.questions.length ? Math.round((s.right / s.questions.length) * 100) : 0;
    // The score is the headline; the detail is what makes a later sitting
    // comparable - which questions came up, and which ones went wrong.
    Progress.recordTest(s.id, pct, {
      n: s.questions.length,
      got: s.right,
      asked: s.answered.map(function (a) { return a.id; }),
      wrong: s.answered.filter(function (a) { return !a.right; })
        .map(function (a) { return a.id; })
    });

    var byCh = {};
    s.answered.forEach(function (a) {
      var c = byCh[a.ch] = byCh[a.ch] || { right: 0, total: 0 };
      c.total++;
      if (a.right) c.right++;
    });

    var weak = Object.keys(byCh).filter(function (c) {
      return byCh[c].right / byCh[c].total < 0.7;
    });

    var level = Progress.mastery(s.masteryKey).level;

    s.host.innerHTML =
      '<div class="test-summary">' +
        '<div class="test-score ' + (pct >= 80 ? 'is-good' : pct >= 50 ? 'is-mid' : 'is-low') + '">' +
          '<strong>' + pct + '%</strong><span>' + s.right + ' of ' + s.questions.length + '</span>' +
        '</div>' +
        (weak.length
          ? '<p>Worth another look: ' + weak.map(function (c) {
              return '<a href="#/' + c + '">' + escapeHtml(c.replace(/-/g, ' ')) + '</a>';
            }).join(', ') + '.</p>'
          : '<p>Nothing stood out as weak.</p>') +
        wrongHtml(s.answered) +
        '<div class="mastery-box' + (level ? '' : ' is-todo') + '">' +
          '<h3>' + (level ? 'Your mark' : 'One thing left: mark it yourself') + '</h3>' +
          '<p class="mastery-say">' + masterySay(level, level > 0, pct) + '</p>' +
          // -1, not 0: an unmarked chapter used to open with *Not yet* looking
          // chosen, which read as an answer already given and was half the
          // reason a good score seemed to have been ignored.
          '<div class="mastery-picker">' +
            level3btn(0, 'Not yet', level || -1) +
            level3btn(1, 'Shaky', level) +
            level3btn(2, 'Confident', level) +
          '</div>' +
        '</div>' +
        '<div class="test-actions">' +
          // Where to go next, when whoever started the test knows: at the end
          // of a chapter test that is the next chapter, and having to go by
          // way of the sidebar was the long road to the obvious place.
          (s.next ? '<a class="btn btn-primary btn-lg" href="' + s.next.href + '">' +
            escapeHtml(s.next.label) + ' →</a>' : '') +
          '<button class="btn btn-lg" data-act="retry">Take it again</button>' +
          // The score is not the end of it either: one answer you want back
          // should not mean sitting the whole thing again.
          '<button class="btn btn-lg" data-act="back">← Last question</button>' +
        '</div>' +
      '</div>';

    s.host.querySelector('[data-act="back"]').addEventListener('click', goBack);

    s.host.querySelector('.mastery-picker').addEventListener('click', function (e) {
      var b = e.target.closest('[data-level]');
      if (!b) return;
      var lv = Number(b.dataset.level);
      Progress.setMastery(s.masteryKey, lv, pct);
      s.host.querySelectorAll('[data-level]').forEach(function (el) {
        el.classList.toggle('is-set', el === b);
      });
      var box = s.host.querySelector('.mastery-box');
      box.classList.remove('is-todo');
      box.querySelector('h3').textContent = 'Your mark';
      box.querySelector('.mastery-say').innerHTML = masterySay(lv, true, pct);
    });

    s.host.querySelector('[data-act="retry"]').addEventListener('click', function () {
      if (s.onDone) s.onDone({ retry: true });
    });

    if (s.onDone) s.onDone({ pct: pct, right: s.right, total: s.questions.length });
  }

  // Every question you got wrong, in the order they came, with what you said
  // next to what the answer was. A percentage tells you how much you missed;
  // this tells you what. The explanation is repeated here because at the end
  // of a test it is the first time you can read them side by side.
  function wrongHtml(answered) {
    var wrong = answered.filter(function (a) { return !a.right; });
    if (!wrong.length) return '';
    return '<div class="test-review">' +
      '<h3>What you got wrong <span>' + wrong.length + ' of ' + answered.length + '</span></h3>' +
      '<ol>' + wrong.map(function (a) {
        var q = a.q || {};
        var mine = String(a.given || '').trim();
        var model = modelAnswer(q);
        return '<li>' +
          '<p class="tr-q" dir="auto">' + escapeHtml(Heb.show(q.q || '')) + '</p>' +
          // What the voice read out, unless that is the answer line as well.
          (q.type === 'listen' && q.say && q.say !== model
            ? '<p class="tr-said"><span>It said</span>' +
              '<span lang="he" dir="rtl">' + escapeHtml(Heb.show(q.say)) + '</span></p>' : '') +
          (mine
            ? '<p class="tr-mine" dir="auto"><span>' + (q.type === 'say' ? 'It heard' : 'You said') + '</span>' +
              escapeHtml(mine) + '</p>'
            : a.selfMarked
              ? '<p class="tr-mine"><span>You said</span>you did not have it</p>'
              // An empty box was still an answer, and saying so beats a gap
              // that reads as though the question was never put to you.
              : '<p class="tr-mine"><span>You said</span>nothing</p>') +
          '<p class="tr-a" dir="auto"><span>Answer</span>' + escapeHtml(Heb.show(model)) + '</p>' +
          (q.why ? '<p class="tr-why" dir="auto">' + escapeHtml(Heb.show(q.why)) + '</p>' : '') +
          '</li>';
      }).join('') + '</ol></div>';
  }

  // The score and the progress figure are two different things, and a good
  // score that moved nothing reads like a bug. So say it plainly: nothing
  // counts until one of the three is picked, and say what each one is worth.
  function masterySay(level, picked, pct) {
    if (!picked) {
      return 'Your <strong>' + pct + '%</strong> is filed under Tests, but on its own it does not ' +
        'move the sidebar or the course percentage: a score is evidence, not a verdict. ' +
        'Pick one below: <strong>Not yet</strong> counts nothing, <strong>Shaky</strong> counts ' +
        'half a chapter, <strong>Confident</strong> counts a whole one.';
    }
    if (level === 2) {
      return 'Marked <strong>Confident</strong>: this chapter now counts in full, with a green ' +
        'bar beside it in the sidebar. Change it whenever you like.';
    }
    if (level === 1) {
      return 'Marked <strong>Shaky</strong>: counts as half a chapter, amber bar in the sidebar. ' +
        'Come back and mark it confident once it sticks.';
    }
    return 'Left as <strong>Not yet</strong>: nothing counted towards your progress. ' +
      'Reread it and take this again when you want the mark.';
  }

  function level3btn(n, label, current) {
    return '<button class="btn btn-keyed mastery-btn' + (current === n ? ' is-set' : '') +
      '" data-level="' + n + '" data-key="' + (n + 1) + '">' + key(n + 1) + label + '</button>';
  }

  /* ---------------------------------------------------------- helpers */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    loadGroups: loadGroups, findGroup: findGroup, loadGroupBanks: loadGroupBanks,
    loadChapter: loadChapter, loadPart: loadPart, hasBank: hasBank, pathFor: pathFor,
    sample: sample, shuffle: shuffle, start: start, stop: stop,
    gradeText: gradeText, gradeOrder: gradeOrder, norm: norm, modelAnswer: modelAnswer
  };
})();
