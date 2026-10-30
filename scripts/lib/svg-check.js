// Sanity checks for generated SVGs before they are published: well-formed
// markup, no renderer error card and no internal/technical wording.
const ERROR_CARD = /Something went wrong/i;
// Wording that must not appear on the profile's own cards.
const INTERNAL_WORDING = [
  /\bclaude\b/i, /\bcodex\b/i, /\bIA\b/, /intelig[êe]ncia artificial/i, /\bAI\b/, /PROFILE_STATS_TOKEN/, /\btoken\b/i
];

function visibleText(svg) {
  return svg
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<path\b[^>]*>/gi, ' ');
}

// Returns a list of problems (empty when the SVG looks publishable).
export function checkSvg(svg, { mustContain = [], maxBytes = 2_000_000, ownCard = false } = {}) {
  const problems = [];
  if (typeof svg !== 'string' || !svg.trim()) return ['empty file'];
  if (Buffer.byteLength(svg) > maxBytes) problems.push('larger than ' + maxBytes + ' bytes');
  const trimmed = svg.trim();
  if (!/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(trimmed) || !trimmed.endsWith('</svg>')) problems.push('not an SVG document');

  const stack = [];
  const markup = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  for (const match of markup.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (!closing) {
      stack.push(name);
    } else if (stack.pop() !== name) {
      problems.push('unbalanced tag </' + name + '>');
      break;
    }
  }
  if (stack.length && !problems.some(problem => problem.startsWith('unbalanced'))) problems.push('unclosed tag <' + stack.at(-1) + '>');

  const text = visibleText(svg);
  if (ERROR_CARD.test(text)) problems.push('is a renderer error card');
  for (const pattern of ownCard ? INTERNAL_WORDING : []) {
    if (pattern.test(text)) problems.push('contains internal wording ' + pattern);
  }
  for (const expected of mustContain) {
    if (!svg.includes(expected)) problems.push('missing expected text "' + expected + '"');
  }
  return problems;
}
