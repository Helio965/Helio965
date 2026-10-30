import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient, describeEndpoint, nextPageUrl } from '../scripts/lib/github-api.js';

function response(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers }
  });
}

// fetch double that answers from a queue and records every request.
function fakeFetch(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    const next = answers.shift();
    if (!next) throw new Error('unexpected request ' + url);
    if (next instanceof Error) throw next;
    return next();
  };
  return { fetchImpl, calls };
}

function client(fetchImpl, options = {}) {
  const sleeps = [];
  const api = createGitHubClient({ token: 'test-token', fetchImpl, sleep: async ms => { sleeps.push(ms); }, clock: () => 1_000_000_000_000, ...options });
  return { api, sleeps };
}

test('pagination follows rel="next" on the original path until the last page', async () => {
  const link = page => '<https://api.github.com/repositories/42/commits?sha=abc&per_page=100&page=' + page + '>; rel="next", <https://api.github.com/repositories/42/commits?page=3>; rel="last"';
  const { fetchImpl, calls } = fakeFetch(
    () => response(200, [1, 2], { link: link(2) }),
    () => response(200, [3], { link: link(3) }),
    () => response(200, [4])
  );
  const { api } = client(fetchImpl);
  const { items } = await api.paginate('/repos/Helio965/Kernel/commits', { sha: 'abc' });
  assert.deepEqual(items, [1, 2, 3, 4]);
  assert.equal(calls.length, 3);
  for (const call of calls) assert.match(call.url, /^https:\/\/api\.github\.com\/repos\/Helio965\/Kernel\/commits\?/);
  assert.match(calls[2].url, /page=3/);
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token');
  assert.equal(api.requestCount, 3);
});

test('transient 5xx answers and network failures are retried with backoff', async () => {
  const { fetchImpl } = fakeFetch(
    () => response(502, { message: 'Bad Gateway' }),
    new TypeError('fetch failed'),
    () => response(200, { login: 'Helio965' })
  );
  const { api, sleeps } = client(fetchImpl);
  const { data } = await api.request('/user');
  assert.equal(data.login, 'Helio965');
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('timeouts that keep failing end in a clear network error', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const { fetchImpl } = fakeFetch(...Array(4).fill(timeout));
  const { api } = client(fetchImpl);
  await assert.rejects(api.request('/repos/Helio965/Kernel/branches'), error =>
    error.kind === 'network' && /timed out/.test(error.message) && !/Kernel/.test(error.message));
});

test('a rejected token fails at once without retries', async () => {
  const { fetchImpl, calls } = fakeFetch(() => response(401, { message: 'Bad credentials' }));
  const { api } = client(fetchImpl);
  await assert.rejects(api.request('/user'), error => error.kind === 'auth' && error.status === 401);
  assert.equal(calls.length, 1);
});

test('an exhausted primary rate limit waits for the reset when it is close', async () => {
  const reset = String(1_000_000_000 + 30);
  const { fetchImpl } = fakeFetch(
    () => response(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
    () => response(200, [])
  );
  const { api, sleeps } = client(fetchImpl);
  await api.paginate('/users/Helio965/repos');
  assert.deepEqual(sleeps, [31000]);
});

test('a rate limit that resets too late is reported instead of waited for', async () => {
  const reset = String(1_000_000_000 + 3600);
  const { fetchImpl } = fakeFetch(() => response(429, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }));
  const { api } = client(fetchImpl);
  await assert.rejects(api.request('/user'), error => error.kind === 'rate_limit');
});

test('secondary rate limits honour retry-after or wait a minute', async () => {
  const { fetchImpl } = fakeFetch(
    () => response(403, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '7' }),
    () => response(403, { message: 'You have exceeded a secondary rate limit' }),
    () => response(200, {})
  );
  const { api, sleeps } = client(fetchImpl);
  await api.request('/user');
  assert.deepEqual(sleeps, [7000, 60000]);
});

test('a plain 403 is a permission problem and is not retried', async () => {
  const { fetchImpl, calls } = fakeFetch(() => response(403, { message: 'Resource not accessible by integration' }));
  const { api } = client(fetchImpl);
  await assert.rejects(api.request('/user'), error => error.kind === 'forbidden');
  assert.equal(calls.length, 1);
});

test('allowed statuses such as 409 (empty repository) yield no items', async () => {
  const { fetchImpl } = fakeFetch(() => response(409, { message: 'Git Repository is empty.' }));
  const { api } = client(fetchImpl);
  assert.deepEqual(await api.paginate('/repos/Helio965/Empty/commits', {}, { allow: [409] }), { status: 409, items: [] });
});

test('unexpected payloads and runaway pagination are refused', async () => {
  const { fetchImpl } = fakeFetch(() => response(200, { message: 'not a list' }));
  await assert.rejects(client(fetchImpl).api.paginate('/repos/a/b/branches'), error => error.kind === 'malformed');

  const endless = () => response(200, [1], { link: '<https://api.github.com/x?page=2>; rel="next"' });
  const loop = fakeFetch(endless, endless, endless);
  await assert.rejects(client(loop.fetchImpl).api.paginate('/repos/a/b/branches', {}, { maxPages: 2 }), error => error.kind === 'limit');

  const limited = fakeFetch(() => response(200, {}), () => response(200, {}));
  const { api } = client(limited.fetchImpl, { maxRequests: 1 });
  await api.request('/user');
  await assert.rejects(api.request('/user'), error => error.kind === 'limit');
});

test('the token is never sent outside api.github.com and is required', async () => {
  const { fetchImpl, calls } = fakeFetch();
  await assert.rejects(client(fetchImpl).api.request('https://example.com/steal'), error => error.kind === 'config');
  assert.equal(calls.length, 0);
  assert.throws(() => createGitHubClient({ token: '' }), /token is missing/);
});

test('endpoints are described without repository names', () => {
  assert.equal(describeEndpoint('/repos/Helio965/Nexo---Faturamento-Inteligente---Render/commits?sha=x'), '/repos/:owner/:repo/commits');
  assert.equal(describeEndpoint('https://api.github.com/repositories/1424939233/commits?page=2'), '/repositories/:id/commits');
  assert.equal(describeEndpoint('/users/Helio965/repos'), '/users/:user/repos');
  assert.equal(nextPageUrl('<https://api.github.com/a?page=2>; rel="next", <https://api.github.com/a?page=9>; rel="last"'), 'https://api.github.com/a?page=2');
  assert.equal(nextPageUrl('<https://api.github.com/a?page=1>; rel="prev"'), null);
  assert.equal(nextPageUrl(null), null);
});
