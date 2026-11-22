// A small validator for the subset of JSON Schema that Buddy's schemas use:
// type, enum, const, pattern, minLength, minimum, items, minItems, properties, required, additionalProperties (false only), anyOf.
// Returns a list of { path, message }. Zero dependencies.
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);

export function validate(schema, v, path = '') {
  const errs = []; const bad = message => errs.push({ path: path || '(root)', message });
  if (schema.anyOf) {
    const results = schema.anyOf.map(s => validate(s, v, path));
    if (!results.some(r => r.length === 0)) bad(`matches none of the allowed shapes (${results.map(r => r[0]?.message).join(' | ')})`);
    return errs;
  }
  if (schema.type) {
    const ts = [].concat(schema.type);
    if (!ts.some(t => isType(v, t))) { bad(`must be ${ts.join(' or ')}, got ${typeOf(v)}`); return errs; }
  }
  if (schema.const !== undefined && v !== schema.const) bad(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(v)) bad(`must be one of ${schema.enum.join(', ')}; got ${JSON.stringify(v)}`);
  if (typeof v === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) bad(`"${v}" does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && v.length < schema.minLength) bad(`must have at least ${schema.minLength} characters`);
  }
  if (typeof v === 'number' && schema.minimum !== undefined && v < schema.minimum) bad(`must be at least ${schema.minimum}`);
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) bad(`must have at least ${schema.minItems} item(s)`);
    if (schema.items) v.forEach((x, i) => errs.push(...validate(schema.items, x, `${path}[${i}]`)));
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const r of schema.required || []) if (!(r in v) || v[r] === null || v[r] === '') errs.push({ path: `${path}.${r}`.replace(/^\./, ''), message: 'is required' });
    const props = schema.properties || {};
    for (const [k, s] of Object.entries(props)) if (k in v && v[k] !== null) errs.push(...validate(s, v[k], `${path}.${k}`.replace(/^\./, '')));
    if (schema.additionalProperties === false) for (const k of Object.keys(v)) if (!(k in props)) errs.push({ path: `${path}.${k}`.replace(/^\./, ''), message: 'is not a known field' });
  }
  return errs;
}
