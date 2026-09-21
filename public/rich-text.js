const ALLOWED_PAIRED = new Set([
  'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
  'p', 'ul', 'ol', 'li', 'blockquote',
]);
// Tags whose markup is dropped while their inner text is kept.
const UNWRAP_TAGS = new Set(['span', 'font', 'div']);

const ENTITY_PATTERN = /&(amp|lt|gt|quot|#39|#x27);/g;
const ENTITY_VALUES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };

function decodeEntities(value) {
  return value.replace(ENTITY_PATTERN, (entity, name) => ENTITY_VALUES[name] ?? entity);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function extractHref(attributes) {
  const match = attributes.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`>]+))/i);
  return decodeEntities(match?.[2] ?? match?.[3] ?? match?.[4] ?? '');
}

function isSafeHref(href) {
  return /^(https?:\/\/)[^\s"'<>]+$/i.test(href.trim());
}

/**
 * Convert a bridge message body (plain text or Matrix HTML) into sanitized HTML
 * safe for innerHTML. Only a small presentational subset is kept; everything
 * else (scripts, event handlers, unsafe links, unknown tags) is escaped so it
 * renders as literal text.
 */
export function renderRichText(source) {
  const input = source ?? '';
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  let output = '';
  let lastIndex = 0;
  let openAnchors = 0;
  let match;
  while ((match = tagPattern.exec(input)) !== null) {
    output += escapeHtml(decodeEntities(input.slice(lastIndex, match.index)));
    const name = match[1].toLowerCase();
    const isClose = match[0][1] === '/';
    if (name === 'br' && !isClose) {
      output += '<br>';
    } else if (name === 'a' && !isClose) {
      const href = extractHref(match[2] ?? '');
      if (isSafeHref(href)) {
        output += `<a href="${escapeHtml(href.trim())}" target="_blank" rel="noopener noreferrer">`;
        openAnchors += 1;
      }
    } else if (name === 'a' && isClose) {
      if (openAnchors > 0) {
        output += '</a>';
        openAnchors -= 1;
      }
    } else if (ALLOWED_PAIRED.has(name)) {
      output += isClose ? `</${name}>` : `<${name}>`;
    } else if (!UNWRAP_TAGS.has(name)) {
      output += escapeHtml(match[0]);
    }
    lastIndex = tagPattern.lastIndex;
  }
  output += escapeHtml(decodeEntities(input.slice(lastIndex)));
  while (openAnchors > 0) {
    output += '</a>';
    openAnchors -= 1;
  }
  return output;
}

/** Plain-text single-line excerpt for quotes and previews. */
export function plainTextSnippet(source, max = 120) {
  const withoutBreaks = String(source ?? '').replace(/<br\s*\/?>/gi, ' ');
  const stripped = withoutBreaks.replace(/<[^<>]*>/g, '');
  const normalized = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
