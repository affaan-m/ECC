import test from 'node:test';
import assert from 'node:assert/strict';
import { messages, translate, sameNormalizedText } from './localization.mjs';

test('Yoruba text preserves underdots and tone marks', () => {
  assert.equal(translate('yo', 'welcome'), 'Ẹ káàbọ̀');
  assert.equal(translate('yo', 'search'), 'Wá');
});

test('English strings remain available', () => {
  assert.equal(translate('en', 'welcome'), 'Welcome');
});

test('Untranslated keys fall back to English', () => {
  assert.equal(translate('yo', 'logout'), 'Log out');
});

test('Canonically equivalent combining sequences compare equal', () => {
  assert.equal(sameNormalizedText('ẹ́', 'ẹ\u0301'), true);
  assert.equal(sameNormalizedText('Ọ̀rọ̀', 'Ọ̀rọ̀'.normalize('NFD')), true);
});

test('Distinct Yoruba letters and tones are not silently collapsed', () => {
  assert.equal(sameNormalizedText('ẹ', 'e'), false);
  assert.equal(sameNormalizedText('ṣ', 's'), false);
  assert.equal(sameNormalizedText('à', 'á'), false);
});

test('Localized data survives JSON serialization', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), messages);
});
