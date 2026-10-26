export function restoreApiUrl(current) {
  const url = new URL(current || '/', 'http://localhost');
  const cinepath = url.searchParams.get('cinepath');
  if (!cinepath || cinepath.includes('..') || cinepath.includes('\\') || !cinepath.startsWith('/')) return current || '/';
  url.searchParams.delete('cinepath');
  const qs = url.searchParams.toString();
  return `/api${cinepath}${qs ? `?${qs}` : ''}`;
}
