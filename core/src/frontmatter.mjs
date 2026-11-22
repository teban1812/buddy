// Front matter reader for the restricted YAML subset that Buddy files use (proposal, see 03-schemas-v0.md section 2).
// Subset: block maps, block lists, inline lists of scalars, quoted and plain scalars, "[]" and "{}".
// Not supported on purpose (an error, not a silent guess): tabs, anchors, multi-line scalars, flow maps with content,
// trailing comments. Dates stay strings. Zero dependencies.

const KEY = /^([A-Za-z0-9_.-]+):(?: (.*))?$/;

function scalar(raw, where) {
  const t = raw.trim();
  if (t === '') return null;
  if (t[0] === '"') {
    if (t.length < 2 || t[t.length - 1] !== '"') throw new Error(`${where}: unterminated double quote`);
    try { return JSON.parse(t); } catch { throw new Error(`${where}: bad escape in double-quoted string`); }
  }
  if (t[0] === "'") {
    if (t.length < 2 || t[t.length - 1] !== "'") throw new Error(`${where}: unterminated single quote`);
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[&*!|>%@`]/.test(t)) throw new Error(`${where}: unsupported YAML feature near "${t.slice(0, 12)}"`);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return t;
}

function inlineList(raw, where) {
  const inner = raw.trim().slice(1, -1);
  if (!raw.trim().endsWith(']')) throw new Error(`${where}: inline list not closed on one line`);
  const items = []; let cur = ''; let q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { cur += c; if (c === '\\' && q === '"') { cur += inner[++i] ?? ''; } else if (c === q) q = null; continue; }
    if ((c === '"' || c === "'") && cur.trim() === '') { q = c; cur += c; continue; }   // a quote opens a string only at the start of an item
    if (c === '[' || c === '{') throw new Error(`${where}: nested flow collections are not supported`);
    if (c === ',') { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (q) throw new Error(`${where}: unterminated quote in inline list`);
  if (cur.trim() !== '' || items.length) items.push(cur);
  return items.map(x => scalar(x, where));
}

function value(raw, where) {
  const t = raw.trim();
  if (t === '[]') return [];
  if (t === '{}') return {};
  if (t[0] === '[') return inlineList(t, where);
  if (t[0] === '{') throw new Error(`${where}: flow maps with content are not supported`);
  return scalar(t, where);
}

function tokenize(text, offset) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    const no = i + 1 + offset;
    if (/\t/.test(line.match(/^\s*/)[0])) throw new Error(`line ${no}: tab indentation is not allowed`);
    if (line.trim() === '' || /^\s*#/.test(line)) return;
    out.push({ indent: line.match(/^ */)[0].length, text: line.trim(), no });
  });
  return out;
}

function parseBlock(toks, st, indent) {
  const first = toks[st.i];
  if (first.text === '-' || first.text.startsWith('- ')) return parseList(toks, st, indent);
  return parseMap(toks, st, indent);
}

function parseList(toks, st, indent) {
  const arr = [];
  while (st.i < toks.length && toks[st.i].indent === indent && (toks[st.i].text === '-' || toks[st.i].text.startsWith('- '))) {
    const t = toks[st.i]; const rest = t.text === '-' ? '' : t.text.slice(2).trimStart(); const where = `line ${t.no}`;
    if (rest === '') {
      st.i++;
      if (st.i < toks.length && toks[st.i].indent > indent) arr.push(parseBlock(toks, st, toks[st.i].indent)); else arr.push(null);
    } else if (KEY.test(rest) && rest[0] !== '"' && rest[0] !== "'") {
      toks[st.i] = { indent: indent + 2, text: rest, no: t.no };   // a map item: its first key sits after the dash
      arr.push(parseMap(toks, st, indent + 2));
    } else { st.i++; arr.push(value(rest, where)); }
  }
  return arr;
}

function parseMap(toks, st, indent) {
  const obj = {};
  while (st.i < toks.length && toks[st.i].indent === indent) {
    const t = toks[st.i]; const m = KEY.exec(t.text); const where = `line ${t.no}`;
    if (!m) throw new Error(`${where}: expected "key: value", got "${t.text.slice(0, 40)}"`);
    if (t.text.startsWith('- ')) throw new Error(`${where}: list item where a key was expected`);
    const key = m[1];
    if (Object.hasOwn(obj, key)) throw new Error(`${where}: duplicate key "${key}"`);
    st.i++;
    if (m[2] !== undefined && m[2].trim() !== '') obj[key] = value(m[2], where);
    else if (st.i < toks.length && toks[st.i].indent > indent) obj[key] = parseBlock(toks, st, toks[st.i].indent);
    else obj[key] = null;
  }
  if (st.i < toks.length && toks[st.i].indent > indent) throw new Error(`line ${toks[st.i].no}: unexpected indentation`);
  return obj;
}

export function parseYaml(text, offset = 0) {
  const toks = tokenize(text, offset); if (!toks.length) return {};
  const st = { i: 0 };
  const v = parseBlock(toks, st, toks[0].indent);
  if (st.i < toks.length) throw new Error(`line ${toks[st.i].no}: unexpected content`);
  return v;
}

// Splits "---\n<yaml>\n---\n<body>" and parses the yaml. Never throws: returns { data, body, error }.
export function parseDocument(text) {
  const norm = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/.exec(norm);
  if (!m) return { data: null, body: norm, error: 'no front matter (file must start with a --- block)' };
  try { return { data: parseYaml(m[1], 1), body: m[2] ?? '', error: null }; }
  catch (e) { return { data: null, body: m[2] ?? '', error: e.message }; }
}
