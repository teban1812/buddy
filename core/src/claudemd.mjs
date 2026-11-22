// The CLAUDE.md a project is born with (R111's lesson: what is written at birth is not corrected by a plugin update, so it holds only stable pointers;
// the long instructions stay in the plugin). Buddy's part is a block between two markers: creating, inserting and updating it never touch the rest.
export const BEGIN = '<!-- buddy:begin (written by buddy init; what you write outside these two markers is yours) -->';
export const END = '<!-- buddy:end -->';

export const BLOCK = `${BEGIN}
## Built with Buddy
This project is built with Buddy, the Product Owner's companion. Read in this order:
1. \`docs/context.md\`: why the project exists, who it is for, its constraints and the owner's risk appetite.
2. \`docs/standards/\`: the project's rules. A \`must\` rule always holds, \`prefer\` is the default, \`free\` is your choice.
3. \`docs/inputs/\`: what the owner handed over (a PRD, a prototype). Read it, never change it.
4. \`docs/buddy/\`: the changes, the milestones and the evidence of each check. Change them only with Buddy's commands, never by hand.

Commits: Conventional Commits (\`feat\`, \`fix\`, \`chore\`, ...). Name the files you commit; never \`git add -A\` or a whole folder. A \`feat\` names its change in a \`Slice: <name>\` trailer and a \`fix\` says why in a \`Buddy-Fix: <reason>\` trailer.
${END}
`;

const RE = new RegExp(`${BEGIN.replace(/[()]/g, '\\$&')}[\\s\\S]*?${END}\\n?`);

// existing: the text of the file, or null when there is none. `where` is 'top' (a file that came from the template) or 'end' (one that was already there).
// Returns { text, change }: 'created', 'merged' (the block was added to a file), 'updated' (the block was there and differed) or 'kept' (nothing to do).
export function mergeClaudeMd(existing, { where = 'top' } = {}) {
  if (existing == null) return { text: BLOCK, change: 'created' };
  if (RE.test(existing)) { const text = existing.replace(RE, BLOCK); return { text, change: text === existing ? 'kept' : 'updated' }; }
  const body = existing.replace(/^\n+/, '');
  if (where === 'end') return { text: `${existing.replace(/\s*$/, '')}\n\n${BLOCK}`, change: 'merged' };
  return { text: `${BLOCK}\n${body}`, change: 'merged' };
}
