import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectActivity } from '../scripts/lib/collect.js';

const NOW = new Date('2026-10-30T18:00:00Z');
const sha = label => Buffer.from(label).toString('hex').padEnd(40, '0');

// In-memory GitHub: repositories with commit graphs and branch heads.
function fakeGitHub({ login = 'Helio965', repos }) {
  const calls = [];
  const byName = new Map(repos.map(repo => [repo.name, repo]));
  const history = (repo, head) => {
    const seen = new Set();
    const order = [];
    const visit = id => {
      if (seen.has(id)) return;
      seen.add(id);
      order.push(id);
      repo.commits[id].parents.forEach(visit);
    };
    visit(head);
    return order.map(id => {
      const commit = repo.commits[id];
      return {
        sha: sha(id),
        commit: {
          author: { name: commit.author || 'Hélio', email: commit.email || 'helio@example.com', date: commit.date },
          committer: { name: 'GitHub', email: 'noreply@github.com', date: commit.date },
          message: commit.message || 'change ' + id
        },
        author: commit.login === undefined ? { login: 'Helio965' } : commit.login && { login: commit.login },
        parents: commit.parents.map(parent => ({ sha: sha(parent) }))
      };
    });
  };
  const meta = repo => ({
    id: repo.id, name: repo.name, full_name: (repo.owner || 'Helio965') + '/' + repo.name, owner: { login: repo.owner || 'Helio965' },
    private: Boolean(repo.private), fork: Boolean(repo.fork), archived: Boolean(repo.archived), default_branch: 'main'
  });
  const client = {
    requestCount: 0,
    rateLimit: { remaining: 4999 },
    async request(path) {
      calls.push(path);
      if (path === '/user') return { data: { login } };
      throw new Error('unexpected ' + path);
    },
    async paginate(path, params = {}) {
      calls.push(path + (params.sha ? '@' + params.sha.slice(0, 6) : ''));
      if (path === '/users/Helio965/repos') return { items: repos.filter(repo => !repo.private).map(meta) };
      if (path === '/user/repos') return { items: repos.map(meta) };
      const match = path.match(/^\/repos\/Helio965\/([^/]+)\/(branches|commits)$/);
      const repo = match && byName.get(decodeURIComponent(match[1]));
      if (!repo) throw new Error('GitHub API 404 at /repos/:owner/:repo');
      if (repo.fail) throw new Error('GitHub API 500 at /repos/:owner/:repo/' + match[2]);
      if (match[2] === 'branches') {
        return { items: Object.entries(repo.branches).map(([name, head]) => ({ name, commit: { sha: sha(head) } })) };
      }
      const head = Object.keys(repo.commits).find(id => sha(id) === params.sha);
      return { items: history(repo, head) };
    }
  };
  return { client, calls };
}

const day = value => value + 'T12:00:00-03:00';
const REPOS = () => [
  {
    id: 1, name: 'Helio965',
    commits: {
      c1: { parents: [], date: day('2026-10-28') },
      c2: { parents: ['c1'], date: day('2026-10-29') },
      c3: { parents: ['c2'], date: day('2026-10-30'), author: 'Claude', email: 'noreply@anthropic.com', login: null },
      o1: { parents: [], date: day('2026-10-30'), author: 'github-actions[bot]', login: 'github-actions[bot]' }
    },
    branches: { main: 'c2', 'claude/feature': 'c3', 'output-stats': 'o1' }
  },
  {
    id: 2, name: 'Connectagro', archived: true,
    commits: {
      m1: { parents: [], date: day('2026-10-20') },
      f1: { parents: ['m1'], date: day('2026-10-21'), author: 'Codex', email: 'codex@example.com', login: null },
      m2: { parents: ['m1', 'f1'], date: day('2026-10-22'), message: 'Merge pull request #3' }
    },
    branches: { main: 'm2', 'codex/feature': 'f1' }
  },
  { id: 3, name: 'Empty', commits: {}, branches: {} },
  { id: 4, name: 'Kernel', private: true, commits: { k1: { parents: [], date: day('2026-10-24'), author: 'Claude', login: null } }, branches: { main: 'k1' } },
  { id: 5, name: 'MedAlert-CLI', fork: true, commits: {}, branches: {} },
  { id: 6, name: 'Someone-Else', owner: 'someone', commits: {}, branches: {} }
];

