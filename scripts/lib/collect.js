// Collects the commit history of every repository owned by the account and
// reduces it to aggregate activity. Only totals leave this module: repository
// names never reach the published data or the logs for private repositories.
import { createLedger, isGeneratedProfileBranch, normalizeCommit } from './activity.js';
import { TIME_ZONE } from './dates.js';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const METRIC_DESCRIPTION = 'Commits distintos (sem merges) de qualquer autor, em todas as branches ' +
  'dos repositórios próprios da conta, excluindo forks e as branches de imagens geradas do perfil.';

function sameLogin(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

// Public repositories come from the public listing (always complete); the
// owner token adds the private ones. Forks are other people's projects.
export async function listOwnedRepositories({ client, owner, includePrivate }) {
  const repositories = new Map();
  const forks = new Set();
  const consider = repo => {
    if (!repo || !sameLogin(repo.owner?.login, owner)) return;
    if (repo.fork) forks.add(repo.id);
    else repositories.set(repo.id, repo);
  };

  const listed = await client.paginate('/users/' + encodeURIComponent(owner) + '/repos', { type: 'owner' });
  listed.items.forEach(consider);
  if (includePrivate) {
    const identity = await client.request('/user');
    if (!sameLogin(identity.data?.login, owner)) {
      throw new Error('PROFILE_STATS_TOKEN must be a token of the ' + owner + ' account');
    }
    const owned = await client.paginate('/user/repos', { affiliation: 'owner', visibility: 'all' });
    owned.items.forEach(consider);
  }
  const sorted = Array.from(repositories.values())
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  return { repositories: sorted, forks: forks.size };
}

async function collectRepository({ client, owner, repo, ledger, totals }) {
  const base = '/repos/' + encodeURIComponent(repo.owner.login) + '/' + encodeURIComponent(repo.name);
  const listing = await client.paginate(base + '/branches');
  const branches = listing.items.filter(branch => !isGeneratedProfileBranch(owner, repo.name, branch.name));
  totals.excluded.generated_branches += listing.items.length - branches.length;
  if (listing.items.length === 0) totals.repositories.empty++;

  // Default branch first: branches already merged into it are then skipped
  // without another request, since their head is part of a known history.
  branches.sort((a, b) =>
    (b.name === repo.default_branch) - (a.name === repo.default_branch) || a.name.localeCompare(b.name));

  const scope = ledger.repository({ language: repo.language || null });
  for (const branch of branches) {
    const head = branch.commit?.sha;
    if (typeof head !== 'string' || !SHA_PATTERN.test(head)) {
      throw new Error('Malformed branch listing (missing head commit)');
    }
    if (scope.has(head)) {
      totals.branches.already_covered++;
      continue;
    }
    // Listing by head SHA keeps the snapshot consistent if the branch moves meanwhile.
    const history = await client.paginate(base + '/commits', { sha: head }, { allow: [409] });
    totals.branches.scanned++;
    for (const item of history.items) scope.add(normalizeCommit(item));
    if (!scope.has(head)) throw new Error('Branch history did not include its head commit; refusing a partial count');
  }
  if (scope.counted > 0) totals.repositories.with_commits++;
}

export async function collectActivity({
  client, owner, includePrivate, now = new Date(), timeZone = TIME_ZONE, log = () => {},
  listRepositories = listOwnedRepositories
}) {
  const { repositories, forks } = await listRepositories({ client, owner, includePrivate });
  const ledger = createLedger({ now, timeZone });
  const totals = {
    repositories: { analyzed: 0, with_commits: 0, public: 0, private: 0, archived: 0, empty: 0, forks_excluded: forks },
    branches: { scanned: 0, already_covered: 0 },
    excluded: { generated_branches: 0 }
  };

  for (const repo of repositories) {
    const label = repo.private ? 'a private repository' : repo.full_name;
    try {
      await collectRepository({ client, owner, repo, ledger, totals });
    } catch (error) {
      throw new Error('Collection failed for ' + label + ': ' + error.message, { cause: error });
    }
    totals.repositories.analyzed++;
    totals.repositories[repo.private ? 'private' : 'public']++;
    if (repo.archived) totals.repositories.archived++;
    log('scanned ' + totals.repositories.analyzed + '/' + repositories.length + ' repositories');
  }

  const summary = ledger.summary();
  return {
    schema_version: 1,
    owner,
    generated_at: now.toISOString(),
    time_zone: timeZone,
    today: summary.today,
    metric: METRIC_DESCRIPTION,
    commits: {
      total: summary.total,
      last_30_days: summary.last30,
      active_days: summary.activeDays,
      first_day: summary.firstDay
    },
    streaks: summary.streaks,
    daily: summary.daily,
    languages: summary.languages,
    repositories: totals.repositories,
    coverage: { public: 'complete', private: includePrivate ? 'complete' : 'not_configured' },
    excluded: { ...summary.excluded, generated_branches: totals.excluded.generated_branches },
    branches: totals.branches,
    api: { requests: client.requestCount, rate_limit_remaining: client.rateLimit?.remaining ?? null }
  };
}
