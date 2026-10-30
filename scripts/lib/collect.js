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
// owner token adds the private ones it can read. A token never reveals the
// private repositories it was not granted, so private coverage is 'complete'
// only when GitHub reports the account's private repository count and every
// one of them was listed; otherwise it is 'token' (all the token can read).
// Forks are other people's projects.
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
  let privateCoverage = 'not_configured';
  if (includePrivate) {
    const identity = await client.request('/user');
    if (!sameLogin(identity.data?.login, owner)) {
      throw new Error('PROFILE_STATS_TOKEN must be a token of the ' + owner + ' account');
    }
    const owned = await client.paginate('/user/repos', { affiliation: 'owner', visibility: 'all' });
    owned.items.forEach(consider);
    const privateListed = owned.items.filter(repo => repo?.private && sameLogin(repo.owner?.login, owner)).length;
    const privateTotal = identity.data.owned_private_repos;
    if (Number.isInteger(privateTotal) && privateListed < privateTotal) {
      throw new Error('PROFILE_STATS_TOKEN reads ' + privateListed + ' of the ' + privateTotal +
        ' private repositories of ' + owner + '; give it access to all repositories');
    }
    privateCoverage = Number.isInteger(privateTotal) ? 'complete' : 'token';
  }
  const sorted = Array.from(repositories.values())
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  return { repositories: sorted, forks: forks.size, privateCoverage };
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
  const squashCandidates = [];
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
    for (const item of history.items) {
      const commit = normalizeCommit(item);
      const pull = commit.subject.match(SQUASH_SUBJECT);
      if (scope.add(commit) === 'counted' && commit.parentCount === 1 && pull) {
        squashCandidates.push({ sha: commit.sha, number: Number(pull[1]) });
      }
    }
    if (!scope.has(head)) throw new Error('Branch history did not include its head commit; refusing a partial count');
  }
  for (const candidate of squashCandidates) {
    if (await isSquashOfCountedWork({ client, base, scope, ...candidate })) scope.discountSquash(candidate.sha);
  }
  if (scope.counted > 0) totals.repositories.with_commits++;
}

// "Title (#12)" is how GitHub names a squash merge of pull request 12.
const SQUASH_SUBJECT = /\(#(\d+)\)$/;

// A squash merge repeats the work of its pull request. It is left out only
// when GitHub confirms it is that pull request's merge commit and at least
// one original commit of the pull request is counted (its branch still
// exists); otherwise it is the only record of the work and keeps counting.
// Without permission to read pull requests the commit keeps counting.
async function isSquashOfCountedWork({ client, base, scope, sha, number }) {
  const pull = await client.request(base + '/pulls/' + number, {}, { allow: [403, 404] });
  if (pull.data?.merge_commit_sha !== sha) return false;
  const commits = await client.paginate(base + '/pulls/' + number + '/commits', {}, { allow: [403, 404] });
  return commits.items.some(item => item?.sha !== sha && scope.isCounted(item?.sha));
}

export async function collectActivity({
  client, owner, includePrivate, now = new Date(), timeZone = TIME_ZONE, log = () => {},
  listRepositories = listOwnedRepositories
}) {
  const { repositories, forks, privateCoverage = includePrivate ? 'token' : 'not_configured' } =
    await listRepositories({ client, owner, includePrivate });
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
    coverage: { public: 'complete', private: privateCoverage },
    excluded: { ...summary.excluded, generated_branches: totals.excluded.generated_branches },
    branches: totals.branches,
    api: { requests: client.requestCount, rate_limit_remaining: client.rateLimit?.remaining ?? null }
  };
}
