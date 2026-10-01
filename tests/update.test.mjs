// lib/update.js birim testleri — çalıştırma: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer } from '../lib/update.js';

test('isNewer: sürümleri sayısal karşılaştırır', () => {
  assert.equal(isNewer('1.5.3', '1.5.2'), true);
  assert.equal(isNewer('1.10.0', '1.9.3'), true);
  assert.equal(isNewer('1.5.2', '1.5.2'), false);
  assert.equal(isNewer('1.5.1', '1.5.2'), false);
  assert.equal(isNewer('1.6', '1.5.9'), true);
  assert.equal(isNewer(undefined, '1.5.2'), false);
});
