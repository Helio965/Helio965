// Renders the two statistics cards of the README from the collected activity:
//   stats.svg / stats-dark.svg               GitHub Readme Stats card
//   all-activity.svg / all-activity-dark.svg Streak Stats card
// Both show the same consolidated commit total. Everything is rendered and
// checked in memory first; only then are activity.json and the four SVGs
// written together, so the published cards can never disagree with each other.
import fs from 'node:fs';
import path from 'node:path';
import { createGitHubClient } from './lib/github-api.js';
import { renderStreakCard } from './lib/streak-card.js';
import { checkSvg } from './lib/svg-check.js';
import { fetchOfficialStats, renderStats, withProjectCommits } from './lib/stats-card.js';

const owner = process.env.GITHUB_REPOSITORY_OWNER || 'Helio965';
const activityFile = process.env.ACTIVITY_FILE || 'build/activity.json';
const outputDir = process.env.CARDS_OUTPUT || 'dist';
// Local previews only: official numbers from a JSON file instead of the API.
const officialStatsFile = process.env.OFFICIAL_STATS_FILE || '';

export function readActivity(file) {
  const activity = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { commits, streaks, today } = activity;
  if (activity.schema_version !== 1 || !Number.isInteger(commits?.total) || !streaks?.current || !streaks?.longest || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(file + ' is not a complete activity file');
  }
  return activity;
}

async function officialNumbers() {
  if (officialStatsFile) return JSON.parse(fs.readFileSync(officialStatsFile, 'utf8'));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required to read the official GitHub statistics');
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const stats = await fetchOfficialStats(owner, token);
      const { data } = await createGitHubClient({ token }).request('/users/' + encodeURIComponent(owner));
      return { stats, followers: data.followers };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 15000));
    }
  }
  throw new Error('Could not read the official GitHub statistics: ' + (lastError?.message || lastError));
}

export function renderCards(activity, { stats, followers }) {
  const card = withProjectCommits(stats, { commits: activity.commits.total, followers });
  const streak = {
    total: activity.commits.total,
    firstDay: activity.commits.first_day,
    current: activity.streaks.current,
    longest: activity.streaks.longest,
    today: activity.today
  };
  const totals = {
    stats: String(activity.commits.total),
    streak: new Intl.NumberFormat('pt-BR').format(activity.commits.total)
  };
  const files = {
    'stats.svg': renderStats(card, owner, 'light'),
    'stats-dark.svg': renderStats(card, owner, 'dark'),
    'all-activity.svg': renderStreakCard(streak, 'light'),
    'all-activity-dark.svg': renderStreakCard(streak, 'dark')
  };
  const problems = [];
  for (const [name, svg] of Object.entries(files)) {
    const expected = [name.startsWith('stats') ? totals.stats : totals.streak];
    for (const problem of checkSvg(svg, { ownCard: true, mustContain: expected })) problems.push(name + ': ' + problem);
  }
  if (problems.length) throw new Error('Generated cards failed validation: ' + problems.join('; '));
  return { files, rank: card.rank };
}

async function main() {
  const activity = readActivity(activityFile);
  const official = await officialNumbers();
  const { files, rank } = renderCards(activity, official);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(outputDir, name), svg, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'activity.json'), JSON.stringify(activity, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    total_commits: activity.commits.total,
    current_streak: activity.streaks.current.length,
    longest_streak: activity.streaks.longest.length,
    stars: official.stats.totalStars,
    pull_requests: official.stats.totalPRs,
    issues: official.stats.totalIssues,
    rank: rank.level
  }));
}

if (import.meta.url === 'file://' + path.resolve(process.argv[1] || '')) {
  main().catch(error => {
    console.log('::error title=Cartões de estatísticas::' + error.message);
    process.exitCode = 1;
  });
}
