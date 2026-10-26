export function normalizeApiBaseUrl(value = '') {
  const trimmed = String(value).trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (/^api\.lk888\.ai$/i.test(url.hostname) && (url.pathname === '' || url.pathname === '/')) {
      url.pathname = '/v1';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    // The settings validator reports malformed URLs with its localized message.
  }
  return trimmed;
}
