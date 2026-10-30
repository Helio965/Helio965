import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateRank, renderStats, renderStatsCard, withProjectCommits } from '../scripts/lib/stats-card.js';
import { formatDay, formatRange, renderStreakCard, splitLines } from '../scripts/lib/streak-card.js';
import { checkSvg } from '../scripts/lib/svg-check.js';
import { renderCards } from '../scripts/render-profile-cards.js';
import { checkConsistency } from '../scripts/repository-activity.js';

const fixture = name => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');

// Official numbers shown on the card published on 2026-10-30.
const OFFICIAL = {
  name: 'Hélio', totalPRs: 111, totalPRsMerged: 0, mergedPRsPercentage: 0, totalReviews: 0, totalCommits: 0, totalIssues: 12,
  totalStars: 0, totalDiscussionsStarted: 0, totalDiscussionsAnswered: 0, contributedTo: 2, allTimeContributedTo: 0,
  totalPRsAuthored: 0, totalPRsCommented: 0, totalPRsReviewed: 0, totalIssuesAuthored: 0, totalIssuesCommented: 0,
  totalContributions: 0, rank: { level: 'B-', percentile: 66.99 }
};

function activity({ total = 775, current = { length: 8, start: '2026-10-23', end: '2026-10-30' } } = {}) {
  return {
    schema_version: 1, today: '2026-10-30',
    commits: { total, last_30_days: 449, active_days: 61, first_day: '2026-05-27' },
    streaks: { current, longest: { length: 17, start: '2026-09-29', end: '2026-10-15' } },
    daily: { '2026-10-30': total }, repositories: { analyzed: 26 }, coverage: { public: 'complete', private: 'complete' }
  };
}

test('the pinned renderer still draws the card exactly as it was published', () => {
  const published = fixture('published-stats-light.svg');
  const offset = Number(published.match(/stroke-dashoffset: ([\d.]+);\s*}\s*}/)[1]);
  const rank = { level: 'B-', percentile: offset / 251.32741228718345 * 100 };
  const options = { show_icons: true, hide: ['commits'], hide_border: true, locale: 'pt-br', custom_title: 'Estatísticas do GitHub' };
  assert.equal(renderStatsCard({ ...OFFICIAL, rank }, options, 'Helio965'), published);
  assert.equal(renderStatsCard({ ...OFFICIAL, rank }, { ...options, theme: 'github_dark' }, 'Helio965'), fixture('published-stats-dark.svg'));
});

test('the streak replica matches the hosted Streak Stats card byte for byte', () => {
  const data = { total: 495, firstDay: '2022-04-26', current: { length: 1, start: '2026-10-30', end: '2026-10-30' },
    longest: { length: 17, start: '2026-09-29', end: '2026-10-15' }, today: '2026-10-30' };
  const labels = { total: 'Total de Contribuições', current: 'Sequência Atual', longest: 'Maior Sequência', present: 'Presente' };
  assert.equal(renderStreakCard(data, 'light', labels), fixture('streak-stats-light.svg'));
  assert.equal(renderStreakCard(data, 'dark', labels), fixture('streak-stats-dark.svg'));
});

test('the stats card shows the consolidated total and keeps the official numbers', () => {
  const card = withProjectCommits(OFFICIAL, { commits: 775, followers: 1 });
  assert.equal(card.totalCommits, 775);
  assert.deepEqual(card.rank, calculateRank({ all_commits: true, commits: 775, prs: 111, issues: 12, reviews: 0, repos: 0, stars: 0, followers: 1 }));
  const svg = renderStats(card, 'Helio965', 'light');
  for (const text of ['Estat&#237;sticas do GitHub', 'Total de Commits:', 'data-testid="commits"', '>775<', 'Total de PRs:', 'Total de Issues:']) {
    assert.ok(svg.includes(text) || svg.replace(/\s+/g, '').includes(text.replace(/\s+/g, '')), text);
  }
  assert.match(svg, /height="195"/);
  assert.match(renderStats(card, 'Helio965', 'dark'), /fill="#0D1117"/);
  assert.throws(() => withProjectCommits(OFFICIAL, { commits: -1, followers: 1 }), RangeError);
});

test('large totals are printed in full so both cards show the same number', () => {
  const card = withProjectCommits(OFFICIAL, { commits: 1234, followers: 1 });
  assert.ok(renderStats(card, 'Helio965', 'light').replace(/\s+/g, '').includes('>1234<'));
  const streak = renderStreakCard({ total: 1234, firstDay: '2026-05-27', current: { length: 0, start: null, end: null },
    longest: { length: 17, start: '2026-09-29', end: '2026-10-15' }, today: '2026-10-30' });
  assert.match(streak, /\s1\.234\s/);
});

