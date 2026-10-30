// Single source of truth for "atividade dos projetos": distinct, non-merge
// commits by any author (the owner, Claude, Codex, collaborators...) in the
// repositories the account owns. Every card reads the numbers built here.
import { addDays, daysBetween, isDay, localDay, TIME_ZONE } from './dates.js';

// GitHub Actions runs are automation, not development work.
const AUTOMATION_LOGINS = new Set(['github-actions[bot]']);
const AUTOMATION_EMAILS = new Set(['41898282+github-actions[bot]@users.noreply.github.com']);
// Tolerated clock skew before a commit date counts as "in the future".
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

// The profile repository publishes its images to output-* branches every day.
export function isGeneratedProfileBranch(owner, repoName, branchName) {
  return repoName.toLowerCase() === owner.toLowerCase() && /^output(?:-|$)/.test(branchName);
}

export function isAutomationCommit(commit) {
  return AUTOMATION_LOGINS.has(commit.authorLogin) || AUTOMATION_EMAILS.has(commit.authorEmail);
}

// Reduces a REST "list commits" item to the fields the ledger needs. Refuses
// malformed items instead of guessing, so a broken response cannot be counted.
export function normalizeCommit(item) {
  if (!item || typeof item.sha !== 'string' || !SHA_PATTERN.test(item.sha)) {
    throw new Error('Malformed commit in API response: missing or invalid sha');
  }
  const data = item.commit;
  if (!data || !Array.isArray(item.parents) || !(data.author?.date || data.committer?.date)) {
    throw new Error('Malformed commit in API response: ' + item.sha);
  }
  return {
    sha: item.sha,
    parentCount: item.parents.length,
    authorDate: data.author?.date || null,
    committerDate: data.committer?.date || null,
    authorEmail: String(data.author?.email || '').toLowerCase(),
    authorLogin: item.author?.login || null,
    subject: String(data.message || '').split('\n', 1)[0].trim()
  };
}

// Current and longest runs of consecutive active days. The current streak
// stays alive through `today` while yesterday was active, so a day without
// commits yet does not reset it. Ties keep the earliest run, as Streak Stats does.
export function computeStreaks(activeDays, today) {
  if (!isDay(today)) throw new RangeError('Invalid day: ' + today);
  const unique = Array.from(new Set(activeDays));
  const invalid = unique.find(day => !isDay(day));
  if (invalid !== undefined) throw new RangeError('Invalid day: ' + invalid);
  const days = unique.filter(day => day <= today).sort();
  const longest = { length: 0, start: null, end: null };
  let runStart = null;
  let runLength = 0;
  let previous = null;
  for (const day of days) {
    if (previous !== null && daysBetween(previous, day) === 1) {
      runLength++;
    } else {
      runStart = day;
      runLength = 1;
    }
    if (runLength > longest.length) Object.assign(longest, { length: runLength, start: runStart, end: day });
    previous = day;
  }

  const active = new Set(days);
  const current = { length: 0, start: null, end: null };
  const anchor = active.has(today) ? today : addDays(today, -1);
  for (let day = anchor; active.has(day); day = addDays(day, -1)) {
    current.length++;
    current.start = day;
    current.end = anchor;
  }
  return { current, longest, lastActiveDay: days.length ? days[days.length - 1] : null };
}

export function createLedger({ now = new Date(), timeZone = TIME_ZONE } = {}) {
  const days = new Map();
  // Shared by all repositories, so the result does not depend on the order
  // they are read in: a commit object reachable from several branches or
  // repositories is the same work, and so is a rebased or cherry-picked copy
  // (new SHA, same author, author date and subject).
  const shas = new Set();
  const signatures = new Set();
  // Same counts split by the primary language of each repository (no names).
  const languages = new Map();
  const excluded = { merge_commits: 0, automation_commits: 0, duplicate_copies: 0, future_dated: 0 };
  const limit = now.getTime() + FUTURE_TOLERANCE_MS;
  const currentDay = localDay(now, timeZone);
  let counted = 0;

  // Author date is when the work was done; the committer date moves on rebase
  // or when GitHub applies a commit, so it is only a fallback for broken clocks.
  function activityInstant(commit) {
    for (const candidate of [commit.authorDate, commit.committerDate]) {
      const time = Date.parse(candidate);
      if (!Number.isNaN(time) && time <= limit) return time;
    }
    return null;
  }

  return {
    // Counts per repository; the language goes to the per-language series.
    repository({ language = null } = {}) {
      let repoCounted = 0;
      return {
        has: sha => shas.has(sha),
        get counted() { return repoCounted; },
        add(commit) {
          if (shas.has(commit.sha)) return 'seen';
          shas.add(commit.sha);
          if (commit.parentCount > 1) {
            excluded.merge_commits++;
            return 'merge';
          }
          if (isAutomationCommit(commit)) {
            excluded.automation_commits++;
            return 'automation';
          }
          const signature = commit.authorEmail + '\n' + commit.authorDate + '\n' + commit.subject;
          if (signatures.has(signature)) {
            excluded.duplicate_copies++;
            return 'duplicate';
          }
          signatures.add(signature);
          const instant = activityInstant(commit);
          const day = instant === null ? null : localDay(instant, timeZone);
          if (day === null || day > currentDay) {
            excluded.future_dated++;
            return 'future';
          }
          days.set(day, (days.get(day) || 0) + 1);
          if (language) {
            if (!languages.has(language)) languages.set(language, new Map());
            const perDay = languages.get(language);
            perDay.set(day, (perDay.get(day) || 0) + 1);
          }
          counted++;
          repoCounted++;
          return 'counted';
        }
      };
    },

    summary(today = currentDay) {
      const sorted = Array.from(days.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
      const windowStart = addDays(today, -29);
      const last30 = sorted
        .filter(([day]) => day >= windowStart && day <= today)
        .reduce((sum, [, amount]) => sum + amount, 0);
      const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
      return {
        today,
        total: counted,
        last30,
        activeDays: sorted.length,
        firstDay: sorted.length ? sorted[0][0] : null,
        streaks: computeStreaks(sorted.map(([day]) => day), today),
        daily: Object.fromEntries(sorted),
        languages: Array.from(languages.entries()).sort(byName)
          .map(([name, perDay]) => ({ name, daily: Object.fromEntries(Array.from(perDay.entries()).sort(byName)) })),
        excluded: { ...excluded }
      };
    }
  };
}
