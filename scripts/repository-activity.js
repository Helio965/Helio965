// Collects the project activity of the profile owner and writes
// dist/activity.json, the data every custom profile card is rendered from.
// PROFILE_STATS_TOKEN (read-only token of the owner) adds private repositories;
// without it only public repositories are read and the coverage says so.
// Refuses to write anything it cannot vouch for: on any API failure, or when
// the total drops sharply while coverage did not change, the previously
// published file stays in place and the step fails.
import fs from 'node:fs';
import path from 'node:path';
import { collectActivity } from './lib/collect.js';
import { createGitHubClient } from './lib/github-api.js';
import { languageColor } from './lib/language-colors.js';

const owner = process.env.GITHUB_REPOSITORY_OWNER || 'Helio965';
const privateToken = process.env.PROFILE_STATS_TOKEN || '';
const output = process.env.ACTIVITY_OUTPUT || 'dist/activity.json';
const previousPath = process.env.PREVIOUS_ACTIVITY || '';
const allowDecrease = process.env.ALLOW_DECREASE === 'true';
// A drop larger than this (with unchanged coverage) usually means partial data.
const MAX_DROP = 0.1;

function readPrevious(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function checkConsistency(activity, previous, { allowDrop = false } = {}) {
  const problems = [];
  const dailySum = Object.values(activity.daily).reduce((sum, value) => sum + value, 0);
  if (dailySum !== activity.commits.total) problems.push('daily counts do not add up to the total');
  if (activity.repositories.analyzed === 0 || activity.commits.total === 0) problems.push('no repositories or commits were found');
  const { current, longest } = activity.streaks;
  if (current.length > longest.length || longest.length > activity.commits.active_days) problems.push('streaks are inconsistent');
  if (previous?.commits && previous.coverage?.private === activity.coverage.private && !allowDrop &&
      activity.commits.total < previous.commits.total * (1 - MAX_DROP)) {
    problems.push('total commits fell from ' + previous.commits.total + ' to ' + activity.commits.total +
      ' with the same coverage; run the workflow manually with allow_decrease if this is expected');
  }
  return problems;
}

function writeStepSummary(activity) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const { commits, streaks, repositories, coverage, excluded } = activity;
  const lines = [
    '### Atividade dos projetos',
    '',
    '| Indicador | Valor |',
    '| --- | --- |',
    '| Total de commits | ' + commits.total + ' |',
    '| Commits nos últimos 30 dias | ' + commits.last_30_days + ' |',
    '| Dias consecutivos | ' + streaks.current.length + (streaks.current.start ? ' (' + streaks.current.start + ' a ' + streaks.current.end + ')' : '') + ' |',
    '| Maior sequência | ' + streaks.longest.length + (streaks.longest.start ? ' (' + streaks.longest.start + ' a ' + streaks.longest.end + ')' : '') + ' |',
    '| Repositórios analisados | ' + repositories.analyzed + ' (' + repositories.public + ' públicos, ' + repositories.private + ' privados) |',
    '| Cobertura dos privados | ' + (coverage.private === 'complete' ? 'completa' : 'não configurada (PROFILE_STATS_TOKEN ausente)') + ' |',
    '| Merges não contados | ' + excluded.merge_commits + ' |',
    ''
  ];
  fs.appendFileSync(file, lines.join('\n') + '\n');
}

async function main() {
  const token = privateToken || process.env.GITHUB_TOKEN;
  const client = createGitHubClient({ token });
  const activity = await collectActivity({ client, owner, includePrivate: Boolean(privateToken) });
  activity.languages = activity.languages.map(({ name, daily }) => ({ name, color: languageColor(name), daily }));

  const problems = checkConsistency(activity, readPrevious(previousPath), { allowDrop: allowDecrease });
  if (problems.length) throw new Error('Refusing to publish activity data: ' + problems.join('; '));

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(activity, null, 2) + '\n', 'utf8');
  writeStepSummary(activity);
  if (activity.coverage.private !== 'complete') {
    console.log('::warning title=Repositórios privados fora da contagem::Configure o secret PROFILE_STATS_TOKEN ' +
      '(token fine-grained de ' + owner + ' com Contents: read) para incluir os repositórios privados.');
  }
  // Aggregate figures only: private repository names never reach the public log.
  console.log(JSON.stringify({
    total_commits: activity.commits.total,
    last_30_days: activity.commits.last_30_days,
    current_streak: activity.streaks.current,
    longest_streak: activity.streaks.longest,
    repositories: activity.repositories,
    coverage: activity.coverage,
    excluded: activity.excluded,
    branches: activity.branches,
    api: activity.api
  }));
}

if (import.meta.url === 'file://' + path.resolve(process.argv[1] || '')) {
  main().catch(error => {
    console.log('::error title=Coleta de atividade::' + error.message);
    process.exitCode = 1;
  });
}
