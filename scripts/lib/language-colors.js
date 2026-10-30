// Linguist colors shipped with github-readme-stats-core, the same palette the
// language cards use, so every chart colors a language the same way.
import fs from 'node:fs';

const file = new URL('./common/languageColors.json', import.meta.resolve('@stats-organization/github-readme-stats-core'));
const COLORS = JSON.parse(fs.readFileSync(file, 'utf8'));

export function languageColor(name) {
  return Object.hasOwn(COLORS, name) ? COLORS[name] : null;
}
