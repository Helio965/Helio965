// Checks the 3D images before they replace the output-3d branch: all ten
// files exist, are valid SVGs and print the commit total of the calendar
// window built from activity.json, labelled "commits".
//   node scripts/check-3d-images.js <svg dir> <activity.json>
import fs from 'node:fs';
import path from 'node:path';
import { buildCalendar } from './contribution-calendar-endpoint.js';
import { checkSvg } from './lib/svg-check.js';

const settingsFile = new URL('../.github/profile-3d/settings.json', import.meta.url);

export function check3dImages(dir, activity) {
  const problems = [];
  const { total, start, end } = buildCalendar(activity);
  // Same grouping as the action: plain up to 9999, then "12 345".
  const expectedTotal = total <= 9999 ? String(total) : String(total).replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1 ');
  for (const { fileName } of JSON.parse(fs.readFileSync(settingsFile, 'utf8'))) {
    const file = path.join(dir, fileName);
    if (!fs.existsSync(file)) {
      problems.push(fileName + ': missing');
      continue;
    }
    const svg = fs.readFileSync(file, 'utf8');
    problems.push(...checkSvg(svg).map(problem => fileName + ': ' + problem));
    // The big total is the bold "fill-strong" text right before its label;
    // other texts (radar scale "1", "10", "100"...) must not satisfy the check.
    const total = svg.match(/<text[^>]*class="fill-strong"[^>]*>([^<]*)<\/text>\s*<text[^>]*>commits<\/text>/);
    if (!total || total[1].trim() !== expectedTotal) {
      problems.push(fileName + ': does not show "' + expectedTotal + ' commits"');
    }
    const texts = Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g), match => match[1].trim());
    if (!texts.includes(start + ' / ' + end)) problems.push(fileName + ': does not cover ' + start + ' / ' + end);
  }
  return problems;
}

if (import.meta.url === 'file://' + path.resolve(process.argv[1] || '')) {
  const [dir = 'profile-3d-contrib', activityFile = 'activity.json'] = process.argv.slice(2);
  const problems = check3dImages(dir, JSON.parse(fs.readFileSync(activityFile, 'utf8')));
  for (const problem of problems) console.log('::error title=Gráfico 3D::' + problem);
  if (problems.length) process.exitCode = 1;
  else console.log('All 3D images show the project activity of activity.json.');
}
