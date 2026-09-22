export function escapeHtml(value = '') {
  return String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[character]
  );
}

export function safeSameOriginHttpsUrl(value, allowedOrigin) {
  try {
    const expectedOrigin = new URL(allowedOrigin).origin;
    const candidate = new URL(String(value));

    if (candidate.protocol !== 'https:' || candidate.origin !== expectedOrigin) {
      return '';
    }

    return candidate.href;
  } catch (_) {
    return '';
  }
}
