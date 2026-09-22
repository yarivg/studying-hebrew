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
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  return {
    load: load, all: all, mine: mine, curated: curated,
    themes: themes, themeCounts: themeCounts,
    byTheme: byTheme, byId: byId, search: search,
    listHtml: listHtml, bindList: bindList,
    hydrateEmbeds: hydrateEmbeds, fillEmbed: fillEmbed,
    decks: decks, deckById: deckById,
    guess: guess, findExisting: findExisting, parseBulk: parseBulk, exportMine: exportMine,
    POS_LABEL: POS_LABEL, GENDER_LABEL: GENDER_LABEL, BINYAN_LABEL: BINYAN_LABEL
  };
})();
