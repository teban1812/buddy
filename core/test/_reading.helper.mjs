// Test fixtures: the reading Buddy's agent would write for a prototype made of <section id="x"><h1>Title</h1>...<a href="#y">label</a></section> screens,
// so the manifest functions are drafted from a reading (the program no longer reads a prototype on its own).
import fs from 'node:fs';
import path from 'node:path';
import { fromReading, READING } from '../src/prototype.mjs';

export function readingOf(html, file = 'index.html') {
  const secs = [...html.matchAll(/<section id="([^"]+)">(<h[1-3]>[^<]*<\/h[1-3]>)([\s\S]*?)<\/section>/g)]; const ids = new Set(secs.map(m => m[1])); const flows = []; const fake = [];
  const screens = secs.map(m => ({ name: m[1], title: m[2].replace(/<[^>]+>/g, ''), file, evidence: [m[2]] }));
  for (const m of secs) for (const a of m[3].matchAll(/<a href="#([^"]*)">([^<]*)<\/a>/g)) {
    if (ids.has(a[1]) && a[1] !== m[1]) flows.push({ from: m[1], to: a[1], via: a[2], evidence: [a[0]] }); else if (!a[1]) fake.push({ screen: m[1], text: `goes nowhere: link "${a[2]}"` });
  }
  return { screens, flows, fake };
}
export const draftOf = (html, file = 'index.html') => fromReading(readingOf(html, file), [{ name: file, html }]);
// The agent's reading file, written next to the prototype the way `prototype facts` is followed in real use.
export const writeReading = (d, html, file = 'index.html') => fs.writeFileSync(path.join(d, READING), JSON.stringify(readingOf(html, file)));
