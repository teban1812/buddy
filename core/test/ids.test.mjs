import test from 'node:test';
import assert from 'node:assert/strict';
import { clip, named } from '../src/ids.mjs';

test('an id travels with its text; a long text is cut near 60 characters with an ellipsis', () => {
  assert.equal(named('Save books', 'save-books'), 'Save books [save-books]');
  assert.equal(named(null, 'save-books'), 'save-books');
  const long = 'A reader adds a title that is already archived and wants it back on the list';
  assert.equal(clip(long).length, 60); assert.ok(clip(long).endsWith('…')); assert.ok(named(long, 'Q-1').endsWith('… [Q-1]'));
  assert.equal(clip('  one\n two  '), 'one two');
});
