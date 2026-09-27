// Dil sözlüğü ve userscript gömülü kod testleri — çalıştırma: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeT } from '../lib/i18n.js';
import { build } from '../tools/build-userscript.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('lib/i18n.js');
const dict = (name) => {
  const body = src.split('const ' + name + ' = {')[1].split('\n};')[0];
  return new Map([...body.matchAll(/'([^']+)':\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"))/g)].map((m) => [m[1], m[2]]));
};
const TR = dict('TR');
const EN = dict('EN');
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('TR ve EN aynı anahtarlara sahip', () => {
  assert.deepEqual([...TR.keys()].filter((k) => !EN.has(k)), []);
  assert.deepEqual([...EN.keys()].filter((k) => !TR.has(k)), []);
});

test('iki dilde yer tutucular aynı', () => {
  for (const [k, v] of TR) assert.equal(vars(EN.get(k)), vars(v), k);
});

test('kodda kullanılan her anahtar sözlükte var', () => {
  const files = {
    'gallery.js': /\bt\('([^']+)'/g,
    'background.js': /\bT\('([^']+)'/g,
    'userscript/gallery-grab.user.js': /\bL\('([^']+)'/g,
    'gallery.html': /data-i18n(?:-title|-ph)?="([^"]+)"/g,
    'lib/gallery.js': /\bt\('([^']+)'/g,
  };
  for (const [f, re] of Object.entries(files)) {
    const missing = [...new Set([...read(f).matchAll(re)].map((m) => m[1]))].filter((k) => !TR.has(k) && !k.endsWith('.'));
    assert.deepEqual(missing, [], f);
  }
});

test('makeT: yer tutucu doldurur, eksikte Türkçeye / anahtara düşer', () => {
  const en = makeT('en');
  assert.equal(en('tokens', { n: 5 }), '5 tokens');
  assert.equal(makeT('tr')('tokens', { n: 5 }), '5 token');
  assert.equal(en('yok.boyle.anahtar'), 'yok.boyle.anahtar');
});

test("userscript'teki gömülü lib güncel (node tools/build-userscript.mjs çalıştırılmış)", async () => {
  const { current, built } = await build();
  assert.ok(built === current, 'userscript güncel değil: node tools/build-userscript.mjs');
});