test('streak card labels, values and date ranges', () => {
  const svg = renderStreakCard({ total: 775, firstDay: '2026-05-27', current: { length: 8, start: '2026-10-23', end: '2026-10-30' },
    longest: { length: 17, start: '2026-09-29', end: '2026-10-15' }, today: '2026-10-30' });
  for (const text of ['Total de Commits', 'Dias Consecutivos', 'Maior Sequência', '27 de mai. - Presente', '23 de out. - 30 de out.', '29 de set. - 15 de out.']) {
    assert.ok(svg.includes(text), text);
  }
  assert.match(svg, />\s+775\s+</);
  assert.match(svg, />\s+8\s+</);
  assert.match(svg, />\s+17\s+</);
  assert.deepEqual(checkSvg(svg, { ownCard: true }), []);
});

test('with no active streak the card shows zero and today, like the original', () => {
  const svg = renderStreakCard({ total: 10, firstDay: '2025-12-30', current: { length: 0, start: null, end: null },
    longest: { length: 2, start: '2025-12-30', end: '2025-12-31' }, today: '2026-01-02' });
  assert.match(svg, />\s+0\s+</);
  assert.ok(svg.includes('2 de jan.'));
  // Dates from another year carry the year; long ranges wrap like Streak Stats.
  assert.ok(svg.includes(`<tspan x='0' dy='0'>30 de dez. de 2025</tspan><tspan x='0' dy='16'>- 31 de dez. de 2025</tspan>`));
});

test('date helpers follow the pt-BR formats of the original card', () => {
  assert.equal(formatDay('2026-10-30', '2026'), '30 de out.');
  assert.equal(formatDay('2022-04-26', '2026'), '26 de abr. de 2022');
  assert.equal(formatRange('2026-12-20', '2027-01-03', '2027'), '20 de dez. de 2026 - 3 de jan.');
  assert.equal(formatRange('2026-10-30', '2026-10-30', '2026'), '30 de out.');
  assert.equal(splitLines('26 de abr. de 2022 - Presente', 27, 0), `<tspan x='0' dy='0'>26 de abr. de 2022</tspan><tspan x='0' dy='16'>- Presente</tspan>`);
  assert.equal(splitLines('Dias Consecutivos', 22, -9), 'Dias Consecutivos');
  assert.equal(splitLines('Total de Commits & PRs <x>', 30, -9), 'Total de Commits &amp; PRs &lt;x&gt;');
});

test('both cards are rendered from one activity file and always agree', () => {
  const { files, rank } = renderCards(activity(), { stats: OFFICIAL, followers: 1 });
  assert.deepEqual(Object.keys(files).sort(), ['all-activity-dark.svg', 'all-activity.svg', 'stats-dark.svg', 'stats.svg']);
  for (const [name, svg] of Object.entries(files)) {
    assert.deepEqual(checkSvg(svg, { ownCard: true }), [], name);
    assert.ok(svg.replace(/\s+/g, '').includes('>775<'), name + ' shows the same total');
    assert.ok(!/claude|codex|\bIA\b|PROFILE_STATS_TOKEN|humanos/i.test(svg.replace(/<!--[\s\S]*?-->/g, '')), name);
  }
  assert.equal(typeof rank.level, 'string');
});

test('SVG checks catch broken or unsuitable images', () => {
  assert.deepEqual(checkSvg('<svg><g><text>ok</text></g></svg>'), []);
  assert.ok(checkSvg('').length);
  assert.ok(checkSvg('<svg><g></svg>').some(problem => problem.includes('unbalanced')));
  assert.ok(checkSvg('<svg><text>Something went wrong</text></svg>').some(problem => problem.includes('error card')));
  assert.ok(checkSvg('<svg><text>Autores humanos e IA</text></svg>', { ownCard: true }).some(problem => problem.includes('internal wording')));
  assert.ok(checkSvg('<svg><text>Inclui commits de Claude</text></svg>', { ownCard: true }).length);
  assert.deepEqual(checkSvg('<svg><text>Inclui commits de Claude</text></svg>'), [], 'third-party cards are not checked for wording');
  assert.ok(checkSvg('<svg><text>1</text></svg>', { mustContain: ['775'] }).some(problem => problem.includes('775')));
  assert.ok(checkSvg('<html></html>').some(problem => problem.includes('not an SVG')));
});

test('a sharp drop with unchanged coverage is refused as partial data', () => {
  const previous = activity({ total: 775 });
  assert.deepEqual(checkConsistency(activity({ total: 770 }), previous), []);
  assert.equal(checkConsistency(activity({ total: 600 }), previous).length, 1);
  assert.deepEqual(checkConsistency(activity({ total: 600 }), previous, { allowDrop: true }), []);
  const lostCoverage = { ...activity({ total: 579 }), coverage: { public: 'complete', private: 'not_configured' } };
  assert.deepEqual(checkConsistency(lostCoverage, previous), [], 'a coverage change explains the drop');
  const broken = { ...activity(), daily: { '2026-10-30': 1 } };
  assert.ok(checkConsistency(broken, null).some(problem => problem.includes('daily counts')));
});
