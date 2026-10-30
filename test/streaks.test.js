import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeStreaks } from '../scripts/lib/activity.js';
import { addDays, daysBetween, localDay } from '../scripts/lib/dates.js';

function run(end, length) {
  return Array.from({ length }, (_, index) => addDays(end, -index));
}

test('sequences of 2, 7, 15 and 30 days ending today', () => {
  for (const length of [2, 7, 15, 30]) {
    const { current, longest } = computeStreaks(run('2026-10-30', length), '2026-10-30');
    assert.deepEqual(current, { length, start: addDays('2026-10-30', 1 - length), end: '2026-10-30' });
    assert.equal(longest.length, length);
  }
});

test('a 30-day sequence across a month change', () => {
  const days = run('2026-11-18', 30);
  assert.equal(days.at(-1), '2026-10-20');
  const { current } = computeStreaks(days, '2026-11-18');
  assert.deepEqual(current, { length: 30, start: '2026-10-20', end: '2026-11-18' });
});

test('a 15-day sequence across a year change', () => {
  const { current, longest } = computeStreaks(run('2027-01-03', 15), '2027-01-03');
  assert.deepEqual(current, { length: 15, start: '2026-12-20', end: '2027-01-03' });
  assert.deepEqual(longest, { length: 15, start: '2026-12-20', end: '2027-01-03' });
});

test('February of a leap year keeps the sequence', () => {
  const { current } = computeStreaks(['2028-02-28', '2028-02-29', '2028-03-01'], '2028-03-01');
  assert.equal(current.length, 3);
  const nonLeap = computeStreaks(['2027-02-27', '2027-02-28', '2027-03-01'], '2027-03-01');
  assert.equal(nonLeap.current.length, 3);
});

test('no commit yet today keeps the streak that ended yesterday', () => {
  const { current } = computeStreaks(run('2026-10-29', 7), '2026-10-30');
  assert.deepEqual(current, { length: 7, start: '2026-10-23', end: '2026-10-29' });
});

test('a full day without commits resets the current streak', () => {
  const { current, longest, lastActiveDay } = computeStreaks(run('2026-10-28', 7), '2026-10-30');
  assert.deepEqual(current, { length: 0, start: null, end: null });
  assert.equal(longest.length, 7);
  assert.equal(lastActiveDay, '2026-10-28');
});

test('a gap splits runs and the longest one wins', () => {
  const days = [...run('2026-09-10', 5), ...run('2026-10-15', 17), ...run('2026-10-30', 8)];
  const { current, longest } = computeStreaks(days, '2026-10-30');
  assert.equal(current.length, 8);
  assert.deepEqual(longest, { length: 17, start: '2026-09-29', end: '2026-10-15' });
});

test('ties keep the earliest longest run and duplicates or unsorted input do not matter', () => {
  const days = [...run('2026-10-30', 3), ...run('2026-10-05', 3), '2026-10-04', '2026-10-30'];
  const { longest } = computeStreaks(days.reverse(), '2026-10-30');
  assert.deepEqual(longest, { length: 3, start: '2026-10-03', end: '2026-10-05' });
});

test('days after today are ignored and invalid days are rejected', () => {
  assert.equal(computeStreaks(['2026-10-31', '2026-11-01'], '2026-10-30').current.length, 0);
  assert.throws(() => computeStreaks([], '2026-02-31'), RangeError);
  assert.throws(() => computeStreaks(['2026-13-01'], '2026-10-30'), RangeError);
  assert.deepEqual(computeStreaks([], '2026-10-30').longest, { length: 0, start: null, end: null });
});

test('commits near midnight are assigned to the Brasília calendar day', () => {
  assert.equal(localDay('2026-10-24T02:59:59Z'), '2026-10-23');
  assert.equal(localDay('2026-10-24T03:00:00Z'), '2026-10-24');
  assert.equal(localDay('2026-10-23T23:59:59-03:00'), '2026-10-23');
  assert.equal(localDay('2026-10-24T00:30:00+02:00'), '2026-10-23');
  assert.equal(localDay('2027-01-01T02:30:00Z'), '2026-12-31');
  assert.equal(localDay('2026-11-01T00:10:00Z'), '2026-10-31');
});

test('day arithmetic crosses months, years and leap days', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(daysBetween('2026-10-01', '2026-10-30'), 29);
  assert.equal(daysBetween('2026-12-25', '2027-01-03'), 9);
});

test('real history of 2026-10-30 matches the git log reference', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/real-history-2026-10-30.json', import.meta.url)));
  for (const scope of ['all', 'public']) {
    const { today, daily, expected } = fixture[scope];
    const { current, longest } = computeStreaks(Object.keys(daily), today);
    assert.deepEqual(current, expected.current, scope);
    assert.deepEqual(longest, expected.longest, scope);
    assert.equal(Object.values(daily).reduce((sum, value) => sum + value, 0), expected.total, scope);
  }
  // The private Nexo project is what keeps 23-29 October alive.
  assert.equal(fixture.all.expected.current.length, 8);
  assert.equal(fixture.public.expected.current.length, 1);
});