test('collects public and private repositories with every rule applied once', async () => {
  const { client, calls } = fakeGitHub({ repos: REPOS() });
  const activity = await collectActivity({ client, owner: 'Helio965', includePrivate: true, now: NOW });
  assert.equal(activity.commits.total, 6);
  assert.deepEqual(activity.daily, {
    '2026-10-20': 1, '2026-10-21': 1, '2026-10-24': 1, '2026-10-28': 1, '2026-10-29': 1, '2026-10-30': 1
  });
  assert.deepEqual(activity.repositories, { analyzed: 4, with_commits: 3, public: 3, private: 1, archived: 1, empty: 1, forks_excluded: 1 });
  assert.deepEqual(activity.coverage, { public: 'complete', private: 'complete' });
  assert.equal(activity.excluded.merge_commits, 1);
  assert.equal(activity.excluded.generated_branches, 1);
  assert.equal(activity.excluded.automation_commits, 0, 'output branches are skipped before reading them');
  // codex/feature was merged into main, so its history is not requested again.
  assert.deepEqual(activity.branches, { scanned: 4, already_covered: 1 });
  assert.ok(!calls.some(call => call.includes('output-stats') || call.endsWith('@' + sha('o1').slice(0, 6))));
  assert.deepEqual(activity.streaks.current, { length: 3, start: '2026-10-28', end: '2026-10-30' });
  assert.equal(activity.commits.last_30_days, 6);
  assert.ok(!JSON.stringify(activity).includes('Kernel'), 'private repository names stay out of the data');
});

test('without the owner token only public repositories are read and coverage says so', async () => {
  const { client, calls } = fakeGitHub({ repos: REPOS() });
  const activity = await collectActivity({ client, owner: 'Helio965', includePrivate: false, now: NOW });
  assert.equal(activity.commits.total, 5);
  assert.equal(activity.repositories.private, 0);
  assert.equal(activity.coverage.private, 'not_configured');
  assert.ok(!calls.includes('/user') && !calls.includes('/user/repos'));
});

test('a token of another account is refused', async () => {
  const { client } = fakeGitHub({ login: 'someone', repos: REPOS() });
  await assert.rejects(collectActivity({ client, owner: 'Helio965', includePrivate: true, now: NOW }), /must be a token of the Helio965 account/);
});

test('a failure stops the collection and never names a private repository', async () => {
  const repos = REPOS();
  repos.find(repo => repo.name === 'Kernel').fail = true;
  const { client } = fakeGitHub({ repos });
  await assert.rejects(collectActivity({ client, owner: 'Helio965', includePrivate: true, now: NOW }), error =>
    /Collection failed for a private repository/.test(error.message) && !error.message.includes('Kernel'));

  const publicFailure = REPOS();
  publicFailure.find(repo => repo.name === 'Connectagro').fail = true;
  const second = fakeGitHub({ repos: publicFailure });
  await assert.rejects(collectActivity({ client: second.client, owner: 'Helio965', includePrivate: true, now: NOW }),
    /Collection failed for Helio965\/Connectagro/);
});

test('a branch listing without head commit is treated as an incomplete response', async () => {
  const { client } = fakeGitHub({ repos: REPOS() });
  const original = client.paginate;
  client.paginate = async (path, params) => path.endsWith('/branches') ? { items: [{ name: 'main', commit: null }] } : original(path, params);
  await assert.rejects(collectActivity({ client, owner: 'Helio965', includePrivate: false, now: NOW }), /Malformed branch listing/);
});
