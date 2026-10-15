// The app language is a bare language subtag ("en", "de"), which is right for
// picking a translation catalog but drops the device region that decides date
// order: en-AU writes 15/10/2026, en-US 10/15/2026. intlLocale() hands the
// date formatters the device's full tag when its language matches the app
// language, so an Australian or British phone gets its own dates (#75).
import { getLocales } from 'expo-localization';
import { resolveLocaleTag } from '../i18n';

const cache = new Map<string, string>();

// Android 14 appends regional preferences such as `-u-fw-mon-mu-celsius`.
// The app has its own time-format and week-start settings, so keep only the
// language, script and region.
function baseTag(tag: string): string {
  return tag.split(/-[ux]-/i)[0];
}

function isUsable(tag: string): boolean {
  try {
    new Intl.DateTimeFormat(tag);
    return true;
  } catch {
    return false;
  }
}

function deviceTagFor(locale: string): string | null {
  let devices: ReturnType<typeof getLocales>;
  try {
    devices = getLocales();
  } catch {
    return null;
  }
  for (const l of devices) {
    if (!l.languageTag || resolveLocaleTag(l) !== locale) continue;
    const tag = baseTag(l.languageTag);
    // A tag without a region adds nothing over the language subtag.
    if (tag.includes('-') && isUsable(tag)) return tag;
  }
  return null;
}

/** The Intl locale for formatting dates in app language `locale`. */
export function intlLocale(locale: string | null | undefined): string {
  const lang = locale || 'en';
  const hit = cache.get(lang);
  if (hit) return hit;
  // A locale that already names a region (zh-TW) is used as it is.
  const resolved = lang.includes('-')
    ? lang
    : deviceTagFor(lang) ?? (lang === 'en' ? 'en-US' : lang);
  cache.set(lang, resolved);
  return resolved;
}

/** Test hook: forget the resolved tags so a changed device locale is seen. */
export function resetIntlLocaleCache(): void {
  cache.clear();
}
