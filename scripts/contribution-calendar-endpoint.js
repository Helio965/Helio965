// Local GraphQL endpoint for github-profile-3d-contrib, used through its
// documented GITHUB_ENDPOINT option. Each query is forwarded to GitHub and the
// contribution calendar in the answer is replaced by the project activity of
// activity.json, so the 3D bars, the calendar period, the total and the
// language ring show the same commits as the profile cards. Stars, forks,
// issues, pull requests and reviews keep their official values.
//   node scripts/contribution-calendar-endpoint.js <activity.json> [port]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { addDays, isDay } from './lib/dates.js';

const LEVELS = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const UPSTREAM = 'https://api.github.com/graphql';

// GitHub's default window: from the Sunday on or before the same date one
// year earlier, through today (Sunday-first weeks).
export function calendarWindow(today) {
  if (!isDay(today)) throw new RangeError('Invalid day: ' + today);
  const yearAgo = (Number(today.slice(0, 4)) - 1) + today.slice(4).replace('-02-29', '-02-28');
  const weekday = new Date(yearAgo + 'T12:00:00Z').getUTCDay();
  return { start: addDays(yearAgo, -weekday), end: today };
}

// Level 0 for days without commits, then quartiles of the active days.
export function levelScale(counts) {
  const active = counts.filter(count => count > 0).sort((a, b) => a - b);
  if (!active.length) return () => 0;
  const at = share => active[Math.max(0, Math.ceil(share * active.length) - 1)];
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)];
  return count => (count <= 0 ? 0 : count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4);
}

export function buildCalendar(activity) {
  const { start, end } = calendarWindow(activity.today);
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  const counts = days.map(day => activity.daily[day] || 0);
  const level = levelScale(counts);
  const weeks = [];
  days.forEach((date, index) => {
    if (index % 7 === 0) weeks.push({ contributionDays: [] });
    weeks[weeks.length - 1].contributionDays.push({ contributionCount: counts[index], contributionLevel: LEVELS[level(counts[index])], date });
  });
  const languages = (activity.languages || [])
    .map(({ name, color, daily }) => ({
      name, color: color || null,
      count: Object.entries(daily).reduce((sum, [day, amount]) => (day >= start && day <= end ? sum + amount : sum), 0)
    }))
    .filter(language => language.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { start, end, weeks, languages, total: counts.reduce((sum, count) => sum + count, 0) };
}

// Replaces the commit-related parts of the first 3D query; other answers
// (such as the repositories page used for stars) pass through untouched.
export function patchResponse(body, calendar) {
  const collection = body?.data?.user?.contributionsCollection;
  if (!collection) return body;
  collection.contributionCalendar = {
    isHalloween: Boolean(collection.contributionCalendar?.isHalloween),
    totalContributions: calendar.total,
    weeks: calendar.weeks
  };
  collection.totalCommitContributions = calendar.total;
  collection.commitContributionsByRepository = calendar.languages.map(language => ({
    repository: { primaryLanguage: { name: language.name, color: language.color } },
    contributions: { totalCount: language.count }
  }));
  return body;
}

export function createEndpoint({ activity, upstream = UPSTREAM, fetchImpl = globalThis.fetch, log = () => {} }) {
  const calendar = buildCalendar(activity);
  return http.createServer(async (request, response) => {
    const reply = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    };
    if (request.method !== 'POST') return reply(405, { message: 'POST GraphQL queries only' });
    let query = '';
    for await (const chunk of request) query += chunk;
    try {
      const answer = await fetchImpl(upstream, {
        method: 'POST',
        headers: { 'Authorization': request.headers.authorization || '', 'Content-Type': 'application/json', 'User-Agent': 'Helio965-profile-3d' },
        body: query,
        signal: AbortSignal.timeout(60000)
      });
      const text = await answer.text();
      if (!answer.ok) return reply(answer.status, text);
      const patched = patchResponse(JSON.parse(text), calendar);
      if (patched?.data?.user?.contributionsCollection) {
        log('served ' + calendar.total + ' commits for ' + calendar.start + ' / ' + calendar.end);
      }
      return reply(200, patched);
    } catch (error) {
      return reply(502, { message: 'GitHub GraphQL request failed: ' + error.message });
    }
  });
}

if (import.meta.url === 'file://' + path.resolve(process.argv[1] || '')) {
  const [file = 'activity.json', port = '8787'] = process.argv.slice(2);
  const activity = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (activity.schema_version !== 1 || !isDay(activity.today) || !activity.daily) throw new Error(file + ' is not an activity file');
  createEndpoint({ activity, log: message => console.log(message) })
    .listen(Number(port), '127.0.0.1', () => console.log('3D calendar endpoint listening on 127.0.0.1:' + port));
}
