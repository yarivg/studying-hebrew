/* ============================================================
   md.js - a small Markdown renderer for HaMachberet.

   Supports the subset the lessons actually use: headings, GFM
   tables, lists, blockquotes, fenced code, hr, inline emphasis,
   plus four custom block types:

     ::: tip | warning | rule | sound | note   -> callouts
     ::: examples                              -> he || en pairs
     ::: exercise Title                        -> self-graded cards
     ::: vocab theme1,theme2                   -> table from vocab.json

   On top of that it does one thing no Markdown renderer does: it
   finds the Hebrew inside a line of English and wraps it in its own
   right-to-left span, so a lesson is written as plain text and still
   renders with the two directions kept apart. That span is also
   where the nikud toggle and the speech buttons attach.

   Only content authored in this repo is rendered, so the parser
   trades completeness for being small and predictable.
   ============================================================ */

window.MD = (function () {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Headings are often Hebrew, and Hebrew slugs to nothing here. Rather
  // than emit id="" for every one of them, fall back to a short hash of the
  // text, which is stable across renders and unique enough for an anchor.
  function simpleHash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function slugify(s) {
    var text = String(s);
    var out = text
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return out || 'h' + simpleHash(text);
  }

  /* ---------------------------------------------------------- inline */

  // A transliteration character: lower-case Latin, the apostrophe that
  // stands for ayin and for alef between vowels, a hyphen and a full stop.
  // No IPA: this course writes /shalom/, never /ʃaˈlom/.
  var PH = "a-z'\\-.";
  // Spaces are allowed inside a transcription but never at its edges, so
  // "a / b / c" separators are not mistaken for one.
  var TR = new RegExp(
    '(^|[\\s(\\[=,;·–>*])' +
    '\\/([' + PH + '](?:[' + PH + ' ]{0,38}[' + PH + '])?)\\/' +
    '(?=$|[\\s.,;:!?)\\]<–·|*])', 'g');

  /* ------------------------------------------------------- Hebrew runs */

  // Letters, pointing and the Hebrew punctuation marks, as one class.
  var HCHAR = '\\u0591-\\u05C7\\u05D0-\\u05EA\\u05F0-\\u05F4';
  // A run starts and ends on a Hebrew character. Spaces, digits and western
  // punctuation are allowed between them, so a whole Hebrew sentence is one
  // run, but a Latin letter ends it: the English around it stays outside.
  var HE_RUN = new RegExp(
    '[' + HCHAR + '](?:[' + HCHAR + ' 0-9.,!?:;()\\u05BE\\u2010-\\u2015-]*[' + HCHAR + '])?', 'g');

  // Wrap every Hebrew run in the rendered HTML, leaving the tags alone.
  // Splitting on tags first is what keeps attribute values (hrefs, alt text,
  // the class names above) out of the match.
  function wrapHebrew(html) {
    if (html.indexOf('\u05D0') === -1 && !/[\u05D0-\u05EA]/.test(html)) return html;
    return html.split(/(<[^>]+>)/).map(function (seg) {
      if (!seg || seg.charAt(0) === '<') return seg;
      return seg.replace(HE_RUN, function (m) {
        return '<span class="he" lang="he" dir="rtl">' + Heb.show(m) + '</span>';
      });
    }).join('');
  }

  function inline(src) {
    if (src == null) return '';
    var codes = [];
    // Pull inline code out first so its contents are never re-parsed.
    var s = String(src).replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    s = esc(s);

    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" loading="lazy">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, text, href) {
      var ext = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + href + '"' + ext + '>' + text + '</a>';
    });

    // Transliterations get their own span so audio.js can hang a play
    // button off them. Deliberately narrow: only Latin letters, and only
    // when the slashes stand free of surrounding words, so paths and
    // "and/or" are left alone.
    s = s.replace(TR, '$1<span class="tr">/$2/</span>');

    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Allow a single * (nested italics) inside bold, but never a ** pair,
    // so adjacent bold spans still close at the right place.
    s = s.replace(/\*\*((?:[^*]|\*(?!\*))+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\s\/\/\s/g, ' <span class="sep">·</span> ');

    // Last, so every tag the rules above produced is already in place and
    // can be skipped, and first relative to the code placeholders, so a
    // Hebrew word inside `backticks` is left exactly as it was typed.
    s = wrapHebrew(s);

    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return '<code>' + esc(codes[+i]) + '</code>';
    });
    return s;
  }

  /* ---------------------------------------------------------- tables */

  function isTableDivider(line) {
    return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.indexOf('-') !== -1 && line.indexOf('|') !== -1;
  }

  function splitRow(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [], cur = '', escaped = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (escaped) { cur += ch; escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function alignments(divider) {
    return splitRow(divider).map(function (c) {
      var l = c.charAt(0) === ':', r = c.charAt(c.length - 1) === ':';
      if (l && r) return ' style="text-align:center"';
      if (r) return ' style="text-align:right"';
      return '';
    });
  }

  function renderTable(head, divider, rows) {
    var align = alignments(divider);
    var cls = /letter|sound|nikud|vowel/i.test(head.join(' ')) ? ' class="sounds"' : '';
    var out = '<div class="table-wrap"><table' + cls + '><thead><tr>';
    head.forEach(function (c, i) {
      out += '<th dir="auto"' + (align[i] || '') + '>' + inline(c) + '</th>';
    });
    out += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      out += '<tr>';
      for (var i = 0; i < head.length; i++) {
        out += '<td dir="auto"' + (align[i] || '') + '>' + inline(r[i] == null ? '' : r[i]) + '</td>';
      }
      out += '</tr>';
    });
    return out + '</tbody></table></div>';
  }

  /* ---------------------------------------------------------- custom blocks */

  var CALLOUTS = {
    tip:     { label: 'Tip',      icon: '💡' },
    warning: { label: 'Careful',  icon: '⚠️' },
    rule:    { label: 'The rule', icon: '📐' },
    sound:   { label: 'Sound',    icon: '🔊' },
    note:    { label: 'Note',     icon: '✎'  }
  };

  var exCounter = 0;

  function renderCustom(kind, arg, body) {
    if (CALLOUTS[kind]) {
      var c = CALLOUTS[kind];
      var label = arg || c.label;
      return '<div class="callout callout-' + kind + '">' +
        '<div class="callout-label"><span aria-hidden="true">' + c.icon + '</span>' + esc(label) + '</div>' +
        render(body) + '</div>';
    }

    if (kind === 'examples') {
      var rows = body.split('\n').filter(function (l) { return l.trim(); });
      var html = '<div class="examples">';
      rows.forEach(function (l) {
        var parts = l.split('||');
        html += '<div class="example">' +
                '<span class="ex-he" lang="he" dir="rtl">' + inline(parts[0].trim()) + '</span>' +
                '<span class="ex-en">' + inline((parts[1] || '').trim()) + '</span></div>';
      });
      return html + '</div>';
    }

    if (kind === 'exercise') {
      var id = 'ex' + (++exCounter);
      var items = body.split('\n').filter(function (l) { return l.trim(); });
      var h = '<section class="exercise" data-ex="' + id + '">' +
        '<div class="exercise-head"><h4>' + esc(arg || 'Practice') + '</h4>' +
        '<span class="exercise-score" data-role="score"></span></div><ol class="exercise-list">';
      items.forEach(function (l, i) {
        var parts = l.split('||');
        var q = parts[0].trim();
        var a = (parts[1] || '').trim();
        var note = (parts[2] || '').trim();
        // Mark the gap before inline(), then swap in the markup after, so
        // the span isn't escaped along with the rest of the question text.
        q = q.replace(/_{2,}/g, '\u0001');
        var qHtml = inline(q).replace(/\u0001/g, '<span class="blank"></span>');
        h += '<li class="exercise-item" data-i="' + i + '">' +
             '<div class="exercise-q" dir="auto">' + qHtml + '</div>' +
             '<div class="exercise-a" dir="auto">' + inline(a) +
               (note ? '<span class="ex-note">' + inline(note) + '</span>' : '') + '</div>' +
             '<div class="exercise-actions">' +
               '<button class="btn btn-reveal" data-act="reveal">Show answer</button>' +
               '<span class="grade-row">' +
                 '<button class="btn btn-ok" data-act="ok">Got it</button>' +
                 '<button class="btn btn-again" data-act="again">Review again</button>' +
               '</span>' +
             '</div></li>';
      });
      return h + '</ol></section>';
    }

    if (kind === 'vocab') {
      return '<div class="vocab-embed" data-themes="' + esc(arg || '') + '"></div>';
    }

    return render(body);
  }

  /* ---------------------------------------------------------- block parser */

  function render(src) {
    if (!src) return '';
    var lines = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
    var out = [];
    var para = [];

    function flushPara() {
      if (!para.length) return;
      out.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      /* custom ::: block */
      var custom = /^:::\s*([a-z-]+)\s*(.*)$/.exec(trimmed);
      if (custom) {
        flushPara();
        var kind = custom[1], arg = custom[2].trim(), buf = [], depth = 1;
        for (i++; i < lines.length; i++) {
          var t = lines[i].trim();
          if (/^:::\s*[a-z-]+/.test(t)) { depth++; buf.push(lines[i]); continue; }
          if (t === ':::') { depth--; if (!depth) break; buf.push(lines[i]); continue; }
          buf.push(lines[i]);
        }
        out.push(renderCustom(kind, arg, buf.join('\n')));
        continue;
      }

      /* fenced code */
      if (/^```/.test(trimmed)) {
        flushPara();
        var lang = trimmed.slice(3).trim(), code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i].trim()); i++) code.push(lines[i]);
        out.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' +
                 esc(code.join('\n')) + '</code></pre>');
        continue;
      }

      /* blank */
      if (!trimmed) { flushPara(); continue; }

      /* heading */
      var h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (h) {
        flushPara();
        var lvl = h[1].length, text = h[2].replace(/\s+#+\s*$/, '');
        var id = slugify(text);
        var anchor = lvl >= 2 && lvl <= 3
          ? '<a class="anchor" href="#' + id + '" aria-label="Link to this section">#</a>' : '';
        out.push('<h' + lvl + ' id="' + id + '">' + inline(text) + anchor + '</h' + lvl + '>');
        continue;
      }

      /* hr */
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushPara(); out.push('<hr>'); continue; }

      /* table */
      if (trimmed.indexOf('|') !== -1 && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
        flushPara();
        var head = splitRow(line), divider = lines[i + 1], rows = [];
        for (i += 2; i < lines.length && lines[i].trim().indexOf('|') !== -1; i++) {
          rows.push(splitRow(lines[i]));
        }
        i--;
        out.push(renderTable(head, divider, rows));
        continue;
      }

      /* blockquote */
      if (/^>\s?/.test(trimmed)) {
        flushPara();
        var quote = [];
        for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) {
          quote.push(lines[i].replace(/^\s*>\s?/, ''));
        }
        i--;
        out.push('<blockquote>' + render(quote.join('\n')) + '</blockquote>');
        continue;
      }

      /* list */
      if (/^([-*]|\d+[.)])\s+/.test(trimmed)) {
        flushPara();
        var ordered = /^\d+[.)]\s+/.test(trimmed);
        var block = [];
        for (; i < lines.length; i++) {
          var L = lines[i];
          var m = /^(\s*)([-*]|\d+[.)])\s+/.exec(L);
          if (!L.trim()) {
            // A blank line ends the list unless what follows is still part of
            // it -- an indented continuation, or another item of the same kind.
            var next = lines[i + 1] || '';
            var nm = /^(\s*)([-*]|\d+[.)])\s+/.exec(next);
            if (!nm && !/^\s{2,}\S/.test(next)) break;
            if (nm && nm[1].length === 0 && /^\d/.test(nm[2]) !== ordered) break;
            block.push('');
            continue;
          }
          // A marker of the other kind at base indent starts a new list.
          if (m && m[1].length === 0 && /^\d/.test(m[2]) !== ordered) break;
          if (!m && !/^\s{2,}\S/.test(L)) break;
          block.push(L);
        }
        i--;
        out.push(renderList(block, ordered));
        continue;
      }

      para.push(trimmed);
    }

    flushPara();
    return out.join('\n');
  }

  function renderList(block, ordered) {
    var items = [];
    var cur = null;
    var baseIndent = null;

    block.forEach(function (line) {
      var m = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(line);
      if (m && (baseIndent === null || m[1].length <= baseIndent)) {
        if (baseIndent === null) baseIndent = m[1].length;
        if (cur) items.push(cur);
        cur = [m[3]];
      } else if (cur) {
        cur.push(line.replace(new RegExp('^\\s{0,' + ((baseIndent || 0) + 2) + '}'), ''));
      }
    });
    if (cur) items.push(cur);

    var tag = ordered ? 'ol' : 'ul';
    var html = '<' + tag + '>';
    items.forEach(function (parts) {
      // Lines that simply wrap belong to the item's own sentence; only a real
      // block (list, table, callout, blank-line-separated text) becomes a child.
      var lead = [parts[0]];
      var k = 1;
      while (k < parts.length) {
        var l = parts[k];
        if (!l.trim() || /^\s*([-*]|\d+[.)])\s+/.test(l) || /^\s*(:::|\||>|#|```)/.test(l.trim())) break;
        lead.push(l.trim());
        k++;
      }
      var rest = parts.slice(k).join('\n').replace(/^\n+|\n+$/g, '');
      html += '<li>' + inline(lead.join(' ')) + (rest ? render(rest) : '') + '</li>';
    });
    return html + '</' + tag + '>';
  }

  /* ---------------------------------------------------------- extras */

  // Pull "# Title" and any front-matter-ish meta line out of a document.
  function frontMatter(src) {
    var meta = {};
    var text = String(src).replace(/\r\n?/g, '\n');
    var fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (fm) {
      fm[1].split('\n').forEach(function (l) {
        var idx = l.indexOf(':');
        if (idx > 0) meta[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
      });
      text = text.slice(fm[0].length);
    }
    return { meta: meta, body: text };
  }

  function headings(src) {
    var out = [];
    String(src).split('\n').forEach(function (l) {
      var m = /^(#{2,3})\s+(.*)$/.exec(l.trim());
      if (m) out.push({ level: m[1].length, text: m[2].replace(/\s+#+$/, ''), id: slugify(m[2]) });
    });
    return out;
  }

  // Strip markup so the search index scores plain words.
  function plain(src) {
    return String(src)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^:::.*$/gm, ' ')
      .replace(/\|/g, ' ')
      .replace(/[#*_>`~-]/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { render: render, inline: inline, slugify: slugify, frontMatter: frontMatter, headings: headings, plain: plain };
})();
