// lib/i18n.js + lib/gallery.js'i (dil sözlüğü + saf hesap fonksiyonları) userscript'teki işaretli bloğa gömer.
// Çalıştırma: node tools/build-userscript.mjs — lib/ altındaki bu iki dosya her değiştiğinde çalıştırılmalı
// (CI, gömülü bloğun güncel olup olmadığını denetler: tests/userscript.test.mjs).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const US = fileURLToPath(new URL('../userscript/gallery-grab.user.js', import.meta.url));
const LIB = fileURLToPath(new URL('../lib/gallery.js', import.meta.url));
const I18N = fileURLToPath(new URL('../lib/i18n.js', import.meta.url));
const BEGIN = '  // @@BEGIN lib/gallery.js';
const END = '  // @@END lib/gallery.js';

// Saf dönüşüm: userscript metnine lib kaynaklarını gömülü hâlde yerleştirir
export function embed(us, i18nSrc, libSrc) {
  const lib = (i18nSrc + '\n' + libSrc)
    .replace(/^import .*$/gm, '')
    .replace(/^export (const|function|async function) /gm, '$1 ')
    .split('\n').map((l) => (l ? '  ' + l : l)).join('\n')
    .trimEnd();
  if (/^\s*(import|export)\b/m.test(lib)) throw new Error('lib içinde import/export kaldı');
  const a = us.indexOf(BEGIN);
  const b = us.indexOf(END);
  if (a < 0 || b < a) throw new Error('userscript içinde @@BEGIN/@@END işaretleri yok');
  return us.slice(0, a) + BEGIN + ' — tools/build-userscript.mjs üretir, elle düzenleme\n' + lib + '\n' + us.slice(b);
}

export async function build() {
  const [us, i18n, lib] = await Promise.all([readFile(US, 'utf8'), readFile(I18N, 'utf8'), readFile(LIB, 'utf8')]);
  return { current: us, built: embed(us, i18n, lib) };
}

// Doğrudan çalıştırıldıysa dosyayı yaz
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { current, built } = await build();
  if (built === current) console.log('userscript zaten güncel');
  else { await writeFile(US, built); console.log('userscript güncellendi'); }
}
