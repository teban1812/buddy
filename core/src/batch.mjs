// Reading question batches (docs/design/03-schemas-v0.md). Task 2 adds writing and analysis to this module.
import fs from 'node:fs';
import { parseDocument } from './frontmatter.mjs';

export function readBatch(file) {
  const d = parseDocument(fs.readFileSync(file, 'utf8'));
  if (d.error) throw new Error(`${file}: ${d.error}`);
  if (d.data.schema !== 'buddy/question-batch@0') throw new Error(`${file}: not a question batch`);
  return d.data;
}

// An answered question becomes one answer source: the situation, the chosen option (label and cost) and any free text.
export function answersFromBatch(file) {
  return (readBatch(file).questions || []).filter(q => q.status === 'answered' || q.status === 'assumed').map(q => {
    const opt = (q.options || []).find(x => x.id === q.answer?.option);
    return { id: q.id, text: [q.situation, opt?.label, opt?.cost, q.answer?.text].filter(Boolean).join('. '), origin: q.answer?.origin };
  });
}
