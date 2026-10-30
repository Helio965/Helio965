// Small GitHub REST client: Link-header pagination, retries with backoff for
// transient failures, and explicit primary/secondary rate-limit handling.
// Error messages describe endpoints with placeholders so a public workflow log
// never reveals the name of a private repository.
const API_ORIGIN = 'https://api.github.com';

export class GitHubApiError extends Error {
  constructor(message, { status = null, kind = 'http' } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.kind = kind;
  }
}

export function describeEndpoint(url) {
  return new URL(url, API_ORIGIN).pathname
    .replace(/^\/repos\/[^/]+\/[^/]+/, '/repos/:owner/:repo')
    .replace(/^\/repositories\/\d+/, '/repositories/:id')
    .replace(/^\/users\/[^/]+/, '/users/:user');
}

export function nextPageUrl(linkHeader) {
  for (const part of String(linkHeader || '').split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function bodySummary(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.message === 'string') return parsed.message.slice(0, 160);
  } catch {}
  return String(text).replace(/\s+/g, ' ').slice(0, 160);
}

export function createGitHubClient({
  token,
  fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  clock = () => Date.now(),
  timeoutMs = 30000,
  maxAttempts = 4,
  maxRateLimitWaitMs = 5 * 60 * 1000,
  maxRequests = 6000,
  userAgent = 'Helio965-profile-stats'
} = {}) {
  if (!token) throw new GitHubApiError('GitHub API token is missing', { kind: 'auth' });
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + token,
    'User-Agent': userAgent,
    'X-GitHub-Api-Version': '2022-11-28'
  };
  let requests = 0;
  let rateLimit = null;

  // Milliseconds to wait before retrying a rate-limited response, or null when
  // the response is not a rate limit (a plain 403 means missing permission).
  function rateLimitDelay(response, text) {
    if (response.status !== 403 && response.status !== 429) return null;
    const retryAfter = Number(response.headers.get('retry-after'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    if (response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset)) {
      return Math.max(1000, reset * 1000 - clock() + 1000);
    }
    if (response.status === 429 || /secondary rate limit|abuse/i.test(text)) return 60000;
    return null;
  }

  async function request(pathOrUrl, params = {}, { allow = [] } = {}) {
    const url = new URL(pathOrUrl, API_ORIGIN);
    if (url.origin !== API_ORIGIN) {
      throw new GitHubApiError('Refusing to send the token to ' + url.origin, { kind: 'config' });
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const endpoint = describeEndpoint(url);

    for (let attempt = 1; ; attempt++) {
      requests++;
      if (requests > maxRequests) {
        throw new GitHubApiError('Stopped at the ' + maxRequests + '-request safety limit; refusing to publish incomplete data', { kind: 'limit' });
      }
      let response;
      try {
        response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        const reason = error?.name === 'TimeoutError' ? 'timed out after ' + timeoutMs + ' ms' : (error?.message || String(error));
        if (attempt < maxAttempts) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw new GitHubApiError('Network failure at ' + endpoint + ' (' + reason + ') after ' + attempt + ' attempts', { kind: 'network' });
      }

      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining !== null) {
        rateLimit = {
          limit: Number(response.headers.get('x-ratelimit-limit')),
          remaining: Number(remaining),
          reset: Number(response.headers.get('x-ratelimit-reset'))
        };
      }
      // The timeout also covers the body: a body cut short is a network
      // failure and is retried like one; only a complete body that is not
      // JSON counts as malformed.
      let text;
      try {
        text = await response.text();
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        const reason = error?.name === 'TimeoutError' ? 'timed out after ' + timeoutMs + ' ms' : (error?.message || String(error));
        throw new GitHubApiError('Network failure reading ' + endpoint + ' (' + reason + ') after ' + attempt + ' attempts', { kind: 'network' });
      }
      if (response.ok) {
        try {
          return { status: response.status, data: JSON.parse(text), headers: response.headers };
        } catch {
          throw new GitHubApiError('Invalid JSON from ' + endpoint, { status: response.status, kind: 'malformed' });
        }
      }
      // Rate limits come first, so an allowed 403 never hides one.
      const delay = rateLimitDelay(response, text);
      if (delay !== null) {
        if (delay > maxRateLimitWaitMs || attempt >= maxAttempts) {
          throw new GitHubApiError('GitHub API rate limit reached at ' + endpoint + ' (retry in ' + Math.ceil(delay / 1000) + ' s)', { status: response.status, kind: 'rate_limit' });
        }
        await sleep(delay);
        continue;
      }
      if (allow.includes(response.status)) return { status: response.status, data: null, headers: response.headers };
      if (response.status >= 500 && attempt < maxAttempts) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      if (response.status === 401) {
        throw new GitHubApiError('GitHub API rejected the token (401: ' + bodySummary(text) + ')', { status: 401, kind: 'auth' });
      }
      const kind = response.status === 404 ? 'not_found' : response.status === 403 ? 'forbidden' : 'http';
      throw new GitHubApiError('GitHub API ' + response.status + ' at ' + endpoint + ': ' + bodySummary(text), { status: response.status, kind });
    }
  }

  // Follows rel="next" links until the last page. The query of the next link
  // (page number or cursor) is applied to the original path, which avoids the
  // /repositories/:id form some proxies reject. Returns { status, items }; an
  // allowed non-2xx status on the first page (e.g. 409 for an empty
  // repository) yields no items, while on a later page it means the list was
  // cut short and is refused.
  async function paginate(path, params = {}, { allow = [], maxPages = 1000 } = {}) {
    const items = [];
    let query = { ...params, per_page: 100 };
    for (let page = 1; query; page++) {
      if (page > maxPages) {
        throw new GitHubApiError('More than ' + maxPages + ' pages at ' + describeEndpoint(path) + '; refusing a partial count', { kind: 'limit' });
      }
      const response = await request(path, query, { allow });
      if (response.data === null) {
        if (page === 1) return { status: response.status, items };
        throw new GitHubApiError('List from ' + describeEndpoint(path) + ' ended with HTTP ' + response.status + ' after ' + items.length + ' items; refusing a partial count', { status: response.status, kind: 'incomplete' });
      }
      if (!Array.isArray(response.data)) {
        throw new GitHubApiError('Expected a list from ' + describeEndpoint(path), { status: response.status, kind: 'malformed' });
      }
      items.push(...response.data);
      const next = nextPageUrl(response.headers.get('link'));
      query = next ? Object.fromEntries(new URL(next, API_ORIGIN).searchParams) : null;
    }
    return { status: 200, items };
  }

  return {
    request,
    paginate,
    get requestCount() { return requests; },
    get rateLimit() { return rateLimit; }
  };
}
