/*
 * What language Google's sign-in button speaks.
 *
 * The button's text comes from the client script's own URL (`?hl=`), not from
 * the `locale` option passed to renderButton -- that option only reaches an
 * iframe the rendered button does not use. Asked for no language at all,
 * Google picked Arabic for this shop, so the login page showed
 * "تسجيل الدخول باستخدام Google" above a Burmese form.
 *
 * Google does have Burmese for this button; it simply has to be asked for
 * here. The app already stores the chosen language under the same two-letter
 * codes Google wants, so it is passed straight through.
 *
 * The script loads once per page, so the language is fixed at load time:
 * someone who switches language gets the new button text on the next reload.
 */
const LANGUAGE_KEY = 'mahar-pos-language-v2';
const LEGACY_LANGUAGE_KEY = 'mahar-pos-language';

export function googleIdentityLocale() {
  let stored = 'my';
  try {
    stored = localStorage.getItem(LANGUAGE_KEY) || localStorage.getItem(LEGACY_LANGUAGE_KEY) || 'my';
  } catch {
    // Private mode: fall back to the app's default language.
  }
  return stored === 'en' ? 'en' : 'my';
}

export function googleIdentityScriptSrc() {
  return `https://accounts.google.com/gsi/client?hl=${googleIdentityLocale()}`;
}
