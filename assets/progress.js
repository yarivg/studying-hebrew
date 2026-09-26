/* ============================================================
   progress.js - everything the course remembers about you.

   State lives in localStorage. It is only ever sent anywhere if
   you connect the optional gist sync in sync.js.

   Shape:
   {
     v: 1,
     read:  { "<slug>": <epoch-ms> },
     ex:    { "<slug>:<exId>:<i>": "ok" | "again" },
     cards: { "<cardId>": { box: 0-5, due: <epoch-day>, seen: n, ok: n } },
     known: { "<wordId>": true },
     words: { "<u...>": { he, en, pos, g, tr, root, binyan, pl, themes: [], at } },
     edits: { "<wId>":  { he, en, pos, g, tr, root, binyan, pl, themes: [], at } },
     mastery: { "<slug|partN>": { level: 0-2, at, score } },   // self-marked
     tests:   { "<testId>": { best, runs, at } },              // best auto score
     runs:  [ { at, id, n, got, wrong: ["<qId>"] } ],         // every sitting, newest last
     qstat: { "<qId>": { seen, bad } },                       // lifetime per question
     days:  { "<yyyy-mm-dd>": <reviews that day> },
     hist:  { "<yyyy-mm-dd>": { at, pct, marked, solid, known, words, right, stuck } },
     m:     { "<kind>:<key>": <epoch-ms> },   // when each entry last changed
     clearedAt: <epoch-ms>                    // last "reset everything"
   }

   `m` is what makes two devices mergeable. An entry that is missing
   from a map but present in `m` was deleted at that time, so a
   deletion on one device is not undone by the other still having it.
   ============================================================ */

