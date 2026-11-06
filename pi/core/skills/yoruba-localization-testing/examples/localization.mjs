/**
 * Minimal dependency-free bilingual UI example.
 * Strings are illustrative; fluent Yoruba speakers should review them.
 */
export const messages = {
  en: { welcome: 'Welcome', search: 'Search', logout: 'Log out' },
  yo: { welcome: 'Ẹ káàbọ̀', search: 'Wá' },
};

/** @param {'en' | 'yo'} locale @param {keyof typeof messages.en} key */
export function translate(locale, key) {
  return messages[locale]?.[key] ?? messages.en[key] ?? key;
}

/** @param {string} left @param {string} right */
export function sameNormalizedText(left, right) {
  return left.normalize('NFC') === right.normalize('NFC');
}
