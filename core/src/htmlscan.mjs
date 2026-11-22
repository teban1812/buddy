// A small tolerant HTML reader with no dependency (R126: the plugin is installed without running `npm install` in core/).
// It is not a browser: it builds a tree good enough to read a prototype (tags, attributes, text), survives unclosed tags,
// comments, entities and scripts, and never throws on markup it does not understand. Scripts are not run or read; `scripts` says there were some.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const CLOSES = { li: ['li'], option: ['option'], tr: ['tr'], td: ['td', 'th'], th: ['td', 'th'], p: ['p'] };   // opening one of these ends an open one at the top
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

function parseAttrs(raw) {
  const attrs = {}; const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g; let m;
  while ((m = re.exec(raw))) { const k = m[1].toLowerCase(); if (!(k in attrs)) attrs[k] = decode(m[2] ?? m[3] ?? m[4] ?? ''); }
  return attrs;
}

// Returns { root, scripts }. A node is { tag, attrs, children, start, end } or a text node { text }; `start` and `end` are where the element
// runs in `src` (its opening tag to the end of its closing one, or to where it was closed implicitly), to cut its fragment out (R155).
export function parseHtml(src) {
  const root = { tag: '#root', attrs: {}, children: [], start: 0, end: src.length }; const stack = [root]; const n = src.length; let i = 0; let scripts = false;
  const top = () => stack[stack.length - 1];
  const text = t => { const v = decode(t).replace(/\s+/g, ' '); if (v.trim()) top().children.push({ text: v }); };
  const close = (name, at, to) => { for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { for (let q = k + 1; q < stack.length; q++) stack[q].end = at; stack[k].end = to; stack.length = k; return; } };
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    if (src[lt + 1] === '/') { const e = src.indexOf('>', lt); close(src.slice(lt + 2, e < 0 ? n : e).trim().toLowerCase().split(/\s/)[0], lt, e < 0 ? n : e + 1); i = e < 0 ? n : e + 1; continue; }
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(lt, lt + 64));
    if (!m) { text('<'); i = lt + 1; continue; }
    let j = lt + m[0].length; let q = null;
    while (j < n) { const c = src[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    const rawAttrs = src.slice(lt + m[0].length, j); const selfClose = rawAttrs.trimEnd().endsWith('/'); const tag = m[1].toLowerCase();
    if (CLOSES[tag] && CLOSES[tag].includes(top().tag)) stack.pop().end = lt;
    const node = { tag, attrs: parseAttrs(selfClose ? rawAttrs.trimEnd().slice(0, -1) : rawAttrs), children: [], start: lt, end: Math.min(j + 1, n) };
    top().children.push(node); i = j + 1;
    if (RAW.has(tag) && !selfClose) {
      if (tag === 'script') scripts = true;
      const e = src.toLowerCase().indexOf(`</${tag}`, i); const g = e < 0 ? -1 : src.indexOf('>', e); i = g < 0 ? n : g + 1; node.end = i; continue;
    }
    if (!VOID.has(tag) && !selfClose) stack.push(node);
  }
  for (let k = 1; k < stack.length; k++) stack[k].end = n;   // never closed: it runs to the end
  return { root, scripts };
}

export function walk(node, fn) { if (node.text !== undefined) return; fn(node); for (const c of node.children) walk(c, fn); }
export const textOf = node => (node.text !== undefined ? node.text : node.children.map(textOf).join(' ')).replace(/\s+/g, ' ').trim();
export const find = (node, pred) => { const out = []; walk(node, el => { if (pred(el)) out.push(el); }); return out; };
