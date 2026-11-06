// Kleiner, sicherer Markdown-Renderer: escaped ALLES zuerst, erlaubt nur http(s)/mailto-Links.
(function (global) {
  'use strict';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  function inline(s) {
    var codes = [];
    s = esc(s).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>')
      .replace(/\[\[([^\]]+)\]\]/g, '<a href="#" class="wiki" data-wiki="$1">$1</a>')
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
      .replace(/(^|\s)#([\wäöüÄÖÜß-]+)/g, '$1<span class="tag">#$2</span>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }

  function render(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0, para = [], list = null;
    function flushPara() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    function openList(t) { if (list !== t) { closeList(); out.push('<' + t + (t === 'ul' ? '' : '') + '>'); list = t; } }

    for (; i < lines.length; i++) {
      var l = lines[i], m;
      if (/^```/.test(l)) {
        flushPara(); closeList();
        var buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (/^\s*$/.test(l)) { flushPara(); closeList(); continue; }
      if ((m = l.match(/^(#{1,3})\s+(.*)$/))) { flushPara(); closeList(); out.push('<h' + (m[1].length + 1) + '>' + inline(m[2]) + '</h' + (m[1].length + 1) + '>'); continue; }
      if (/^(-{3,}|\*{3,})\s*$/.test(l)) { flushPara(); closeList(); out.push('<hr>'); continue; }
      if ((m = l.match(/^>\s?(.*)$/))) { flushPara(); closeList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      if ((m = l.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
        flushPara(); openList('ul');
        var done = m[1] !== ' ';
        out.push('<li class="task' + (done ? ' done' : '') + '"><input type="checkbox" data-line="' + i + '"' + (done ? ' checked' : '') + ' aria-label="Aufgabe"> <span>' + inline(m[2]) + '</span></li>');
        continue;
      }
      if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { flushPara(); openList('ul'); out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); openList('ol'); out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      closeList(); para.push(l);
    }
    flushPara(); closeList();
    return out.join('\n');
  }

  function toggleTask(src, lineNo) {
    var lines = String(src).split('\n');
    var l = lines[lineNo];
    if (l == null) return src;
    lines[lineNo] = /\[ \]/.test(l) ? l.replace('[ ]', '[x]') : l.replace(/\[(x|X)\]/, '[ ]');
    return lines.join('\n');
  }

  global.MD = { render: render, esc: esc, inline: inline, toggleTask: toggleTask };
})(window);
