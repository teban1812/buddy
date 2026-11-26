// Reading question batches (docs/design/03-schemas-v0.md). Task 2 adds writing and analysis to this module.
import fs from 'node:fs';
import { parseDocument } from './frontmatter.mjs';

export function readBatch(file) {
  const d = parseDocument(fs.readFileSync(file, 'utf8'));
  if (d.error) throw new Error(`${file}: ${d.error}`);
  if (d.data.schema !== 'buddy/question-batch@0') throw new Error(`${file}: not a question batch`);
  return d.data;
}
