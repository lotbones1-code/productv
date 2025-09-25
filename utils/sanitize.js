import xss from 'xss';

const whiteList = {};
const xssOptions = {
  whiteList,
  stripIgnoreTag: true,
};

/** Escape HTML special characters. */
export function escapeHtml(str = '') {
  return xss(str, xssOptions);
}

const urlRegex = /((https?:\/\/)[^\s<]+)/gi;

/**
 * Convert plain URLs in text into safe clickable links.
 * The input is first escaped to ensure no HTML sneaks through.
 */
export function linkify(text = '') {
  const escaped = escapeHtml(text);
  return escaped.replace(urlRegex, (match) => {
    const url = match.trim();
    try {
      const parsed = new URL(url);
      const safeHref = escapeHtml(parsed.href);
      return `<a href="${safeHref}" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">${safeHref}</a>`;
    } catch (err) {
      return escapeHtml(url);
    }
  });
}
