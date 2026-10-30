import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, isGeneratedProfileBranch, normalizeCommit } from '../scripts/lib/activity.js';

const NOW = new Date('2026-10-30T18:00:00Z');
let counter = 0;

// A REST "list commits" item, as returned by GET /repos/{owner}/{repo}/commits.
function item({ sha, date = '2026-10-29T15:00:00Z', committed = date, name = 'Hélio', email = '104467415+Helio965@users.noreply.github.com',
  login = 'Helio965', parents = 1, message = 'feat: change ' + (++counter) } = {}) {
  return {
    sha: sha || String(++counter).padStart(40, 'a'),
    commit: { author: { name, email, date }, committer: { name, email, date: committed }, message },
    author: login ? { login } : null,
    parents: Array.from({ length: parents }, (_, index) => ({ sha: String(index).padStart(40, 'f') }))
  };
}

function ledgerWith(...repositories) {
  const ledger = createLedger({ now: NOW });
  const results = repositories.map(commits => {
    const scope = ledger.repository();
    return commits.map(commit => scope.add(normalizeCommit(commit)));
  });
  return { summary: ledger.summary(), results };
}

test('commits by the owner, Claude, Codex and collaborators all count', () => {
  const { summary, results } = ledgerWith([
    item(),
    item({ name: 'Claude', email: 'noreply@anthropic.com', login: null }),
    item({ name: 'Codex', email: 'codex@openai.com', login: 'chatgpt-codex-connector[bot]' }),
    item({ name: 'João César', email: 'joao@example.com', login: 'JoaoCesarDev22' })
  ]);
  assert.deepEqual(results[0], ['counted', 'counted', 'counted', 'counted']);
  assert.equal(summary.total, 4);
  assert.deepEqual(summary.daily, { '2026-10-29': 4 });
});

test('the same SHA reached from several branches or repositories is counted once', () => {
  const shared = item();
  const { summary, results } = ledgerWith([shared, item(), shared], [shared]);
  assert.deepEqual(results, [['counted', 'counted', 'seen'], ['seen']]);
  assert.equal(summary.total, 2);
});

test('merge commits are not counted again on top of the merged work', () => {
  const { summary, results } = ledgerWith([item({ parents: 2, message: 'Merge pull request #12 from Helio965/feature' }), item(), item({ parents: 0 })]);
  assert.deepEqual(results[0], ['merge', 'counted', 'counted']);
  assert.equal(summary.total, 2);
  assert.equal(summary.excluded.merge_commits, 1);
});

test('a rebased or cherry-picked copy of a commit is counted once', () => {
  const original = item({ message: 'fix: horário de Brasília\n\nbody', date: '2026-10-27T12:00:00Z' });
  const copy = item({ message: 'fix: horário de Brasília\n\nbody', date: '2026-10-27T12:00:00Z', committed: '2026-10-28T09:00:00Z' });
  const { summary, results } = ledgerWith([original, copy], [{ ...copy, sha: 'c'.repeat(40) }]);
  assert.deepEqual(results, [['counted', 'duplicate'], ['counted']]);
  assert.equal(summary.total, 2);
  assert.equal(summary.excluded.duplicate_copies, 1);
});

test('GitHub Actions commits are automation, not development', () => {
  const { summary, results } = ledgerWith([
    item({ name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com', login: 'github-actions[bot]' }),
    item({ login: 'github-actions[bot]' })
  ]);
  assert.deepEqual(results[0], ['automation', 'automation']);
  assert.equal(summary.total, 0);
});

test('only the output branches of the profile repository are generated images', () => {
  for (const branch of ['output', 'output-stats', 'output-3d', 'output-arcade']) {
    assert.equal(isGeneratedProfileBranch('Helio965', 'Helio965', branch), true, branch);
  }
  assert.equal(isGeneratedProfileBranch('Helio965', 'helio965', 'output-stats'), true);
  assert.equal(isGeneratedProfileBranch('Helio965', 'Helio965', 'main'), false);
  assert.equal(isGeneratedProfileBranch('Helio965', 'Helio965', 'outputs'), false);
  assert.equal(isGeneratedProfileBranch('Helio965', 'Connectagro', 'output-stats'), false);
});

test('days follow America/Sao_Paulo, including commits right after UTC midnight', () => {
  const { summary } = ledgerWith([
    item({ date: '2026-10-24T02:59:59Z' }),
    item({ date: '2026-10-24T03:00:00Z' }),
    item({ date: '2026-10-23T23:50:00-03:00' })
  ]);
  assert.deepEqual(summary.daily, { '2026-10-23': 2, '2026-10-24': 1 });
});

test('the author date counts, not the date the commit was published', () => {
  const { summary } = ledgerWith([item({ date: '2026-10-22T23:40:00-03:00', committed: '2026-10-23T00:20:00-03:00' })]);
  assert.deepEqual(summary.daily, { '2026-10-22': 1 });
});

test('a future author date falls back to the committer date or is left out', () => {
  const { summary } = ledgerWith([
    item({ date: '2027-01-01T00:00:00Z', committed: '2026-10-28T12:00:00Z' }),
    item({ date: '2027-01-01T00:00:00Z', committed: '2027-01-01T00:00:00Z' })
  ]);
  assert.deepEqual(summary.daily, { '2026-10-28': 1 });
  assert.equal(summary.excluded.future_dated, 1);
});

test('the 30-day window includes today and the 29 previous days', () => {
  const { summary } = ledgerWith([
    item({ date: '2026-10-30T12:00:00Z' }),
    item({ date: '2026-10-01T12:00:00Z' }),
    item({ date: '2026-09-30T12:00:00Z' })
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.last30, 2);
  assert.equal(summary.firstDay, '2026-09-30');
  assert.equal(summary.activeDays, 3);
});

test('streaks come from the same daily counts as the totals', () => {
  const days = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
  const { summary } = ledgerWith(days.map(day => item({ date: day + 'T12:00:00-03:00' })));
  assert.deepEqual(summary.streaks.current, { length: 8, start: '2026-10-23', end: '2026-10-30' });
  assert.equal(Object.values(summary.daily).reduce((sum, value) => sum + value, 0), summary.total);
});

test('malformed API items are refused instead of being guessed', () => {
  assert.throws(() => normalizeCommit({ sha: 'xyz', commit: {}, parents: [] }), /sha/);
  assert.throws(() => normalizeCommit({ sha: 'a'.repeat(40), commit: { author: {} }, parents: [] }), /Malformed/);
  assert.throws(() => normalizeCommit({ sha: 'a'.repeat(40), commit: { author: { date: '2026-10-01T00:00:00Z' } } }), /Malformed/);
});
