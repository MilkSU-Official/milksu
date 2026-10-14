import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const ctfSurface = /nssctf|ctfshow|NSSCTF|CTFshow|\bCTF\b|\bflag\b|题面|submit_flag|fetch_attachment/i;

test('popup uses the neutral MilkSU dark surface palette', async () => {
  const source = await fs.readFile('browserextension/popup.html', 'utf8');
  assert.match(source, /background: #090c0f;/);
  assert.match(source, /background: #14191d;/);
  assert.match(source, /color: #9ba6b4;/);
  assert.doesNotMatch(source, /#101927|#151f2e|#344158|#8799b5/);
  assert.match(source, /连接当前标签 \/ Connect this tab/);
  assert.match(source, /id="disconnect"/);
});

test('extension copy has no CTF surface', async () => {
  const files = ['manifest.json', 'popup.html', 'popup.js', 'background.js'];
  for (const name of files) {
    const source = await fs.readFile(`browserextension/${name}`, 'utf8');
    assert.doesNotMatch(source, ctfSurface, `${name} still mentions a CTF surface`);
  }
});

test('popup ingest does not send a site adapter', async () => {
  const source = await fs.readFile('browserextension/popup.js', 'utf8');
  assert.doesNotMatch(source, /adapter\s*:/);
  assert.match(source, /bridgeSessionId/);
  assert.match(source, /title: page\.title/);
  assert.match(source, /url: page\.url/);
});
