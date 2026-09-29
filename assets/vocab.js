/* ============================================================
   vocab.js - loads data/vocab.json and renders the vocabulary
   browser, the ::: vocab blocks embedded in lessons, and the
   flashcard decks built from both.
   ============================================================ */

window.Vocab = (function () {
  'use strict';

  var data = null;
  var loading = null;

  var POS_LABEL = {
    noun: 'noun', verb: 'verb', adj: 'adjective', phrase: 'phrase',
    connector: 'connector', grammar: 'grammar word', number: 'number', other: 'word'
  };

  var GENDER_LABEL = { m: 'm', f: 'f', pl: 'pl', mf: 'm/f' };

  // The seven binyanim, written the way this course transliterates them.
  var BINYAN_LABEL = {
    paal: "pa'al", piel: "pi'el", hifil: "hif'il", hitpael: "hitpa'el",
    nifal: "nif'al", pual: "pu'al", hufal: "huf'al"
  };

  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = Data.json('data/vocab.json')
      .then(function (json) {
        data = json;
        data.words.forEach(index1);
        return data;
      });
    return loading;
  }

  // Searchable text for one entry. The transliteration is in there too, so
  // "shalom" finds שָׁלוֹם for anyone who cannot type Hebrew yet.
  function index1(w) {
    w.search = (w.he + ' ' + (w.tr || '') + ' ' + w.en + ' ' + w.themes.join(' ')).toLowerCase();
    w.searchPlain = strip(w.search);
    return w;
  }

  // Nikud is never part of a search: a learner types what they can see on a
  // sign, which has no points on it.
  function strip(s) {
    return Heb.plain(String(s || '')).toLowerCase();
  }

  /* ---------------------------------------------------------- my words */

  // The curated list ships with the site and never changes at runtime;
  // words you add live in the synced progress state. They are kept in two
  // places and joined here, so a rebuild of vocab.json cannot lose yours.
  var mineCache = null;
  var curatedCache = null;
  var joinedCache = null;

  function invalidate() {
    mineCache = null; curatedCache = null; joinedCache = null; indexCache = null;
  }
  window.addEventListener('progress:change', invalidate);

  function mine() {
    if (mineCache) return mineCache;
    mineCache = Progress.words().map(function (w) {
      return index1({
        n: 0, id: w.id, he: w.he, en: w.en, pos: w.pos || 'other', g: w.g || '',
        tr: w.tr || '', root: w.root || '', binyan: w.binyan || '', pl: w.pl || '',
        base: w.he, themes: w.themes.length ? w.themes : ['mine'], at: w.at, mine: true
      });
    });
    return mineCache;
  }

  // A gloss in the curated list is sometimes wrong or too narrow. Your
  // correction is stored against the shipped id, so it is laid over the
  // word here rather than replacing it: the original stays on `was`, and
  // clearing the edit brings it straight back.
  function curated() {
    if (!data) return [];
    if (curatedCache) return curatedCache;
    curatedCache = data.words.map(function (w) {
      var e = Progress.getEdit(w.id);
      if (!e) return w;
      return index1({
        n: w.n, id: w.id, he: e.he, en: e.en, pos: e.pos, g: e.g, base: e.he,
        // A correction that leaves a field empty keeps what the course
        // shipped: the point of the form is the gloss, not the grammar.
        tr: e.tr || w.tr || '', root: e.root || w.root || '',
        binyan: e.binyan || w.binyan || '', pl: e.pl || w.pl || '',
        // No themes typed means "leave it where it was filed"; for a word
        // you added the same empty box means "mine", but a curated word
        // already has a theme worth keeping.
        themes: e.themes.length ? e.themes : w.themes.slice(),
        edited: true, was: w
      });
    });
    return curatedCache;
  }

  function all() {
    if (!data) return [];
    if (!joinedCache) joinedCache = mine().concat(curated());
    return joinedCache;
  }

  function themeCounts() {
    var counts = {};
    if (data) for (var t in data.themes) counts[t] = data.themes[t];
    // The shipped tallies were counted before your edits, and an edit can
    // move a word to another theme, so the difference is applied here.
    curated().forEach(function (w) {
      if (!w.edited) return;
      w.was.themes.forEach(function (t) { counts[t] = (counts[t] || 0) - 1; });
      w.themes.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    mine().forEach(function (w) {
      w.themes.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    for (var k in counts) if (counts[k] <= 0) delete counts[k];
    return counts;
  }

  function themes() { return Object.keys(themeCounts()); }

  function byId(id) {
    var list = all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function byTheme(list) {
    var wanted = String(list || '').split(/[,\s]+/).filter(Boolean);
    if (!wanted.length) return all();
    return all().filter(function (w) {
      return w.themes.some(function (t) { return wanted.indexOf(t) !== -1; });
    });
  }

  function search(query, opts) {
    opts = opts || {};
    var words = all();
    if (opts.theme && opts.theme !== 'all') {
      words = words.filter(function (w) { return w.themes.indexOf(opts.theme) !== -1; });
    }
    if (opts.pos && opts.pos !== 'all') {
      words = words.filter(function (w) { return w.pos === opts.pos; });
    }
    if (opts.status === 'known') words = words.filter(function (w) { return Progress.isKnown(w.id); });
    if (opts.status === 'unknown') words = words.filter(function (w) { return !Progress.isKnown(w.id); });
    if (opts.status === 'mine') words = words.filter(function (w) { return w.mine; });

    var q = strip(String(query || '').trim().toLowerCase());
    if (!q) return words;
    return words.filter(function (w) { return w.searchPlain.indexOf(q) !== -1; })
      .sort(function (a, b) { return a.searchPlain.indexOf(q) - b.searchPlain.indexOf(q); });
  }

  /* ---------------------------------------------------------- rendering */

  function rowHtml(w) {
    var known = Progress.isKnown(w.id);
    return '<div class="vocab-row' + (known ? ' is-known' : '') + (w.mine ? ' is-mine' : '') +
      (w.edited ? ' is-edited' : '') + '" data-id="' + w.id + '">' +
      '<button class="v-know" aria-label="Mark as known" aria-pressed="' + known + '" ' +
        'title="' + (known ? 'Known - tap to unmark' : 'Tap when you know this word') + '">✓</button>' +
      '<span class="v-he">' +
        '<span class="v-word" lang="he" dir="rtl" data-he="' + escapeAttr(w.he) + '">' +
          escapeHtml(Heb.show(w.he)) + '</span>' +
        (w.tr ? '<small class="v-tr">' + escapeHtml(w.tr) + '</small>' : '') +
      '</span>' +
      '<span class="v-en">' + escapeHtml(w.en) + '</span>' +
      '<span class="v-tag">' + (POS_LABEL[w.pos] || w.pos) +
        (w.g ? ' · ' + GENDER_LABEL[w.g] : '') +
        (w.pos === 'verb' && w.binyan && BINYAN_LABEL[w.binyan]
          ? ' · ' + BINYAN_LABEL[w.binyan] : '') +
      '</span>' +
      // Its own cell rather than part of the tag, because the tag is the
      // one thing a narrow screen drops and this has to survive that.
      '<button class="v-edit" data-edit="' + w.id + '" ' +
        'title="' + (w.edited ? 'You corrected this one' : 'Correct this entry') + '">' +
        (w.edited ? 'edited' : 'edit') + '</button>' +
      '</div>';
  }

  function listHtml(words) {
    if (!words.length) {
      return '<div class="empty"><div class="empty-icon">🔍</div><p>No words match that.</p></div>';
    }
    return '<div class="vocab-list">' + words.map(rowHtml).join('') + '</div>';
  }

  // One delegated handler covers every list on the page. An embed is
  // refilled in place after an edit, so binding is once per container,
  // not once per fill, or the second tap would fire twice.
  function bindList(root) {
    if (root.dataset.vbound) return;
    root.dataset.vbound = '1';
    root.addEventListener('click', function (e) {
      var edit = e.target.closest('.v-edit');
      if (edit) {
        root.dispatchEvent(new CustomEvent('vocab:edit', {
          bubbles: true, detail: { id: edit.dataset.edit }
        }));
        return;
      }
      var btn = e.target.closest('.v-know');
      if (!btn) return;
      var row = btn.closest('.vocab-row');
      var on = Progress.toggleKnown(row.dataset.id);
      row.classList.toggle('is-known', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('title', on ? 'Known - tap to unmark' : 'Tap when you know this word');
    });
  }

  /* ---------------------------------------------------------- adding words */

  /* Fills in what can be read off the Hebrew, so adding a word from the
     phone is two fields and a tap rather than a form.

     Hebrew has no article to read a gender from, so this leans on the
     endings instead, and on the English when there is any: a gloss that
     starts with "to " settles a verb better than any Hebrew ending can.
     Every call is a guess the form then lets you override. */
  function guess(he, en) {
    var s = Heb.plain(he);
    var gloss = String(en || '').trim().toLowerCase();
    var words = s ? s.split(/\s+/) : [];
    var out = { pos: 'other', g: '' };
    if (!s) return out;

    // "יָפֶה / יָפָה": the masculine and feminine of one adjective, written
    // with spaces around the slash. Read before anything else, because the
    // two halves would otherwise be counted as two words.
    if (/^[^\s/]+\s*\/\s*[^\s/]+$/.test(String(he).trim())) return { pos: 'adj', g: '' };

    // An infinitive starts with ל and the English says so.
    if (/^ל/.test(s) && words.length === 1 && s.length >= 4) {
      if (!gloss || /^to\s/.test(gloss)) return { pos: 'verb', g: '' };
    }
    if (/^to\s/.test(gloss)) return { pos: 'verb', g: '' };

    if (words.length > 2) return { pos: 'phrase', g: '' };
    if (words.length === 2) return { pos: 'phrase', g: '' };

    // One word, so the ending is all there is to go on.
    out.pos = 'noun';
    if (/(ים|ות)$/.test(s)) out.g = 'pl';
    else if (/[הת]$/.test(s)) out.g = 'f';
    else out.g = 'm';
    return out;
  }

  /* -------------------------------------------------- already have it? */

  // Same shape of key as Progress uses for its own duplicate check: the
  // points, a definite ה and the shape of a final letter are not what makes
  // a word a different word, so "הַבַּיִת" finds "בַּיִת".
  function key(he) {
    var k = Heb.plain(he);
    // Only when something is left worth matching: dropping the ה of הר
    // would leave one letter and match half the dictionary.
    if (/^ה/.test(k) && k.replace(/^ה/, '').length >= 3) k = k.replace(/^ה/, '');
    return Heb.unfinal(k).replace(/\s+/g, ' ').trim();
  }

  var indexCache = null;

  function index() {
    if (indexCache) return indexCache;
    indexCache = {};
    // Yours go in last so an entry you edited is the one you are shown.
    all().slice().reverse().forEach(function (w) {
      var k = key(w.he);
      if (k) indexCache[k] = w;
    });
    return indexCache;
  }

  // The whole point of the quick add: say so before a word is added twice,
  // whether the match is in the curated list or in your own.
  function findExisting(he) {
    var k = key(he);
    return k ? index()[k] || null : null;
  }

  /* Accepts three shapes, because a word list copied off a phone is never
     in one of them: "hebrew - english", "hebrew = english", and the pipe
     format of data/vocab-source.txt, where the middle field is the
     transliteration. A leading number is ignored either way. */
  function parseBulk(text) {
    var rows = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === '#') return;
      line = line.replace(/^\d+[.)]\s*/, '');

      var he = '', tr = '', en = '';
      if (line.indexOf('|') !== -1) {
        var cells = line.split('|').map(function (c) { return c.trim(); });
        he = cells[0] || '';
        // Three or more fields: the middle one is the transliteration.
        if (cells.length >= 3) { tr = cells[1] || ''; en = cells[2] || ''; }
        else { en = cells[1] || ''; }
      } else {
        var m = line.split(/\s+[-–-]\s+|\s*[=:]\s*|\t+/);
        if (m.length < 2) return;
        he = m[0].trim();
        en = m.slice(1).join(' - ').trim();
      }
      if (!he || !en || !Heb.hasHebrew(he)) return;
      var g = guess(he, en);
      rows.push({ he: he, tr: tr, en: en, pos: g.pos, g: g.g, themes: [] });
    });
    return rows;
  }

  // The reverse: the exact line format vocab-source.txt expects, so a word
  // can graduate from personal to curated by pasting and rebuilding.
  function exportMine() {
    var start = data ? data.source_count + 1 : 1;
    return mine().slice().reverse().map(function (w, i) {
      var extra = [];
      if (w.root) extra.push('root=' + w.root);
      if (w.binyan) extra.push('binyan=' + w.binyan);
      if (w.pl) extra.push('pl=' + w.pl);
      return [(start + i) + '.', w.he, w.tr || '', w.en,
              w.pos + (w.g ? '.' + w.g : ''), w.themes.join(','), extra.join(';')
             ].join(' | ');
    }).join('\n');
  }

  // Fill one ::: vocab block. Separate from the sweep below so a block can
  // be redrawn after you correct a word in it, without touching the rest
  // of the lesson.
  function fillEmbed(el) {
    var words = byTheme(el.dataset.themes);
    el.innerHTML =
      '<h4>' + escapeHtml(el.dataset.themes.replace(/,/g, ' \u00b7 ')) + ' \u00b7 ' + words.length + ' words</h4>' +
      listHtml(words);
    bindList(el);
  }

  // Fill any ::: vocab blocks that the markdown renderer left behind.
  function hydrateEmbeds(root) {
    var embeds = root.querySelectorAll('.vocab-embed');
    if (!embeds.length) return Promise.resolve();
    return load().then(function () { embeds.forEach(fillEmbed); });
  }

  /* ---------------------------------------------------------- decks */

  // A deck is a themed slice of the vocabulary in one direction.
  function deck(id, name, words, dir) {
    return {
      id: id, name: name, dir: dir, size: words.length,
      cards: words.map(function (w) {
        return {
          id: w.id + ':' + dir,
          // The card id carries the direction; the known flag is per word,
          // so it needs the bare id too.
          wordId: w.id,
          front: dir === 'he-en' ? w.he : w.en,
          back: dir === 'he-en' ? w.en : w.he,
          he: w.he,
          tr: w.tr || '',
          // Reading the Hebrew aloud before an EN to HE card is flipped
          // would hand over the answer, so the button waits for the flip.
          heOnFront: dir === 'he-en',
          tag: w.themes[0] === 'general' ? (POS_LABEL[w.pos] || '') : w.themes[0]
        };
      })
    };
  }

  // A word you have ticked as known is done with: it leaves the decks
  // rather than coming round again. Untick it and it comes back, with its
  // old box and schedule intact, because nothing about the card is deleted.
  function unknown(list) {
    return list.filter(function (w) { return !Progress.isKnown(w.id); });
  }

  function decks() {
    var out = [];
    if (unknown(mine()).length) {
      out.push(deck('mine-he', 'My words (HE \u2192 EN)', unknown(mine()), 'he-en'));
      out.push(deck('mine-en', 'My words (EN \u2192 HE)', unknown(mine()), 'en-he'));
    }
    themes().forEach(function (t) {
      if (t === 'general') return;
      var words = unknown(byTheme(t));
      if (!words.length) return;
      out.push(deck('theme-' + t + '-he', capitalise(t), words, 'he-en'));
    });
    out.push(deck('all-he', 'Everything (HE \u2192 EN)', unknown(all()), 'he-en'));
    out.push(deck('all-en', 'Everything (EN \u2192 HE)', unknown(all()), 'en-he'));
    var verbs = unknown(all()).filter(function (w) { return w.pos === 'verb'; });
    out.push(deck('verbs-he', 'Verbs', verbs, 'he-en'));
    // One deck per binyan, once there are enough verbs in it to be a
    // session rather than a handful of cards.
    Object.keys(BINYAN_LABEL).forEach(function (b) {
      var inB = verbs.filter(function (w) { return w.binyan === b; });
      if (inB.length < 8) return;
      out.push(deck('verbs-binyan-' + b, 'Verbs: ' + BINYAN_LABEL[b], inB, 'he-en'));
    });
    var nouns = unknown(all()).filter(function (w) { return w.pos === 'noun' && w.g; });
    out.push(deck('gender', 'Noun genders', nouns, 'he-en'));
    return out;
  }

  function deckById(id) {
    var found = null;
    decks().forEach(function (d) { if (d.id === id) found = d; });
    return found;
  }

  /* ---------------------------------------------------------- helpers */

  function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------ the dictionary form

     A word tapped on a page is the word as it stands in the sentence: בַּבַּיִת,
     וּלְיַלְדָּה, הַשֻּׁלְחָן. The list wants בַּיִת. This peels off the one-letter
     prepositions, the conjunction and the article, at most two of them, and
     only where the points say it really is a prefix: a bare letter proves
     nothing, since לַיְלָה and בְּרָכָה begin with the same letters. Without
     the points there is no evidence, so an unpointed word is left alone.
     It will still be wrong now and then (לְבַד), which is why the quick add
     shows what was dropped and offers it back. */

  var SHVA = '\u05b0', HIRIQ = '\u05b4', TSERE = '\u05b5', SEGOL = '\u05b6',
      PATAH = '\u05b7', QAMATS = '\u05b8', DAGESH = '\u05bc',
      HATAF_PATAH = '\u05b2';
  var GUTTURAL = /[\u05d0\u05d4\u05d7\u05e2\u05e8]/;
  var PREFIX_EN = { '\u05d1': 'in', '\u05dc': 'to', '\u05db': 'like', '\u05de': 'from',
                    '\u05d5': 'and', '\u05d4': 'the', '\u05e9': 'that' };

  function clusters(s) { return s.match(/[\u05d0-\u05ea][\u0591-\u05c7]*/g) || []; }

  // Whether the first cluster of cs is a prefix, and if so whether it
  // carried the article too. after is the prefix already taken off, if any:
  // ו and ש take another in front of anything, a preposition only takes the
  // article (מֵהָעִיר), and nothing takes a third.
  function prefixAt(cs, after) {
    if (cs.length < 2) return null;
    var letter = cs[0].charAt(0), marks = cs[0].slice(1);
    if (after && after !== '\u05d5' && after !== '\u05e9' && letter !== '\u05d4') return null;
    var first = !after;
    var next = cs[1], lead = next.charAt(0);
    var dag = next.indexOf(DAGESH) !== -1 && lead !== '\u05d5';
    var gut = GUTTURAL.test(lead);
    var has = function (m) { return marks.indexOf(m) !== -1; };
    // The vowel the article leaves on its host: patah and a doubled letter,
    // patah before ה and ח, which cannot double, qamats before א ע ר.
    // A patah before א, as in הַאִם, is something else.
    var art = (has(PATAH) && (dag || /[\u05d4\u05d7]/.test(lead))) || (has(QAMATS) && gut);
    var yes = function (article, doubles) { return { article: article, doubles: doubles }; };

    // ב כ ל
    if (letter === '\u05d1' || letter === '\u05db' || letter === '\u05dc') {
      if (letter === '\u05dc') {
        // לְהַגִּיד, לְהִתְרַחֵץ: an infinitive, whose ל belongs to the verb. A
        // preposition before the article merges into לַ, never לְהַ.
        if (lead === '\u05d4') return null;
        // לְדַבֵּר, לְנַסּוֹת: the piel infinitive, a patah and then a doubled
        // letter. It costs לְמַטָּה, which is the rarer of the two.
        if (has(SHVA) && next.indexOf(PATAH) !== -1 && cs[2] &&
            cs[2].indexOf(DAGESH) !== -1) return null;
        // לַעֲשׂוֹת, לַחֲשׁוֹב: the infinitive of a guttural verb.
        if (has(PATAH) && next.indexOf(HATAF_PATAH) !== -1) return null;
      }
      // כְּ is left alone: כְּלוּם, כְּדַאי, כְּחוּלָּה begin with it far more
      // often than a "like" does.
      if (has(SHVA)) return letter === '\u05db' ? null : yes(false, false);
      return art ? yes(true, true) : null;
    }
    // ו, only first: וְ or the shuruk וּ
    if (letter === '\u05d5' && first) {
      return has(SHVA) || marks === DAGESH ? yes(false, false) : null;
    }
    // ה, with the vowels above, or segol before a guttural carrying qamats
    if (letter === '\u05d4') {
      return art || (has(SEGOL) && /[\u05d4\u05d7\u05e2]/.test(lead)) ? yes(true, true) : null;
    }
    // מ: מִ with the doubled letter, מֵ before a guttural
    if (letter === '\u05de') {
      if (has(HIRIQ) && dag) return yes(false, true);
      return has(TSERE) && gut ? yes(false, false) : null;
    }
    // ש, only first: שֶׁ with the doubled letter
    if (letter === '\u05e9' && first) {
      return has(SEGOL) && dag ? yes(false, true) : null;
    }
    return null;
  }

  // { he, full, dropped }: he is the word less its prefixes, full the word as
  // it was on the page, dropped the English of whatever came off.
  function unprefix(word) {
    // Punctuation off both ends; the points after the last letter stay.
    var full = String(word == null ? '' : word).normalize('NFC').trim()
      .replace(/^[^\u05d0-\u05ea]+/, '').replace(/[^\u05d0-\u05ea\u0591-\u05c7]+$/, '');
    var out = { he: full, full: full, dropped: [] };
    if (!full || /\s/.test(full)) return out;

    // A preposition joined by a maqaf is a word of its own: עַל־יַד, אֶל־הַבַּיִת.
    var parts = full.split('\u05be');
    var last = parts[parts.length - 1];
    var cs = clusters(last);
    if (!cs.length || cs.join('') !== last) return out;   // something odd inside

    var doubled = false, after = '';
    for (var n = 0; n < 2; n++) {
      var p = prefixAt(cs, after);
      // What is left has to be a word: three letters, or two after an
      // article, which is strong evidence on its own (הַיָּם, הַיּוֹם).
      if (!p || cs.length - 1 < (p.article ? 2 : 3)) break;
      out.dropped.push(PREFIX_EN[cs[0].charAt(0)]);
      if (p.article && cs[0].charAt(0) !== '\u05d4') out.dropped.push('the');
      doubled = p.doubles;
      after = cs[0].charAt(0);
      cs = cs.slice(1);
    }
    if (!out.dropped.length && parts.length === 1) return out;

    // The dagesh the prefix put in the next letter is not part of the word,
    // except in ב ג ד כ פ ת, which begin a word with one anyway.
    // And the other way round: after a vowel those six lose the dagesh they
    // take at the start of a word (בְּבַקָּשָׁה), so it goes back.
    var bgdkpt = /[\u05d1\u05d2\u05d3\u05db\u05e4\u05ea]/.test(cs[0].charAt(0));
    if (doubled && !bgdkpt) cs[0] = cs[0].replace(DAGESH, '');
    if (bgdkpt && cs[0].indexOf(DAGESH) === -1) {
      cs[0] = (cs[0].charAt(0) + DAGESH + cs[0].slice(1)).normalize('NFC');
    }
    if (parts.length > 1) out.dropped.unshift(Heb.strip(parts.slice(0, -1).join(' ')));
    out.he = cs.join('');
    return out;
  }

  /* ------------------------------------------------ verbs and plurals

     Past the prefixes, a word on the page is still often not the word in
     the list: a verb is conjugated, a noun is plural. The list keeps verbs
     as the infinitive and nouns as the singular, so this takes them back,
     reading the pattern off the points. Only regular patterns are known,
     and only where the evidence is good:

     - A present-tense form (כּוֹתֵב, מְדַבֶּרֶת, מַסְבִּירִים) looks exactly
       like a noun (שׁוֹמֵר, מְנַהֵל, מַדְרִיךְ), so it is only read as a verb
       after a pronoun or לֹא. The hitpael (מִתְלַבֵּשׁ) is the exception: it
       is a verb nearly every time.
     - A past form with a person ending (כָּתַבְתִּי, דִּיבַּרְנוּ, הִסְבַּרְתֶּם)
       is a verb whatever is in front of it. Without the ending it is left
       to the context too.
     - A plural is only made singular when its points say it is one: ִים,
       or וֹת with a holam, since וּת with a shuruk is the singular of חֲנוּת.

     The infinitive is built with its points for a regular root. A root with
     a guttural or a weak letter changes its vowels in ways a rule this size
     would get wrong, so it is written without them, and so is every
     singular, whose vowels usually differ from the plural's. Either way,
     where the list already has the word, the list's own spelling is used. */

  var HOLAM = '\u05b9', SHIN_DOT = '\u05c1', SIN_DOT = '\u05c2';
  var PRONOUN = ['\u05d0\u05e0\u05d9', '\u05d0\u05ea\u05d4', '\u05d0\u05ea', '\u05d4\u05d5\u05d0',
    '\u05d4\u05d9\u05d0', '\u05d0\u05e0\u05d7\u05e0\u05d5', '\u05d0\u05ea\u05dd', '\u05d0\u05ea\u05df',
    '\u05d4\u05dd', '\u05d4\u05df', '\u05dc\u05d0'];
  var PERSON = ['\u05ea\u05d9', '\u05ea', '\u05e0\u05d5', '\u05ea\u05dd', '\u05ea\u05df'];
  var PAST_TAIL = [''].concat(PERSON, ['\u05d5', '\u05d4']);
  var PRESENT_TAIL = ['', '\u05ea', '\u05d9\u05dd', '\u05d5\u05ea'];

  function dg(letter) { return /[\u05d1\u05d2\u05d3\u05db\u05e4\u05ea]/.test(letter) ? DAGESH : ''; }

  // A root letter as it will be written: the letter, and its dot if it is
  // a shin or a sin, which the root has to carry over from the page.
  function rootLetter(c) {
    var l = Heb.unfinal(c.charAt(0));
    if (l === '\u05e9') l += c.indexOf(SIN_DOT) !== -1 ? SIN_DOT : SHIN_DOT;
    return l;
  }

  // The root and pattern of a conjugated verb, or null. sure says whether
  // the form alone proves it is a verb, which a person ending does.
  function verbOf(cs, verbCtx) {
    var L = cs.map(function (c) { return c.charAt(0); });
    var V = cs.map(function (c) { return c.slice(1); });
    var n = L.length;
    var has = function (i, m) { return i < n && V[i].indexOf(m) !== -1; };
    var tail = function (from) { return L.slice(from).join(''); };
    var root = function (a, b, c) { return [rootLetter(cs[a]), rootLetter(cs[b]), rootLetter(cs[c])]; };
    // No root ends in ו in these patterns: אוֹתוֹ is a pronoun, not a verb.
    var hit = function (r, binyan, sure) {
      if (r[2] === '\u05d5') return null;
      return (sure || verbCtx) ? { root: r, binyan: binyan } : null;
    };
    var t;

    // Present.
    if (n >= 4 && L[1] === '\u05d5' && has(1, HOLAM) && PRESENT_TAIL.indexOf(t = tail(4)) !== -1) {
      return hit(root(0, 2, 3), 'paal', false);
    }
    if (n >= 4 && L[0] === '\u05de' && has(0, SHVA) && has(1, PATAH) &&
        (has(2, DAGESH) || /[\u05d0\u05d4\u05d7\u05e2\u05e8]/.test(L[2])) &&
        PRESENT_TAIL.indexOf(tail(4)) !== -1) {
      return hit(root(1, 2, 3), 'piel', false);
    }
    if (n >= 5 && L[0] === '\u05de' && has(0, PATAH) && has(1, SHVA) && L[3] === '\u05d9' &&
        ['', '\u05d4', '\u05d9\u05dd', '\u05d5\u05ea'].indexOf(tail(5)) !== -1) {
      return hit(root(1, 2, 4), 'hifil', false);
    }
    if (n >= 5 && L[0] === '\u05de' && has(0, HIRIQ) && L[1] === '\u05ea' && has(1, SHVA) &&
        PRESENT_TAIL.indexOf(tail(5)) !== -1) {
      return hit(root(2, 3, 4), 'hitpael', true);
    }
    // מִשְׁתַּמֵּשׁ: the ת of hitpael swaps places with a first ש or ס.
    if (n >= 5 && L[0] === '\u05de' && has(0, HIRIQ) && /[\u05e9\u05e1]/.test(L[1]) && L[2] === '\u05ea' &&
        PRESENT_TAIL.indexOf(tail(5)) !== -1) {
      return hit(root(1, 3, 4), 'hitpael', true);
    }

    // Past. A person ending proves it; the bare form needs the context.
    if (n >= 5 && L[0] === '\u05d4' && has(0, HIRIQ) && L[1] === '\u05ea' && has(1, SHVA) &&
        PAST_TAIL.indexOf(t = tail(5)) !== -1) {
      return hit(root(2, 3, 4), 'hitpael', PERSON.indexOf(t) !== -1 || t === '');
    }
    if (n >= 5 && L[0] === '\u05d4' && has(0, HIRIQ) && /[\u05e9\u05e1]/.test(L[1]) && L[2] === '\u05ea' &&
        PAST_TAIL.indexOf(t = tail(5)) !== -1) {
      return hit(root(1, 3, 4), 'hitpael', true);
    }
    if (n >= 4 && L[0] === '\u05d4' && has(0, HIRIQ) && has(1, SHVA)) {
      // הִסְבִּיר keeps its י, הִסְבַּרְתִּי loses it.
      if (L[3] === '\u05d9' && n >= 5 && PAST_TAIL.indexOf(t = tail(5)) !== -1) {
        return hit(root(1, 2, 4), 'hifil', true);
      }
      if (PERSON.indexOf(t = tail(4)) !== -1 && has(3, SHVA)) return hit(root(1, 2, 3), 'hifil', true);
    }
    if (n >= 4 && has(0, HIRIQ) && L[1] === '\u05d9' && (has(2, DAGESH) || /[\u05d0\u05d4\u05d7\u05e2\u05e8]/.test(L[2])) &&
        PAST_TAIL.indexOf(t = tail(4)) !== -1) {
      return hit(root(0, 2, 3), 'piel', PERSON.indexOf(t) !== -1 && has(3, SHVA));
    }
    if (n >= 3 && has(0, QAMATS) && PAST_TAIL.indexOf(t = tail(3)) !== -1) {
      var person = PERSON.indexOf(t) !== -1 && has(2, SHVA) && has(1, PATAH);
      if (t === '' && !has(1, PATAH)) return null;
      return hit(root(0, 1, 2), 'paal', person);
    }

    // Future of paal: אֶכְתּוֹב, תִּכְתְּבִי. א and נ in front prove it.
    if (n >= 5 && /[\u05d0\u05ea\u05d9\u05e0]/.test(L[0]) && (has(0, HIRIQ) || has(0, SEGOL)) &&
        has(1, SHVA) && L[3] === '\u05d5' && has(3, HOLAM) &&
        ['', '\u05d9', '\u05d5', '\u05e0\u05d4'].indexOf(tail(5)) !== -1) {
      return hit(root(1, 2, 4), 'paal', /[\u05d0\u05e0]/.test(L[0]));
    }
    // תִּלְבְּשִׁי, יִכְתְּבוּ: the holam goes when an ending comes on.
    if (n === 5 && /[\u05ea\u05d9]/.test(L[0]) && has(0, HIRIQ) && has(1, SHVA) && has(2, SHVA) &&
        /[\u05d5\u05d9]/.test(L[4])) {
      return hit(root(1, 2, 3), 'paal', false);
    }
    return null;
  }

  // The infinitive of a root in a binyan, with its points where the root
  // is regular and without them where it is not.
  function infinitiveOf(r, binyan) {
    var a = r[0], b = r[1], c = r[2];
    var la = a.charAt(0), lb = b.charAt(0), lc = c.charAt(0);
    var fin = function (x) { return (Heb.TO_FINAL[x.charAt(0)] || x.charAt(0)) + x.slice(1); };
    var weak = /[\u05d0\u05d4\u05d7\u05e2]/.test(la + lb + lc) || /[\u05d9\u05e0\u05d5]/.test(la) ||
      /[\u05d5\u05d9]/.test(lb) || lc === '\u05d4';
    var sibilant = binyan === 'hitpael' && /[\u05e9\u05e1]/.test(la);
    if (binyan === 'piel' && lb === '\u05e8') weak = true;
    if (binyan === 'hitpael' && lb === '\u05e8') weak = true;
    var s;
    if (weak) {
      var p = function (x) { return x.charAt(0); };
      // עוֹלֶה, קוֹנָה: a root ending in ה takes ות in every binyan.
      if (lc === '\u05d4') {
        return (binyan === 'paal' || binyan === 'piel' ? '\u05dc' : binyan === 'hifil' ? '\u05dc\u05d4' : '\u05dc\u05d4\u05ea') +
          p(a) + p(b) + '\u05d5\u05ea';
      }
      // יוֹרֵד, יָשַׁב: a first י falls away and a ת comes on the end.
      if (la === '\u05d9' && binyan === 'paal') return '\u05dc' + p(b) + p(c) + '\u05ea';
      s = binyan === 'paal' ? '\u05dc' + p(a) + p(b) + '\u05d5' + fin(p(c))
        : binyan === 'piel' ? '\u05dc' + p(a) + p(b) + fin(p(c))
        : binyan === 'hifil' ? '\u05dc\u05d4' + p(a) + p(b) + '\u05d9' + fin(p(c))
        : '\u05dc\u05d4\u05ea' + p(a) + p(b) + fin(p(c));
      return s;
    }
    if (binyan === 'paal') {
      s = '\u05dc' + HIRIQ + a + SHVA + b + dg(lb) + '\u05d5' + HOLAM + fin(c);
    } else if (binyan === 'piel') {
      s = '\u05dc' + SHVA + a + PATAH + b + DAGESH + TSERE + fin(c);
    } else if (binyan === 'hifil') {
      s = '\u05dc' + SHVA + '\u05d4' + PATAH + a + SHVA + b + dg(lb) + HIRIQ + '\u05d9' + fin(c);
    } else if (sibilant) {
      s = '\u05dc' + SHVA + '\u05d4' + HIRIQ + a + SHVA + '\u05ea' + DAGESH + PATAH + b + DAGESH + TSERE + fin(c);
    } else {
      s = '\u05dc' + SHVA + '\u05d4' + HIRIQ + '\u05ea' + SHVA + a + dg(la) + PATAH + b + DAGESH + TSERE + fin(c);
    }
    return s.normalize('NFC');
  }

  // A verb of that root and binyan already in the list, whatever the
  // spelling the rule above would have produced.
  function listVerb(r, binyan) {
    var want = r.map(function (x) { return x.charAt(0); }).join('');
    var words = all();
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.pos !== 'verb' || !w.root || (w.binyan && w.binyan !== binyan)) continue;
      if (Heb.unfinal(Heb.plain(w.root).replace(/[^\u05d0-\u05ea]/g, '')) === want) return w;
    }
    return null;
  }

  // The plurals no ending rule reaches, for when the list does not carry
  // them itself.
  var IRREGULAR_PL = {
    '\u05d1\u05ea\u05d9\u05dd': '\u05d1\u05d9\u05ea', '\u05d0\u05e0\u05e9\u05d9\u05dd': '\u05d0\u05d9\u05e9', '\u05e0\u05e9\u05d9\u05dd': '\u05d0\u05d9\u05e9\u05d4', '\u05d9\u05de\u05d9\u05dd': '\u05d9\u05d5\u05dd', '\u05e2\u05e8\u05d9\u05dd': '\u05e2\u05d9\u05e8',
    '\u05d1\u05e0\u05d9\u05dd': '\u05d1\u05df', '\u05d1\u05e0\u05d5\u05ea': '\u05d1\u05ea', '\u05d0\u05d7\u05d9\u05dd': '\u05d0\u05d7', '\u05d0\u05d7\u05d9\u05d5\u05ea': '\u05d0\u05d7\u05d5\u05ea', '\u05e9\u05e0\u05d9\u05dd': '\u05e9\u05e0\u05d4',
    '\u05e8\u05d0\u05e9\u05d9\u05dd': '\u05e8\u05d0\u05e9', '\u05e2\u05e6\u05d9\u05dd': '\u05e2\u05e5', '\u05dc\u05d9\u05dc\u05d5\u05ea': '\u05dc\u05d9\u05dc\u05d4', '\u05de\u05e7\u05d5\u05de\u05d5\u05ea': '\u05de\u05e7\u05d5\u05dd', '\u05e9\u05d5\u05dc\u05d7\u05e0\u05d5\u05ea': '\u05e9\u05d5\u05dc\u05d7\u05df',
    '\u05d7\u05dc\u05d5\u05de\u05d5\u05ea': '\u05d7\u05dc\u05d5\u05dd', '\u05e7\u05d5\u05dc\u05d5\u05ea': '\u05e7\u05d5\u05dc', '\u05d0\u05d1\u05d5\u05ea': '\u05d0\u05d1', '\u05e9\u05de\u05d5\u05ea': '\u05e9\u05dd', '\u05db\u05d5\u05e1\u05d5\u05ea': '\u05db\u05d5\u05e1'
  };

  var NOT_PLURAL = ['\u05e2\u05e9\u05e8\u05d9\u05dd', '\u05e9\u05dc\u05d5\u05e9\u05d9\u05dd', '\u05d0\u05e8\u05d1\u05e2\u05d9\u05dd', '\u05d7\u05de\u05d9\u05e9\u05d9\u05dd', '\u05e9\u05d9\u05e9\u05d9\u05dd', '\u05e9\u05d1\u05e2\u05d9\u05dd', '\u05e9\u05de\u05d5\u05e0\u05d9\u05dd',
    '\u05ea\u05e9\u05e2\u05d9\u05dd', '\u05de\u05d9\u05dd', '\u05d7\u05d9\u05d9\u05dd', '\u05e9\u05de\u05d9\u05d9\u05dd', '\u05e4\u05e0\u05d9\u05dd', '\u05d9\u05e8\u05d5\u05e9\u05dc\u05d9\u05dd', '\u05de\u05e6\u05e8\u05d9\u05dd', '\u05e8\u05d7\u05de\u05d9\u05dd', '\u05e0\u05e2\u05d9\u05dd'];

  // The singular of a plural, or null when the points do not say plural.
  function singularOf(cs) {
    var n = cs.length;
    if (n < 3) return null;
    var P = cs.map(function (c) { return c.charAt(0); }).join('');
    // The list's own plural first: it knows בָּתִּים is בַּיִת.
    var words = all();
    for (var w = 0; w < words.length; w++) {
      if (words[w].pl && Heb.plain(words[w].pl) === P) return words[w].he;
    }
    if (IRREGULAR_PL[P]) {
      var known = findExisting(IRREGULAR_PL[P]);
      return known ? known.he : IRREGULAR_PL[P];
    }
    if (n < 4) return null;
    // לִקְנוֹת, לְחַקּוֹת, לִרְאוֹת: an infinitive, whose וֹת is not a plural.
    if (P.charAt(0) === '\u05dc' && /\u05d5\u05b9\u05ea$/.test(cs.slice(-2).join('')) && n <= 6 &&
        /[\u05b0\u05b4\u05b7]/.test(cs[0])) return null;
    var end = P.slice(-2), stem = Heb.unfinal(P.slice(0, -2));
    var fin = function (x) { return x.slice(0, -1) + (Heb.TO_FINAL[x.slice(-1)] || x.slice(-1)); };
    var cands;
    if (end === '\u05d9\u05dd' && (cs[n - 3].indexOf(HIRIQ) !== -1 || cs[n - 2].indexOf(HIRIQ) !== -1)) {
      // שָׁמַיִם, עֵינַיִים: a dual, which is not a plural of anything, in
      // either spelling.
      if (cs[n - 2].indexOf(HIRIQ) !== -1) return null;
      if (cs[n - 3].charAt(0) === '\u05d9' && cs[n - 3].indexOf(HIRIQ) !== -1 && cs[n - 4] &&
          cs[n - 4].indexOf(PATAH) !== -1) return null;
      cands = [fin(stem), stem + '\u05d4'];
    } else if (end === '\u05d5\u05ea' && cs[n - 2].indexOf(HOLAM) !== -1) {
      cands = /\u05d9$/.test(stem) ? [stem + '\u05ea', stem + '\u05d4', fin(stem)]
        : [stem + '\u05d4', fin(stem), stem + '\u05ea'];
    } else {
      return null;
    }
    for (var i = 0; i < cands.length; i++) {
      var hit = findExisting(cands[i]);
      if (hit) return hit.he;
    }
    // Unconfirmed, a two-letter stem is more often a word that only looks
    // plural (נָעִים, pleasant), and the tens are numbers, not plurals.
    if (stem.length < 3 || NOT_PLURAL.indexOf(P) !== -1) return null;
    return cands[0];
  }

  // The word in front, as plain letters, if it is in the same sentence.
  function prevWord(ctx) {
    if (ctx.prev !== undefined) return Heb.plain(ctx.prev);
    var ws = String(ctx.before || '').trim().split(/\s+/);
    var last = ws[ws.length - 1] || '';
    if (/[.!?:;]$/.test(last)) return '';
    return Heb.plain(last).replace(/[^\u05d0-\u05ea]/g, '');
  }

  // { he, full, dropped, change }: he is what should go in the list, full
  // the word as it was on the page, dropped the English of whatever came
  // off, change 'infinitive' or 'singular' if it was taken back to one.
  // ctx is optional: { prev } or { before: 'the text in front' }.
  function baseForm(word, ctx) {
    ctx = ctx || {};
    var text = String(word == null ? '' : word).normalize('NFC').trim();
    var toks = text.split(/\s+/);
    // "הוּא כּוֹתֵב" selected together: the pronoun is the context.
    if (toks.length === 2) {
      var lead = Heb.plain(toks[0]).replace(/^\u05d5(?=..)/, '');
      if (PRONOUN.indexOf(lead) !== -1) {
        var inner = baseForm(toks[1], { prev: toks[0] });
        inner.full = text;
        return inner;
      }
    }
    var out = unprefix(text);
    out.change = '';
    if (!out.he || /\s/.test(out.he) || findExisting(out.he)) return out;

    var prev = prevWord(ctx).replace(/^\u05d5(?=..)/, '');
    var verbCtx = PRONOUN.indexOf(prev) !== -1;
    // אֶת with a segol is the object marker, not אַתְּ, you.
    if (prev === '\u05d0\u05ea' && /\u05b6/.test(String(ctx.prev !== undefined ? ctx.prev : ctx.before || '').slice(-4))) {
      verbCtx = false;
    }
    var got = analyse(clusters(out.he), verbCtx);
    // מִלִּים is not "from" and לִים: when the word read whole gives something
    // the list has and the word less its prefix does not, the prefix was
    // part of the word.
    if (out.dropped.length && !(got && findExisting(got.he))) {
      var whole = clusters(out.full.split('\u05be').pop());
      var alt = analyse(whole, verbCtx);
      if (alt && findExisting(alt.he)) { got = alt; out.dropped = []; }
    }
    // No pronoun in front, as with a name or a verb opening the line: read it
    // as a verb anyway, but only when the list has the infinitive that gives.
    // Not after "the": הַשִּׂיחָה is a conversation, not a form of לִשְׂחוֹת.
    if (!verbCtx && out.dropped.indexOf('the') === -1 && !(got && findExisting(got.he))) {
      var asVerb = analyse(clusters(out.he), true);
      if (asVerb && asVerb.change === 'infinitive' && findExisting(asVerb.he)) got = asVerb;
    }
    if (got) { out.he = got.he; out.change = got.change; }
    return out;
  }

  function analyse(cs, verbCtx) {
    var verb = verbOf(cs, verbCtx);
    if (verb) {
      var known = listVerb(verb.root, verb.binyan);
      return { he: known ? known.he : infinitiveOf(verb.root, verb.binyan), change: 'infinitive' };
    }
    var one = singularOf(cs);
    return one ? { he: one, change: 'singular' } : null;
  }

  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  return {
    load: load, all: all, mine: mine, curated: curated,
    themes: themes, themeCounts: themeCounts,
    byTheme: byTheme, byId: byId, search: search,
    listHtml: listHtml, bindList: bindList,
    hydrateEmbeds: hydrateEmbeds, fillEmbed: fillEmbed,
    decks: decks, deckById: deckById,
    guess: guess, findExisting: findExisting, baseForm: baseForm, parseBulk: parseBulk, exportMine: exportMine,
    POS_LABEL: POS_LABEL, GENDER_LABEL: GENDER_LABEL, BINYAN_LABEL: BINYAN_LABEL
  };
})();
