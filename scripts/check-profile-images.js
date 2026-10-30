// Checks the files about to be published on the output-stats branch: every
// image the README uses must exist and be a valid SVG, and the profile's own
// cards must agree with activity.json. Exits non-zero (and the workflow skips
// the deploy) instead of publishing a broken or inconsistent set.
import fs from 'node:fs';
import path from 'node:path';
import { readActivity } from './render-profile-cards.js';
import { checkSvg } from './lib/svg-check.js';

const OWN_CARDS = ['stats.svg', 'stats-dark.svg', 'all-activity.svg', 'all-activity-dark.svg'];
const THIRD_PARTY = [
  'top-langs.svg', 'top-langs-dark.svg',
  ...['github', 'github_dark'].flatMap(theme =>
    ['0-profile-details', '1-repos-per-language', '2-most-commit-language', '4-productive-time']
      .map(card => 'summary/' + theme + '/' + card + '.svg'))
];

// The commit total printed on one of the profile's own cards.
export function cardTotal(name, svg) {
  const match = name.startsWith('stats')
    ? svg.match(/data-testid="commits"\s*>\s*([\d.]+)\s*</)
    : svg.match(/<!-- Total Contributions big number -->\s*<g[^>]*>\s*<text[^>]*>\s*([\d.]+)\s*</);
  return match ? Number(match[1].replace(/\./g, '')) : null;
}

export function checkPublishedImages(dir) {
  const problems = [];
  const read = name => {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  };

  let activity = null;
  try {
    activity = readActivity(path.join(dir, 'activity.json'));
  } catch (error) {
    problems.push('activity.json: ' + error.message);
  }
  for (const name of OWN_CARDS) {
    const svg = read(name);
    if (svg === null) {
      problems.push(name + ': missing');
      continue;
    }
    for (const problem of checkSvg(svg, { ownCard: true })) problems.push(name + ': ' + problem);
    const total = cardTotal(name, svg);
    if (activity && total !== activity.commits.total) {
      problems.push(name + ': shows ' + total + ' commits but activity.json has ' + activity.commits.total);
    }
  }
  for (const name of THIRD_PARTY) {
    const svg = read(name);
    if (svg === null) problems.push(name + ': missing');
    else for (const problem of checkSvg(svg)) problems.push(name + ': ' + problem);
  }
  return problems;
}

if (import.meta.url === 'file://' + path.resolve(process.argv[1] || '')) {
  const dir = process.argv[2] || 'dist';
  const problems = checkPublishedImages(dir);
  for (const problem of problems) console.log('::error title=Imagem do perfil::' + problem);
  if (problems.length) process.exitCode = 1;
  else console.log('All ' + (OWN_CARDS.length + THIRD_PARTY.length) + ' images and activity.json are valid and consistent.');
}
