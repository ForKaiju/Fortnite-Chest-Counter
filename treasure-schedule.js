'use strict';

// Fortnite Treasure Hours follow a fixed weekly cadence this season:
//
//   Saturday 19:00 -> 21:00 UTC   (9-11 PM in GMT+2)
//   Sunday   02:00 -> 04:00 UTC   (4-6 AM in GMT+2)
//
// Verified against every window fortnite.bot/treasure lists for Nov 7/8,
// Nov 14/15, Nov 21/22 and Nov 28/29. UTC has no DST, so the windows are
// plain arithmetic — no timezone tables, no network call, no scraping.

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MIN_MS = 60000;

const WEEKLY_WINDOWS = [
  { weekday: 6, utcHour: 19, minutes: 120 }, // Saturday
  { weekday: 0, utcHour: 2,  minutes: 120 }, // Sunday
];

// UTC midnight `days` days away from `ms`
function utcMidnight(ms, days = 0) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + days * DAY_MS;
}

// Every window that starts between `from` and `to` (inclusive), oldest first
function windowsBetween(from, to) {
  const out = [];
  for (let day = utcMidnight(from); day <= to; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    for (const rule of WEEKLY_WINDOWS) {
      if (rule.weekday !== weekday) continue;
      const start = day + rule.utcHour * HOUR_MS;
      if (start < from || start > to) continue;
      out.push({ start, end: start + rule.minutes * MIN_MS, minutes: rule.minutes });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// the window `now` sits inside, if any
function currentWindow(now = Date.now()) {
  const from = now - 2 * DAY_MS;
  return windowsBetween(from, now).find((w) => now >= w.start && now < w.end) || null;
}

// the next window that has not started yet
function nextWindow(now = Date.now()) {
  const to = now + 14 * DAY_MS;
  return windowsBetween(now, to).find((w) => w.start > now) || null;
}

// the next `count` windows, starting with the one in progress when live
function upcoming(now = Date.now(), count = 4) {
  const live = currentWindow(now);
  const list = live ? [live] : [];
  const to = now + 21 * DAY_MS;
  for (const w of windowsBetween(now, to)) {
    if (w.start > now) list.push(w);
    if (list.length >= count) break;
  }
  return list.slice(0, count);
}

module.exports = { windowsBetween, currentWindow, nextWindow, upcoming, WEEKLY_WINDOWS };
