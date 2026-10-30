'use strict';

// Counts repository activity, NOT GitHub's official personal contributions.
// Includes distinct commits by every author, including Claude and Codex.
// Excludes generated profile branches, avoids duplicate SHAs across branches.
// Never publishes names or contents of private repositories.
const fs = require('node:fs');
const path = require('node:path');

const owner = process.env.GITHUB_REPOSITORY_OWNER || 'Helio965';
const token = process.env.ACTIVITY_READ_TOKEN || process.env.GITHUB_TOKEN;
const privateTokenEnabled = process.env.HAS_PRIVATE_TOKEN === 'true';
if (!token) throw new Error('GitHub API token is missing');

const headers = {
  'Accept': 'application/vnd.github+json',
  'Authorization': 'Bearer ' + token,
  'User-Agent': 'Helio965-profile-activity',
  'X-GitHub-Api-Version': '2022-11-28'
};
let requests = 0;

async function api(endpoint, params = {}) {
  requests += 1;
  if (requests > 4000) {
    throw new Error('Stopped at the 4000-request safety limit; refusing to publish incomplete data.');
  }
  const url = new URL('https://api.github.com' + endpoint);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    if (response.ok) return response.json();
    const body = (await response.text()).slice(0, 300);
    if (response.status === 409) return [];
    if ((response.status >= 500 || response.status === 429) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1500));
      continue;
    }
    throw new Error('GitHub API ' + response.status + ' at ' + url.pathname + ': ' + body);
  }
}

async function allPages(endpoint, params = {}) {
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api(endpoint, { ...params, per_page: 100, page });
    if (!Array.isArray(batch)) throw new Error('Unexpected paginated API response: ' + endpoint);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('More than 10,000 entries at ' + endpoint + '. Refusing to publish a partial count.');
}

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});
function localDay(input) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(input)).map(part => [part.type, part.value])
  );
  return parts.year + '-' + parts.month + '-' + parts.day;
}
function shiftedDay(date, offsetDays) {
  const utcNoon = Date.parse(date + 'T12:00:00Z');
  return new Date(utcNoon + offsetDays * 86400000).toISOString().slice(0, 10);
}
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]
  );
}

function svgCard({ total, recent30, streak, longest, projectCount, privateCount, lastUpdated }, dark) {
  const bg = dark ? '#0D1117' : '#FFFFFF';
  const heading = dark ? '#58A6FF' : '#0969DA';
  const ink = dark ? '#E6EDF3' : '#24292F';
  const sub = dark ? '#8B949E' : '#57606A';
  const border = dark ? '#30363D' : '#D0D7DE';
  const fmt = n => new Intl.NumberFormat('pt-BR').format(n);
  const visibility = privateTokenEnabled
    ? 'Públicos + privados acessíveis (' + privateCount + ' privados)'
    : 'Somente públicos: configure PROFILE_STATS_TOKEN para incluir privados';
  const stat = (x, y, label, number) => [
    '<text x="' + x + '" y="' + y + '" font-size="12" fill="' + sub + '">' + escapeXml(label) + '</text>',
    '<text x="' + x + '" y="' + (y + 26) + '" font-size="26" font-weight="700" fill="' + ink + '">' + fmt(number) + '</text>'
  ].join('\n');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="467" height="212" viewBox="0 0 467 212" role="img" aria-label="Atividade em repositórios de ' + escapeXml(owner) + '">',
    '<rect x="0.5" y="0.5" width="466" height="211" rx="7" fill="' + bg + '" stroke="' + border + '"/>',
    '<g font-family="Segoe UI,Ubuntu,Arial,sans-serif">',
    '<text x="23" y="31" font-size="18" font-weight="700" fill="' + heading + '">Atividade nos projetos de ' + escapeXml(owner) + '</text>',
    stat(23, 62, 'Commits em todos os projetos', total),
    stat(249, 62, 'Últimos 30 dias', recent30),
    stat(23, 121, 'Dias consecutivos', streak),
    stat(249, 121, 'Maior sequência', longest),
    '<text x="23" y="178" font-size="10.5" fill="' + sub + '">Autores humanos e IA · ' + fmt(projectCount) + ' repositórios com commits</text>',
    '<text x="23" y="194" font-size="9.5" fill="' + sub + '">' + escapeXml(visibility) + '</text>',
    '</g></svg>'
  ].join('\n');
}

async function main() {
  const publicRepos = await allPages('/users/' + encodeURIComponent(owner) + '/repos', { type: 'owner' });
  const accessible = new Map();
  for (const repo of publicRepos) {
    if (repo.owner.login.toLowerCase() === owner.toLowerCase() && !repo.fork) {
      accessible.set(repo.full_name, repo);
    }
  }
  if (privateTokenEnabled) {
    const identity = await api('/user');
    if (identity.login.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('PROFILE_STATS_TOKEN must belong to ' + owner);
    }
    const owned = await allPages('/user/repos', { affiliation: 'owner', visibility: 'all' });
    for (const repo of owned) {
      if (repo.owner.login.toLowerCase() === owner.toLowerCase() && !repo.fork) {
        accessible.set(repo.full_name, repo);
      }
    }
  }

  const days = new Map();
  let total = 0;
  let projectsWithCommits = 0;
  const privateCount = Array.from(accessible.values()).filter(repo => repo.private).length;

  for (const repo of accessible.values()) {
    const repoPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo.name);
    const branches = await allPages(repoPath + '/branches');
    const seen = new Set();
    for (const branch of branches) {
      // The profile repository publishes graphics to several output-* branches daily.
      // Those automated image deployments are not software development activity.
      if (repo.name.toLowerCase() === owner.toLowerCase() && /^output(?:-|$)/.test(branch.name)) {
        continue;
      }
      const commits = await allPages(repoPath + '/commits', { sha: branch.name });
      for (const commit of commits) {
        if (seen.has(commit.sha)) continue;
        seen.add(commit.sha);
        const timestamp = commit.commit?.author?.date || commit.commit?.committer?.date;
        if (!timestamp) continue;
        const date = localDay(timestamp);
        days.set(date, (days.get(date) || 0) + 1);
        total++;
      }
    }
    if (seen.size) projectsWithCommits++;
  }

  const now = new Date();
  const today = localDay(now);
  const cutoff = shiftedDay(today, -29);
  const recent30 = Array.from(days.entries())
    .filter(([date]) => date >= cutoff && date <= today)
    .reduce((sum, [, amount]) => sum + amount, 0);

  let currentDay = days.has(today) ? today : shiftedDay(today, -1);
  let streak = 0;
  while (days.has(currentDay)) {
    streak++;
    currentDay = shiftedDay(currentDay, -1);
  }

  const sortedDays = Array.from(days.keys()).sort();
  let longest = 0;
  let running = 0;
  let last = null;
  for (const day of sortedDays) {
    running = last && shiftedDay(last, 1) === day ? running + 1 : 1;
    longest = Math.max(longest, running);
    last = day;
  }
  const stats = { total, recent30, streak, longest, projectCount: projectsWithCommits, privateCount, lastUpdated: today };
  fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
  fs.writeFileSync('dist/all-activity.svg', svgCard(stats, false), 'utf8');
  fs.writeFileSync('dist/all-activity-dark.svg', svgCard(stats, true), 'utf8');
  // Aggregate figures only: do not print private repository names to the public workflow log.
  console.log(JSON.stringify({
    total_commits: total, last_30_days: recent30, current_streak: streak,
    longest_streak: longest, repositories: projectsWithCommits,
    private_repositories_accessible: privateCount, private_token_configured: privateTokenEnabled,
    api_requests: requests
  }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
