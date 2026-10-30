// Snapshot for maeul-in-the-sky, read through its documented `input` option:
// the village is built from the project activity of activity.json instead of
// a GitHub request. Maeul counts a streak only up to the last day of the
// series, so the series ends today once today has commits and yesterday
// otherwise: the village then shows the same current and longest streak as
// the profile cards.
//   node scripts/maeul-snapshot.js <activity.json> <snapshot.json>
import fs from 'node:fs';
import path from 'node:path';
import { levelScale } from './contribution-calendar-endpoint.js';
import { addDays } from './lib/dates.js';

export function buildMaeulSnapshot(activity, { username = activity.owner, fetchedAt = activity.generated_at } = {}) {
  const end = (activity.daily[activity.today] || 0) > 0 ? activity.today : addDays(activity.today, -1);
  // One year of days, like the village drawn from GitHub (e.g. Oct 30, 2025 to Oct 30, 2026).
  const start = (Number(end.slice(0, 4)) - 1) + end.slice(4).replace('-02-29', '-03-01');
  const dates = [];
  for (let day = start; day <= end; day = addDays(day, 1)) dates.push(day);
  const counts = dates.map(date => activity.daily[date] || 0);
  const level = levelScale(counts);

  const weeks = [];
  dates.forEach((date, index) => {
    const firstDay = addDays(date, -new Date(date + 'T12:00:00Z').getUTCDay());
    if (weeks.length === 0 || weeks[weeks.length - 1].firstDay !== firstDay) weeks.push({ firstDay, days: [] });
    weeks[weeks.length - 1].days.push({ date, count: counts[index], level: level(counts[index]) });
  });

  return {
    schemaVersion: 1,
    kind: 'maeul-snapshot',
    username,
    year: Number(end.slice(0, 4)),
    weeks,
    settings: {},
    source: { kind: 'import', ...(fetchedAt ? { fetchedAt } : {}) }
  };
}

if (import.meta.url === 'file://' + path.resolve(process.argv[1] || '')) {
  const [activityFile = 'activity.json', output = 'maeul.snapshot.json'] = process.argv.slice(2);
  const snapshot = buildMaeulSnapshot(JSON.parse(fs.readFileSync(activityFile, 'utf8')));
  fs.writeFileSync(output, JSON.stringify(snapshot) + '\n', 'utf8');
  const days = snapshot.weeks.flatMap(week => week.days);
  console.log('Maeul snapshot: ' + days.length + ' days, ' + days.reduce((sum, day) => sum + day.count, 0) +
    ' commits, ' + days[0].date + ' to ' + days[days.length - 1].date);
}