window.Progress = (function () {
  'use strict';

  var KEY = 'hamachberet.v1';

  // Leitner: box index -> days until the card comes back.
  var INTERVALS = [0, 1, 2, 5, 10, 21, 45];
  var MAX_BOX = INTERVALS.length - 1;

  var state = load();

  var MAPS = ['read', 'ex', 'cards', 'known', 'words', 'edits', 'mastery', 'tests', 'qstat'];

  function blank() {
    return {
      v: 1, read: {}, ex: {}, cards: {}, known: {}, words: {}, edits: {},
      mastery: {}, tests: {}, qstat: {}, runs: [], days: {}, hist: {}, m: {}, clearedAt: 0
    };
  }

  // Clock for the merge. Two writes in the same millisecond would look
  // concurrent to the other device, and a reset followed straight away by
  // a tick would swallow the tick, so stamps always move forward.
  var lastStamp = 0;

  function stamp() {
    var t = Date.now();
    lastStamp = t > lastStamp ? t : lastStamp + 1;
    return lastStamp;
  }

  // Record when an entry last changed, so a merge can tell which device
  // knows the newer answer - and tell a deletion from a never-had-it.
  function touch(kind, key) {
    state.m[kind + ':' + key] = stamp();
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      var parsed = JSON.parse(raw);
      var base = blank();
      for (var k in base) if (!parsed[k]) parsed[k] = base[k];
      // Never hand out a stamp below one already on disk, even if the
      // system clock has moved backwards since.
      lastStamp = parsed.clearedAt || 0;
      for (var mk in parsed.m) if (parsed.m[mk] > lastStamp) lastStamp = parsed.m[mk];
      return parsed;
    } catch (e) {
      return blank();
    }
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota or private mode */ }
    }, 120);
    if (typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('progress:change'));
    }
  }

  /* ---------------------------------------------------------- dates */

  function today() {
    var d = new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /* ---------------------------------------------------------- chapters */

  function isRead(slug) { return !!state.read[slug]; }

  function setRead(slug, on) {
    if (on) state.read[slug] = stamp();
    else delete state.read[slug];
    touch('read', slug);
    save();
  }

  function toggleRead(slug) {
    setRead(slug, !isRead(slug));
    return isRead(slug);
  }

  function readCount() { return Object.keys(state.read).length; }

  // Has this chapter been covered at all? Reading it counts, and so does
  // self-marking it, because you cannot judge a chapter you never opened.
  // The sidebar tick, the dashboard count and the reading list all ask
  // this same question, so they ask it here.
  function studied(slug) {
    return isRead(slug) || mastery(slug).level > 0;
  }

  // When, so the statistics page can put a chapter on a timeline. 0 = unread.
  function readAt(slug) { return state.read[slug] || 0; }

  /* ---------------------------------------------------------- exercises */

  function exKey(slug, exId, i) { return slug + ':' + exId + ':' + i; }

  function getEx(slug, exId, i) { return state.ex[exKey(slug, exId, i)] || null; }

  function setEx(slug, exId, i, verdict) {
    var k = exKey(slug, exId, i);
    if (verdict) state.ex[k] = verdict;
    else delete state.ex[k];
    touch('ex', k);
    bumpDay();
    save();
  }

  function exStats(slug) {
    var ok = 0, again = 0;
    var prefix = slug + ':';
    for (var k in state.ex) {
      if (k.indexOf(prefix) !== 0) continue;
      if (state.ex[k] === 'ok') ok++; else again++;
    }
    return { ok: ok, again: again, total: ok + again };
  }

  /* ---------------------------------------------------------- flashcards */

  function card(id) {
    return state.cards[id] || { box: 0, due: 0, seen: 0, ok: 0 };
  }

  function isDue(id) { return card(id).due <= today(); }

  function gradeCard(id, correct) {
    var c = card(id);
    c.seen++;
    if (correct) { c.ok++; c.box = Math.min(MAX_BOX, c.box + 1); }
    else { c.box = 0; }
    c.due = today() + INTERVALS[c.box];
    state.cards[id] = c;
    touch('cards', id);
    bumpDay();
    save();
    return c;
  }

  function resetCard(id) { delete state.cards[id]; touch('cards', id); save(); }

  function dueCount(ids) {
    var t = today(), n = 0;
    for (var i = 0; i < ids.length; i++) {
      var c = state.cards[ids[i]];
      if (!c || c.due <= t) n++;
    }
    return n;
  }

  // Cards never seen come first, then the most overdue.
  function dueQueue(ids) {
    var t = today();
    return ids
      .filter(function (id) { var c = state.cards[id]; return !c || c.due <= t; })
      .sort(function (a, b) {
        var ca = state.cards[a], cb = state.cards[b];
        if (!ca && !cb) return 0;
        if (!ca) return -1;
        if (!cb) return 1;
        return (ca.due - cb.due) || (ca.box - cb.box);
      });
  }

  function cardStats(ids) {
    var learned = 0, learning = 0, fresh = 0, right = 0;
    ids.forEach(function (id) {
      var c = state.cards[id];
      if (!c || !c.seen) { fresh++; return; }
      // Two different claims: `right` is "I have known this at least once",
      // `learned` is "I still knew it days later". Both are worth seeing.
      if (c.ok > 0) right++;
      if (c.box >= 4) learned++;
      else learning++;
    });
    return {
      learned: learned, learning: learning, fresh: fresh, right: right,
      total: ids.length
    };
  }

  /* ---------------------------------------------------------- vocabulary */

  function isKnown(id) { return !!state.known[id]; }

  function toggleKnown(id) {
    if (state.known[id]) delete state.known[id];
    else state.known[id] = true;
    touch('known', id);
    save();
    return isKnown(id);
  }

  function knownCount() { return Object.keys(state.known).length; }

  /* ---------------------------------------------------------- my words */

  // Words you add yourself live here rather than in data/vocab.json, so
  // they sync with everything else and survive a rebuild of the curated
  // list. Ids start with "u" so they can never collide with a "w<n>".
  var WORD_MAX = 120;          // characters per field
  var THEME_MAX = 4;           // themes per word

  function words() {
    var out = [];
    for (var id in state.words) {
      if (!has(state.words, id)) continue;
      var w = state.words[id];
      out.push({
        id: id, he: w.he, en: w.en, pos: w.pos, g: w.g,
        tr: w.tr || '', root: w.root || '', binyan: w.binyan || '', pl: w.pl || '',
        themes: w.themes.slice(), at: w.at
      });
    }
    return out.sort(function (a, b) { return b.at - a.at; });
  }

  function wordCount() { return Object.keys(state.words).length; }

  function getWord(id) { return has(state.words, id) ? state.words[id] : null; }

  // A word already in the list, matched the way a person would match it:
  // the same Hebrew, ignoring the points, a leading ה and the shape of a
  // final letter.
  function findWord(he) {
    var k = wordKey(he);
    if (!k) return null;
    for (var id in state.words) {
      if (has(state.words, id) && wordKey(state.words[id].he) === k) return id;
    }
    return null;
  }

  function wordKey(he) {
    var k = window.Heb ? Heb.plain(he) : String(he || '').trim();
    if (/^ה/.test(k) && k.replace(/^ה/, '').length >= 3) k = k.replace(/^ה/, '');
    return (window.Heb ? Heb.unfinal(k) : k).replace(/\s+/g, ' ').trim();
  }

  function addWord(input) {
    var w = cleanWord(input);
    if (!w) throw new Error('A word needs both a Hebrew side and an English side.');
    // Two devices adding in the same millisecond would otherwise collide.
    var id = 'u' + stamp().toString(36) + Math.random().toString(36).slice(2, 6);
    state.words[id] = w;
    touch('words', id);
    save();
    return id;
  }

  function updateWord(id, input) {
    if (!has(state.words, id)) return false;
    var w = cleanWord(input);
    if (!w) throw new Error('A word needs both a Hebrew side and an English side.');
    w.at = state.words[id].at;
    state.words[id] = w;
    touch('words', id);
    save();
    return true;
  }

  function deleteWord(id) {
    if (!has(state.words, id)) return false;
    delete state.words[id];
    // The tombstone is what stops the other device putting it back.
    touch('words', id);
    if (state.known[id]) { delete state.known[id]; touch('known', id); }
    save();
    return true;
  }

  /* ------------------------------------------------ correcting a curated word

     A gloss in vocab.json is sometimes wrong or too narrow, and the file
     ships with the site, so the correction has to live here instead. It is
     stored against the curated id, which is what every tick, card and
     score is already keyed by: an edit changes what a word says, never
     which word it is. Clear the edit and the shipped version is back,
     because the original was never overwritten. */

  function getEdit(id) { return has(state.edits, id) ? state.edits[id] : null; }

  function editCount() { return Object.keys(state.edits).length; }

  function setEdit(id, input) {
    if (String(id).charAt(0) !== 'w') return false;
    var e = cleanWord(input);
    if (!e) throw new Error('A word needs both a Hebrew side and an English side.');
    state.edits[id] = e;
    touch('edits', id);
    save();
    return true;
  }

  function clearEdit(id) {
    if (!has(state.edits, id)) return false;
    delete state.edits[id];
    // The tombstone is what stops the other device putting it back.
    touch('edits', id);
    save();
    return true;
  }

  function cleanWord(input) {
    input = input || {};
    var he = trim(input.he), en = trim(input.en);
    if (!he || !en) return null;
    var out = {
      he: he, en: en,
      pos: POS.indexOf(input.pos) !== -1 ? input.pos : 'other',
      g: GENDERS.indexOf(input.g) !== -1 ? input.g : '',
      themes: cleanThemes(input.themes),
      at: num(input.at) || stamp()
    };
    // Optional and only stored when there is something in them, so a word
    // typed in two fields does not carry four empty ones to the other device.
    var tr = trim(input.tr).slice(0, 60);
    if (tr) out.tr = tr;
    var root = trim(input.root).slice(0, 12);
    if (root) out.root = root;
    if (BINYANIM.indexOf(input.binyan) > 0) out.binyan = input.binyan;
    var pl = trim(input.pl).slice(0, 60);
    if (pl) out.pl = pl;
    return out;
  }

  var POS = ['noun', 'verb', 'adj', 'phrase', 'connector', 'grammar', 'number', 'other'];
  var GENDERS = ['m', 'f', 'pl', 'mf', ''];
  var BINYANIM = ['', 'paal', 'piel', 'hifil', 'hitpael', 'nifal', 'pual', 'hufal'];

  function cleanThemes(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < THEME_MAX; i++) {
      var t = String(list[i] || '').toLowerCase().trim();
      if (/^[a-z][a-z0-9-]{0,19}$/.test(t) && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  function trim(v) {
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, WORD_MAX) : '';
  }

  /* ---------------------------------------------------------- mastery */

  // The auto-graded score is evidence; the level is your own call. A test
  // you aced but do not trust stays at 0 until you say otherwise.
  var LEVELS = ['none', 'shaky', 'solid'];

  function mastery(key) {
    var m = state.mastery[key];
    return m ? { level: m.level, at: m.at, score: m.score } : { level: 0, at: 0, score: 0 };
  }

  function setMastery(key, level, score) {
    level = clamp(num(level), 0, LEVELS.length - 1);
    if (!level) delete state.mastery[key];
    else state.mastery[key] = { level: level, at: stamp(), score: clamp(num(score), 0, 100) };
    touch('mastery', key);
    // Judging a chapter means you have read it, so the tick follows the mark
    // and there is nothing left to press by hand. A part exam ("part-2") and
    // a reading passage ("read:a1-01") are not chapters, so they are left out.
    if (level && !/^part-/.test(key) && key.indexOf(':') === -1 && !state.read[key]) {
      setRead(key, true);
    }
    save();
    return level;
  }

  function masteryCount(level) {
    var n = 0;
    for (var k in state.mastery) if (has(state.mastery, k) && state.mastery[k].level >= level) n++;
    return n;
  }

  function testScore(id) {
    var t = state.tests[id];
    return t ? { best: t.best, runs: t.runs, at: t.at } : { best: 0, runs: 0, at: 0 };
  }

  // How many sittings we keep in full. Each row is a few dozen bytes, so 200
  // is well under a tenth of a megabyte and the gist stays small. The per
  // question counters below never grow past the number of questions there are.
  var MAX_RUNS = 200;

  // detail is optional: { n: asked, got: right, wrong: [question ids] }
  function recordTest(id, pct, detail) {
    var t = state.tests[id] || { best: 0, runs: 0, at: 0 };
    t.best = Math.max(t.best, clamp(num(pct), 0, 100));
    t.runs++;
    t.at = stamp();
    state.tests[id] = t;
    touch('tests', id);

    if (detail) {
      if (!Array.isArray(state.runs)) state.runs = [];
      state.runs.push({
        at: Date.now(),
        id: id,
        n: num(detail.n) || 0,
        got: num(detail.got) || 0,
        wrong: (detail.wrong || []).slice(0, 60)
      });
      if (state.runs.length > MAX_RUNS) state.runs = state.runs.slice(-MAX_RUNS);

      if (!state.qstat) state.qstat = {};
      (detail.asked || []).forEach(function (qid) {
        var q = state.qstat[qid] || { seen: 0, bad: 0 };
        q.seen++;
        state.qstat[qid] = q;
        touch('qstat', qid);
      });
      (detail.wrong || []).forEach(function (qid) {
        var q = state.qstat[qid] || { seen: 0, bad: 0 };
        q.bad++;
        state.qstat[qid] = q;
        touch('qstat', qid);
      });
    }

    bumpDay();
    save();
    return t;
  }

  // Every sitting, newest first, optionally filtered to one test id.
  function runs(id) {
    var all = (state.runs || []).slice().reverse();
    return id ? all.filter(function (r) { return r.id === id; }) : all;
  }

  // The questions you get wrong most often. `min` is how many times a question
  // must have been asked before its rate means anything.
  function weakSpots(min) {
    min = min || 2;
    var out = [];
    for (var qid in state.qstat) {
      if (!has(state.qstat, qid)) continue;
      var q = state.qstat[qid];
      if (q.seen >= min && q.bad) {
        out.push({ id: qid, seen: q.seen, bad: q.bad, rate: q.bad / q.seen });
      }
    }
    return out.sort(function (a, b) { return b.rate - a.rate || b.bad - a.bad; });
  }

  /* ---------------------------------------------------------- streak */

  function bumpDay() {
    var k = todayKey();
    state.days[k] = (state.days[k] || 0) + 1;
  }

  function streak() {
    var n = 0;
    var d = new Date();
    for (;;) {
      var k = d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
      if (!state.days[k]) {
        // Today not yet studied doesn't break a streak that ran through yesterday.
        if (n === 0 && k === todayKey()) { d.setDate(d.getDate() - 1); continue; }
        break;
      }
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function reviewsToday() { return state.days[todayKey()] || 0; }

  function dayCounts() {
    var out = {};
    for (var k in state.days) if (has(state.days, k)) out[k] = state.days[k];
    return out;
  }

  /* ---------------------------------------------------------- history */

  // Chapter marks and added words carry their own timestamp, so a curve for
  // those can be drawn backwards from what is already stored. Two numbers
  // cannot: how many words you had ticked as known, and how far the
  // flashcards had got, because both are a count of entries with no date.
  // So one snapshot a day is kept - last write of the day wins - and the
  // statistics page draws those two from it.
  var HIST_FIELDS = ['pct', 'marked', 'solid', 'known', 'words', 'right', 'stuck'];
  var HIST_DAYS = 400;          // a bit over a year, then the oldest go

  function snapDay(metrics) {
    metrics = metrics || {};
    var rec = { at: stamp() };
    HIST_FIELDS.forEach(function (f) { rec[f] = clamp(num(metrics[f]), 0, 1e6); });
    var key = todayKey();
    var was = state.hist[key];
    // Nothing moved today: keep the earlier record rather than rewriting it,
    // so an idle page load does not count as a change the sync has to push.
    if (was && HIST_FIELDS.every(function (f) { return was[f] === rec[f]; })) return false;
    state.hist[key] = rec;
    trimHist();
    save();
    return true;
  }

  function trimHist() {
    var keys = Object.keys(state.hist).sort();
    for (var i = 0; i < keys.length - HIST_DAYS; i++) delete state.hist[keys[i]];
  }

  // Oldest first, each entry stamped with its day, ready to plot.
  function history() {
    return Object.keys(state.hist).sort().map(function (day) {
      var rec = state.hist[day], out = { day: day };
      HIST_FIELDS.forEach(function (f) { out[f] = rec[f] || 0; });
      return out;
    });
  }

  /* ---------------------------------------------------------- merging */

  // Anything arriving from outside this module - a gist, an imported file -
  // is rebuilt key by key into a shape this code is willing to trust. Only
  // the token holder can write the gist, but a merge should still never be
  // able to smuggle a foreign field into the state that the UI renders.
  var LIMIT = 20000;          // entries per map
  var KEY_MAX = 160;          // characters per key

  function sanitize(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Not a progress file');
    }
    var out = blank();
    var ts = num(input.clearedAt);
    out.clearedAt = ts > 0 ? ts : 0;

    each(input.read, function (key, value) { out.read[key] = num(value); });
    each(input.ex, function (key, value) {
      if (value === 'ok' || value === 'again') out.ex[key] = value;
    });
    each(input.known, function (key, value) { if (value) out.known[key] = true; });
    each(input.cards, function (key, value) {
      if (!value || typeof value !== 'object') return;
      out.cards[key] = {
        box: clamp(num(value.box), 0, MAX_BOX),
        due: clamp(num(value.due), 0, 1e7),
        seen: clamp(num(value.seen), 0, 1e6),
        ok: clamp(num(value.ok), 0, 1e6)
      };
    });
    each(input.words, function (key, value) {
      if (key.charAt(0) !== 'u') return;   // ids the UI is willing to render
      var w = cleanWord(value);
      if (w) out.words[key] = w;
    });
    each(input.edits, function (key, value) {
      if (key.charAt(0) !== 'w') return;   // only the curated ids can be overridden
      var e = cleanWord(value);
      if (e) out.edits[key] = e;
    });
    each(input.mastery, function (key, value) {
      if (!value || typeof value !== 'object') return;
      var level = clamp(num(value.level), 0, LEVELS.length - 1);
      if (!level) return;
      out.mastery[key] = { level: level, at: num(value.at), score: clamp(num(value.score), 0, 100) };
    });
    each(input.tests, function (key, value) {
      if (!value || typeof value !== 'object') return;
      out.tests[key] = {
        best: clamp(num(value.best), 0, 100),
        runs: clamp(num(value.runs), 0, 1e6),
        at: num(value.at)
      };
    });
    each(input.qstat, function (key, value) {
      if (!value || typeof value !== 'object') return;
      out.qstat[key] = {
        seen: clamp(num(value.seen), 0, 1e6),
        bad: clamp(num(value.bad), 0, 1e6)
      };
    });
    if (Array.isArray(input.runs)) {
      out.runs = input.runs.slice(-MAX_RUNS).filter(function (r) {
        return r && typeof r === 'object' && typeof r.id === 'string';
      }).map(function (r) {
        return {
          at: num(r.at), id: r.id.slice(0, KEY_MAX),
          n: clamp(num(r.n), 0, 1e4), got: clamp(num(r.got), 0, 1e4),
          wrong: Array.isArray(r.wrong)
            ? r.wrong.filter(function (x) { return typeof x === 'string'; }).slice(0, 60)
            : []
        };
      });
    }
    each(input.days, function (key, value) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) out.days[key] = clamp(num(value), 0, 1e6);
    });
    each(input.hist, function (key, value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') return;
      var rec = { at: num(value.at) };
      HIST_FIELDS.forEach(function (f) { rec[f] = clamp(num(value[f]), 0, 1e6); });
      out.hist[key] = rec;
    });
    each(input.m, function (key, value) {
      var t = num(value);
      // A key here is "<kind>:<entry>", and only the kinds we merge.
      if (t > 0 && MAPS.indexOf(key.slice(0, key.indexOf(':'))) !== -1) out.m[key] = t;
    });
    return out;
  }

  function each(obj, fn) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length && i < LIMIT; i++) {
      var key = keys[i];
      if (typeof key !== 'string' || key.length > KEY_MAX) continue;
      // Writing these by name would reach the prototype, not the map.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      fn(key, obj[key]);
    }
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, Math.round(v))); }

  // Fold another device's state into this one. Entry by entry, the side
  // that wrote last wins; where neither recorded a time (state written
  // before `m` existed) having the entry beats not having it, so an old
  // export can only ever add to what is here.
  function mergeRemote(input) {
    var remote = sanitize(input);

    var cleared = Math.max(state.clearedAt || 0, remote.clearedAt || 0);
    var out = blank();
    out.clearedAt = cleared;

    MAPS.forEach(function (kind) {
      var keys = Object.create(null);
      Object.keys(state[kind]).forEach(function (key) { keys[key] = 1; });
      Object.keys(remote[kind]).forEach(function (key) { keys[key] = 1; });
      [state.m, remote.m].forEach(function (m) {
        Object.keys(m).forEach(function (mk) {
          if (mk.indexOf(kind + ':') === 0) keys[mk.slice(kind.length + 1)] = 1;
        });
      });

      Object.keys(keys).forEach(function (key) {
        var mk = kind + ':' + key;
        var lt = state.m[mk] || 0, rt = remote.m[mk] || 0;
        var ts = Math.max(lt, rt);
        // Anything last touched before a "reset everything" was wiped
        // on purpose and must not come back from the other device.
        if (cleared && ts <= cleared) return;

        var lHas = has(state[kind], key), rHas = has(remote[kind], key);
        if (kind === 'cards' && lHas && rHas) {
          out.cards[key] = mergeCard(state.cards[key], remote.cards[key], lt, rt);
        } else if (kind === 'qstat' && lHas && rHas) {
          // Both devices counted real sittings, so neither count is stale:
          // take the higher of each, the same way a best score works.
          var qa = state.qstat[key], qb = remote.qstat[key];
          out.qstat[key] = {
            seen: Math.max(num(qa.seen), num(qb.seen)),
            bad: Math.max(num(qa.bad), num(qb.bad))
          };
        } else if (kind === 'tests' && lHas && rHas) {
          // A best score is a high-water mark on both sides, not a value
          // the later write should be allowed to lower.
          var a = state.tests[key], b = remote.tests[key];
          out.tests[key] = {
            best: Math.max(a.best, b.best),
            runs: Math.max(a.runs, b.runs),
            at: Math.max(a.at, b.at)
          };
        } else {
          var mine = lt === rt ? lHas : lt > rt;
          if (mine && lHas) out[kind][key] = state[kind][key];
          else if (!mine && rHas) out[kind][key] = remote[kind][key];
          // Neither branch taken means the winning side had deleted it.
        }
        if (ts) out.m[mk] = ts;
      });
    });

    // Both devices may have studied today; the larger count is the closer
    // guess, and adding them would inflate every shared day.
    Object.keys(state.days).concat(Object.keys(remote.days)).forEach(function (day) {
      out.days[day] = Math.max(state.days[day] || 0, remote.days[day] || 0);
    });

    // A day's snapshot is one reading of several counters, so it is taken
    // whole from whichever device wrote it later. Mixing the fields of two
    // devices would invent a state neither of them was ever in.
    Object.keys(state.hist).concat(Object.keys(remote.hist)).forEach(function (day) {
      var a = state.hist[day], b = remote.hist[day];
      var rec = !a ? b : !b ? a : (b.at > a.at ? b : a);
      if (rec && !(cleared && (rec.at || 0) <= cleared)) out.hist[day] = rec;
    });

    // Sittings are append-only history, so the union is the truth. Two rows
    // are the same sitting when the same test was graded at the same instant.
    var seenRun = {};
    out.runs = (state.runs || []).concat(remote.runs || [])
      .filter(function (r) {
        if (cleared && (r.at || 0) <= cleared) return false;
        var k = r.at + '|' + r.id;
        if (seenRun[k]) return false;
        seenRun[k] = 1;
        return true;
      })
      .sort(function (a, b) { return a.at - b.at; })
      .slice(-MAX_RUNS);

    state = out;
    save();
    return state;
  }

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  // Counters only ever grow, so take the highest of each; the schedule
  // comes from whichever device graded the card last.
  function mergeCard(a, b, at, bt) {
    var newer = at === bt ? ((a.seen || 0) >= (b.seen || 0) ? a : b) : (at > bt ? a : b);
    return {
      box: newer.box || 0,
      due: newer.due || 0,
      seen: Math.max(a.seen || 0, b.seen || 0),
      ok: Math.max(a.ok || 0, b.ok || 0)
    };
  }

  /* ---------------------------------------------------------- import / export */

  function snapshot() { return JSON.parse(JSON.stringify(state)); }

  // Cheap change detector for the sync loop: enough to tell "same as what
  // we last pushed" from "something moved".
  function fingerprint() {
    var s = JSON.stringify(state);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return s.length + ':' + h.toString(36);
  }

  function exportJSON() { return JSON.stringify(state, null, 2); }

  function importJSON(text) {
    state = sanitize(JSON.parse(text));
    save();
  }

  function reset() {
    state = blank();
    // Remember when, so syncing afterwards does not pull the old
    // progress back off the other device.
    state.clearedAt = stamp();
    save();
  }

  return {
    mergeRemote: mergeRemote, snapshot: snapshot, fingerprint: fingerprint,
    isRead: isRead, setRead: setRead, toggleRead: toggleRead, readCount: readCount,
    readAt: readAt,
    getEx: getEx, setEx: setEx, exStats: exStats,
    card: card, isDue: isDue, gradeCard: gradeCard, resetCard: resetCard,
    dueCount: dueCount, dueQueue: dueQueue, cardStats: cardStats,
    isKnown: isKnown, toggleKnown: toggleKnown, knownCount: knownCount,
    words: words, wordCount: wordCount, getWord: getWord, findWord: findWord,
    getEdit: getEdit, setEdit: setEdit, clearEdit: clearEdit, editCount: editCount,
    addWord: addWord, updateWord: updateWord, deleteWord: deleteWord,
    mastery: mastery, setMastery: setMastery, masteryCount: masteryCount,
    testScore: testScore, recordTest: recordTest, LEVELS: LEVELS,
    runs: runs, weakSpots: weakSpots,
    streak: streak, reviewsToday: reviewsToday, dayCounts: dayCounts,
    history: history, snapDay: snapDay,
    studied: studied,
    exportJSON: exportJSON, importJSON: importJSON, reset: reset,
    INTERVALS: INTERVALS, MAX_BOX: MAX_BOX
  };
})();
