import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check3dImages } from '../scripts/check-3d-images.js';
import { cardTotal, checkPublishedImages } from '../scripts/check-profile-images.js';
import { renderCards } from '../scripts/render-profile-cards.js';

const OFFICIAL = {
  name: 'Hélio', totalPRs: 111, totalPRsMerged: 0, mergedPRsPercentage: 0, totalReviews: 0, totalCommits: 0, totalIssues: 12,
  totalStars: 0, totalDiscussionsStarted: 0, totalDiscussionsAnswered: 0, contributedTo: 2, allTimeContributedTo: 0,
  totalPRsAuthored: 0, totalPRsCommented: 0, totalPRsReviewed: 0, totalIssuesAuthored: 0, totalIssuesCommented: 0,
  totalContributions: 0, rank: { level: 'B-', percentile: 67 }
};
const ACTIVITY = {
  schema_version: 1, today: '2026-10-30',
  commits: { total: 775, last_30_days: 75, active_days: 2, first_day: '2025-05-27' },
  streaks: { current: { length: 1, start: '2026-10-30', end: '2026-10-30' }, longest: { length: 1, start: '2025-05-27', end: '2025-05-27' } },
  daily: { '2025-05-27': 700, '2026-10-30': 75 }, repositories: { analyzed: 1 }, coverage: { public: 'complete', private: 'complete' }
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>';

function publishedDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-images-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, svg] of Object.entries(renderCards(ACTIVITY, { stats: OFFICIAL, followers: 1 }).files)) fs.writeFileSync(path.join(dir, name), svg);
  fs.writeFileSync(path.join(dir, 'activity.json'), JSON.stringify(ACTIVITY));
  for (const name of ['top-langs.svg', 'top-langs-dark.svg']) fs.writeFileSync(path.join(dir, name), SVG);
  for (const theme of ['github', 'github_dark']) {
    fs.mkdirSync(path.join(dir, 'summary', theme), { recursive: true });
    for (const card of ['0-profile-details', '1-repos-per-language', '2-most-commit-language', '4-productive-time']) {
      fs.writeFileSync(path.join(dir, 'summary', theme, card + '.svg'), SVG);
    }
  }
  return dir;
}

test('a complete and consistent set of images passes', t => {
  assert.deepEqual(checkPublishedImages(publishedDir(t)), []);
});

test('the totals printed on both cards are read back exactly', t => {
  const dir = publishedDir(t);
  assert.equal(cardTotal('stats.svg', fs.readFileSync(path.join(dir, 'stats.svg'), 'utf8')), 775);
  assert.equal(cardTotal('all-activity-dark.svg', fs.readFileSync(path.join(dir, 'all-activity-dark.svg'), 'utf8')), 775);
});

test('missing images, error cards and cards out of step with activity.json are refused', t => {
  const dir = publishedDir(t);
  fs.rmSync(path.join(dir, 'summary/github_dark/4-productive-time.svg'));
  fs.writeFileSync(path.join(dir, 'top-langs.svg'), '<svg><text>Something went wrong! file an issue</text></svg>');
  fs.writeFileSync(path.join(dir, 'activity.json'), JSON.stringify({ ...ACTIVITY, commits: { ...ACTIVITY.commits, total: 800 }, daily: { '2026-10-30': 800 } }));
  const problems = checkPublishedImages(dir);
  assert.ok(problems.some(problem => problem.startsWith('summary/github_dark/4-productive-time.svg: missing')));
  assert.ok(problems.some(problem => problem.startsWith('top-langs.svg: is a renderer error card')));
  assert.ok(problems.some(problem => problem.startsWith('stats.svg: shows 775 commits but activity.json has 800')));
  assert.ok(problems.some(problem => problem.startsWith('all-activity.svg: shows 775 commits')));
});

test('3D images must show the activity total, the label and the window', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-3d-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings = JSON.parse(fs.readFileSync(new URL('../.github/profile-3d/settings.json', import.meta.url), 'utf8'));
  assert.equal(settings.length, 10);
  assert.ok(settings.every(entry => entry.l10n.contrib === 'commits'));
  const good = '<svg xmlns="http://www.w3.org/2000/svg"><text>75</text><text>commits</text><text>2025-10-26 / 2026-10-30</text></svg>';
  for (const { fileName } of settings) fs.writeFileSync(path.join(dir, fileName), good);
  // Only 2026-10-30 (75 commits) is inside the 3D window of 2026-10-30.
  assert.deepEqual(check3dImages(dir, ACTIVITY), []);
  fs.writeFileSync(path.join(dir, 'profile-night-rainbow.svg'), good.replace('commits', 'contributions'));
  fs.rmSync(path.join(dir, 'profile-gitblock.svg'));
  const problems = check3dImages(dir, ACTIVITY);
  assert.deepEqual(problems, ['profile-night-rainbow.svg: does not show "75 commits"', 'profile-gitblock.svg: missing']);
});
