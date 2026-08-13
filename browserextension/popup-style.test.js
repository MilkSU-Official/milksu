import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('popup uses the neutral MilkSU dark surface palette', async () => {
  const source = await fs.readFile('browserextension/popup.html', 'utf8');
  assert.match(source, /background: #090c0f;/);
  assert.match(source, /background: #14191d;/);
  assert.match(source, /color: #9ba6b4;/);
  assert.doesNotMatch(source, /#101927|#151f2e|#344158|#8799b5/);
});
