// The original GitHub Readme Stats card, rendered by its own code
// (@stats-organization/github-readme-stats-core, pinned in package.json) so the
// layout, icons and rank ring stay exactly as before. Only the commit total
// changes: it comes from the consolidated project activity. Stars, PRs, issues
// and "contributed to" keep their official GitHub values, and the rank is
// recalculated by the library's own formula with the all-time commit median.
const coreEntry = import.meta.resolve('@stats-organization/github-readme-stats-core');
const load = file => import(new URL(file, coreEntry).href);
const [{ renderStatsCard }, { fetchStats }, { calculateRank }] = await Promise.all([
  load('./cards/stats.js'),
  load('./fetchers/stats.js'),
  load('./calculateRank.js')
]);

// Same options the profile used before (include_all_commits=true). The long
// number format only matters from 1000 on: it prints the exact total, as the
// streak card does, instead of a rounded "1.2k".
export const STATS_CARD_OPTIONS = {
  show_icons: true,
  include_all_commits: true,
  hide_border: true,
  locale: 'pt-br',
  custom_title: 'Estatísticas do GitHub',
  number_format: 'long'
};
export const STATS_CARD_THEMES = { light: {}, dark: { theme: 'github_dark' } };

// Official numbers from GitHub. The commit search is skipped because that
// figure is replaced by the project activity total anyway.
export async function fetchOfficialStats(username, token) {
  return fetchStats(username, false, [], false, false, false, undefined, [], [], false, false, false, false, false, [], false, false, false, token);
}

export function withProjectCommits(stats, { commits, followers }) {
  if (!Number.isInteger(commits) || commits < 0) throw new RangeError('Invalid commit total: ' + commits);
  if (!Number.isInteger(followers) || followers < 0) throw new RangeError('Invalid follower count: ' + followers);
  return {
    ...stats,
    totalCommits: commits,
    rank: calculateRank({
      all_commits: true,
      commits,
      prs: stats.totalPRs,
      issues: stats.totalIssues,
      reviews: stats.totalReviews,
      repos: 0,
      stars: stats.totalStars,
      followers
    })
  };
}

export function renderStats(stats, username, theme) {
  if (!(theme in STATS_CARD_THEMES)) throw new RangeError('Unknown theme: ' + theme);
  return renderStatsCard(stats, { ...STATS_CARD_OPTIONS, ...STATS_CARD_THEMES[theme] }, username);
}

export { calculateRank, renderStatsCard };
