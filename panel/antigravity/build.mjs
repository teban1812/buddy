// Builds dist/server.mjs, the one file Antigravity runs (`npm install` then `npm run build`, only when src/ changes): the page is bundled with its
// words and inlined into the server, and the server with the official MCP SDKs, so installing the plugin needs no npm install. `--check` builds in
// memory and exits 1 when dist/server.mjs is not what src/ makes or THIRD_PARTY_NOTICES.md lacks a package the bundle carries (the notices are written by the build).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => path.join(here, ...p);
const page = await build({ entryPoints: [at('src/page.js')], bundle: true, format: 'iife', minify: true, write: false, metafile: true, target: 'es2022', legalComments: 'none' });
const html = fs.readFileSync(at('src/page.html'), 'utf8').replace('<!--script-->', () => `<script>${page.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
const server = await build({
  entryPoints: [at('src/server.js')], bundle: true, format: 'esm', platform: 'node', target: 'node20', minify: true, write: false, metafile: true, legalComments: 'none',
  define: { __PAGE__: JSON.stringify(html) },
  banner: { js: "import{createRequire as __r}from'node:module';const require=__r(import.meta.url);" },
});
const out = server.outputFiles[0].text;

// Every package whose files went into the bundle, with its version, licence and the licence file's text.
const dirs = new Set();
for (const m of [page.metafile, server.metafile]) for (const f of Object.keys(m.inputs)) { const i = f.lastIndexOf('node_modules/'); if (i >= 0) dirs.add(path.join(here, f.slice(0, i + 13) + f.slice(i + 13).split('/').slice(0, f.slice(i + 13).startsWith('@') ? 2 : 1).join('/'))); }
const pkgs = [...dirs].map(d => {
  const j = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
  const lf = fs.readdirSync(d).find(n => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(n));
  return { name: j.name, version: j.version, license: typeof j.license === 'string' ? j.license : (j.license?.type ?? 'UNKNOWN'), text: lf ? fs.readFileSync(path.join(d, lf), 'utf8').trim() : '' };
}).sort((a, b) => (a.name + a.version < b.name + b.version ? -1 : 1));
const notices = `# Third-party notices\n\n\`dist/server.mjs\` bundles the packages below (written by \`npm run build\`); each is under its own licence, copied here in full.\n\n${pkgs.map(p => `## ${p.name} ${p.version} (${p.license})\n\n${p.text ? '```\n' + p.text + '\n```' : '(this package ships no licence file)'}\n`).join('\n')}`;
if (process.argv.includes('--check')) {
  const have = fs.existsSync(at('THIRD_PARTY_NOTICES.md')) ? fs.readFileSync(at('THIRD_PARTY_NOTICES.md'), 'utf8') : '';
  const missing = pkgs.filter(p => !have.includes(`## ${p.name} ${p.version} (`) || !p.text);
  if (missing.length) console.error(`THIRD_PARTY_NOTICES.md lacks: ${missing.map(p => `${p.name} ${p.version}`).join(', ')}`);
  process.exit(!missing.length && have === notices && fs.existsSync(at('dist/server.mjs')) && fs.readFileSync(at('dist/server.mjs'), 'utf8') === out ? 0 : 1);
}
fs.mkdirSync(at('dist'), { recursive: true });
fs.writeFileSync(at('dist/server.mjs'), out);
fs.writeFileSync(at('THIRD_PARTY_NOTICES.md'), notices);
console.log(`dist/server.mjs: ${out.length} bytes; THIRD_PARTY_NOTICES.md: ${pkgs.length} packages`);
