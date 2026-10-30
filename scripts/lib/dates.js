// Calendar-day helpers. Every activity day is a 'YYYY-MM-DD' string in the
// profile owner's time zone, so day arithmetic never depends on the runner's
// clock zone or on UTC midnight.
export const TIME_ZONE = 'America/Sao_Paulo';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }));
  }
  return formatters.get(timeZone);
}

export function isDay(value) {
  return typeof value === 'string' && DAY_PATTERN.test(value) && toUtcNoon(value) !== null;
}

function toUtcNoon(day) {
  const time = Date.parse(day + 'T12:00:00Z');
  if (Number.isNaN(time)) return null;
  // Date.parse rolls 2026-02-31 over to March; reject anything that does not round-trip.
  return new Date(time).toISOString().slice(0, 10) === day ? time : null;
}

// Calendar day of an instant (ISO string, Date or epoch ms) in the given zone.
export function localDay(instant, timeZone = TIME_ZONE) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date: ' + instant);
  const parts = Object.fromEntries(
    formatterFor(timeZone).formatToParts(date).map(part => [part.type, part.value])
  );
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function addDays(day, amount) {
  const time = toUtcNoon(day);
  if (time === null) throw new RangeError('Invalid day: ' + day);
  return new Date(time + amount * 86400000).toISOString().slice(0, 10);
}

// Whole days from `from` to `to` (positive when `to` is later).
export function daysBetween(from, to) {
  const start = toUtcNoon(from);
  const end = toUtcNoon(to);
  if (start === null || end === null) throw new RangeError('Invalid day: ' + (start === null ? from : to));
  return Math.round((end - start) / 86400000);
}
