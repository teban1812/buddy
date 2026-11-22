// Writer for the restricted YAML subset read by frontmatter.mjs. Round-trips: parseYaml(dumpYaml(x)) deep-equals x
// for objects built from strings, numbers, booleans, null, arrays and objects (no multi-line strings).

const needsQuote = s => s === '' || /^\s|\s$/.test(s) || /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /: |:$/.test(s) || /^(true|false|null|~)$/.test(s) || /^-?\d+(\.\d+)?$/.test(s) || /^- /.test(s);
const scalar = v => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (/[\n\r\t]/.test(v)) throw new Error('multi-line or tab characters are not supported in front matter values');
  return needsQuote(v) ? JSON.stringify(v) : v;
};
const isScalar = v => v === null || typeof v !== 'object';
const simpleList = a => a.length > 0 && a.every(x => typeof x === 'string' && !/[,\[\]"']/.test(x) && !needsQuote(x) && x.length < 40);

export function dumpYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent); const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (isScalar(v)) lines.push(`${pad}${k}: ${scalar(v)}`);
    else if (Array.isArray(v)) {
      if (!v.length) lines.push(`${pad}${k}: []`);
      else if (simpleList(v)) lines.push(`${pad}${k}: [${v.join(', ')}]`);
      else {
        lines.push(`${pad}${k}:`);
        for (const item of v) {
          if (isScalar(item)) lines.push(`${pad}  - ${scalar(item)}`);
          else {
            const inner = dumpYaml(item, indent + 4).split('\n');
            if (!inner.length || !inner[0]) { lines.push(`${pad}  - {}`); continue; }
            lines.push(`${pad}  - ${inner[0].trimStart()}`, ...inner.slice(1));
          }
        }
      }
    } else if (!Object.keys(v).length) lines.push(`${pad}${k}: {}`);
    else { lines.push(`${pad}${k}:`); lines.push(dumpYaml(v, indent + 2)); }
  }
  return lines.join('\n');
}

export const dumpDocument = (data, body = '') => `---\n${dumpYaml(data)}\n---\n${body}`;
