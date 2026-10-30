import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildCalendar, calendarWindow, createEndpoint, levelScale, patchResponse } from '../scripts/contribution-calendar-endpoint.js';

const ACTIVITY = {
  schema_version: 1,
  today: '2026-10-30',
  daily: { '2025-10-25': 9, '2025-10-26': 1, '2026-10-23': 6, '2026-10-27': 44, '2026-10-30': 5 },
  languages: [
    { name: 'Python', color: '#3572A5', daily: { '2026-10-27': 40, '2026-10-30': 5, '2025-10-25': 9 } },
    { name: 'TypeScript', color: '#3178c6', daily: { '2026-10-23': 6, '2026-10-27': 4 } },
    { name: 'CSS', color: '#663399', daily: { '2025-10-26': 1 } }
  ]
};

test('the window matches GitHub default calendar: Sunday a year back through today', () => {
  assert.deepEqual(calendarWindow('2026-10-30'), { start: '2025-10-26', end: '2026-10-30' });
  assert.deepEqual(calendarWindow('2028-02-29'), { start: '2027-02-28', end: '2028-02-29' });
  assert.deepEqual(calendarWindow('2027-01-03'), { start: '2025-12-28', end: '2027-01-03' });
  assert.throws(() => calendarWindow('2026-13-01'), RangeError);
});

test('levels are NONE for empty days and quartiles of the active days', () => {
  const level = levelScale([0, 1, 2, 5, 40]);
  assert.deepEqual([0, 1, 2, 5, 40].map(level), [0, 1, 2, 3, 4]);
  assert.equal(levelScale([0, 0])(3), 0);
});

test('the calendar carries every day of the window in Sunday-first weeks', () => {
  const calendar = buildCalendar(ACTIVITY);
  const days = calendar.weeks.flatMap(week => week.contributionDays);
  assert.equal(days[0].date, '2025-10-26');
  assert.equal(days.at(-1).date, '2026-10-30');
  assert.equal(days.length, 370);
  assert.ok(calendar.weeks.slice(0, -1).every(week => week.contributionDays.length === 7));
  // 2025-10-25 is outside the window, so the 9 commits of that day are not drawn.
  assert.equal(calendar.total, 1 + 6 + 44 + 5);
  assert.equal(days.find(day => day.date === '2026-10-27').contributionLevel, 'FOURTH_QUARTILE');
  assert.equal(days.find(day => day.date === '2026-10-28').contributionLevel, 'NONE');
  assert.deepEqual(calendar.languages, [
    { name: 'Python', color: '#3572A5', count: 45 },
    { name: 'TypeScript', color: '#3178c6', count: 10 },
    { name: 'CSS', color: '#663399', count: 1 }
  ]);
});

test('only the commit data of the answer is replaced', () => {
  const official = { data: { user: {
    contributionsCollection: { contributionCalendar: { isHalloween: true, totalContributions: 489, weeks: [] }, totalCommitContributions: 341,
      commitContributionsByRepository: [], totalIssueContributions: 12, totalPullRequestContributions: 111 },
    repositories: { nodes: [{ stargazerCount: 3, forkCount: 1 }] } } } };
  const patched = patchResponse(official, buildCalendar(ACTIVITY));
  const collection = patched.data.user.contributionsCollection;
  assert.equal(collection.contributionCalendar.totalContributions, 56);
  assert.equal(collection.contributionCalendar.isHalloween, true);
  assert.equal(collection.totalCommitContributions, 56);
  assert.equal(collection.totalIssueContributions, 12);
  assert.equal(collection.totalPullRequestContributions, 111);
  assert.deepEqual(patched.data.user.repositories, { nodes: [{ stargazerCount: 3, forkCount: 1 }] });
  assert.equal(collection.commitContributionsByRepository[0].repository.primaryLanguage.name, 'Python');
  const page = { data: { user: { repositories: { nodes: [] } } } };
  assert.deepEqual(patchResponse(structuredClone(page), buildCalendar(ACTIVITY)), page);
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}

test('the endpoint forwards the query and token, then patches the answer', async t => {
  let received = null;
  const upstream = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received = { body, authorization: request.headers.authorization };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { user: { contributionsCollection: { totalIssueContributions: 12 }, repositories: { nodes: [] } } } }));
  });
  const upstreamUrl = await listen(upstream);
  const endpoint = createEndpoint({ activity: ACTIVITY, upstream: upstreamUrl });
  const url = await listen(endpoint);
  t.after(() => { endpoint.close(); upstream.close(); });

  const query = JSON.stringify({ query: 'query { user(login: "Helio965") { id } }', variables: { login: 'Helio965' } });
  const response = await fetch(url + '/graphql', { method: 'POST', headers: { Authorization: 'bearer abc' }, body: query });
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(received, { body: query, authorization: 'bearer abc' });
  assert.equal(json.data.user.contributionsCollection.contributionCalendar.totalContributions, 56);
  assert.equal(json.data.user.contributionsCollection.totalIssueContributions, 12);
  assert.equal((await fetch(url)).status, 405);
});

test('an upstream failure is passed on so the 3D step fails instead of drawing partial data', async t => {
  const upstream = http.createServer((request, response) => {
    request.resume();
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end('{"message":"Bad Gateway"}');
  });
  const endpoint = createEndpoint({ activity: ACTIVITY, upstream: await listen(upstream) });
  const url = await listen(endpoint);
  t.after(() => { endpoint.close(); upstream.close(); });
  const response = await fetch(url, { method: 'POST', body: '{}' });
  assert.equal(response.status, 502);
});

test('the Maeul snapshot ends on the last day that counts for the streak', async () => {
  const { buildMaeulSnapshot } = await import('../scripts/maeul-snapshot.js');
  const activity = { ...ACTIVITY, owner: 'Helio965', generated_at: '2026-10-30T18:00:00.000Z' };
  const withToday = buildMaeulSnapshot(activity);
  const days = withToday.weeks.flatMap(week => week.days);
  assert.equal(withToday.kind, 'maeul-snapshot');
  assert.equal(withToday.username, 'Helio965');
  assert.equal(withToday.year, 2026);
  assert.deepEqual([days[0].date, days.at(-1).date], ['2025-10-30', '2026-10-30']);
  assert.equal(days.length, 366);
  assert.ok(withToday.weeks.every(week => week.days.every(day => new Date(week.firstDay + 'T12:00:00Z').getUTCDay() === 0 && day.date >= week.firstDay)));
  // 2025-10-26 is before the one-year window of the village.
  assert.equal(days.reduce((sum, day) => sum + day.count, 0), 6 + 44 + 5);
  assert.ok(days.every(day => (day.count === 0) === (day.level === 0)));
  // Without commits yet today, the series stops yesterday so the streak is not cut.
  const quietToday = buildMaeulSnapshot({ ...activity, daily: { ...activity.daily, '2026-10-30': 0 } });
  assert.equal(quietToday.weeks.at(-1).days.at(-1).date, '2026-10-29');
});
