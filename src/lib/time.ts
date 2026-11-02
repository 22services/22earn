/** Timezone helpers — goals and reminders follow each influencer's local day. */

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" for the given instant in the given timezone. */
export function localDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function localHour(date: Date, timeZone: string) {
  const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date);
  return Number(h) % 24;
}

/** Shift a "YYYY-MM-DD" key by n days (calendar arithmetic, timezone-free). */
export function addDaysToKey(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 3_600_000);
}

export function formatDate(date: Date, locale = "en-US", timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone }).format(date);
}

export function formatDateTime(date: Date, locale = "en-US", timeZone?: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

export function formatMonth(date: Date, locale = "en-US", timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone }).format(date);
}

export function timeAgo(date: Date, now = new Date()) {
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(date);
}

/** Human "in 31 h" for maturing amounts. */
export function timeUntil(date: Date, now = new Date()) {
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return "now";
  const h = Math.ceil(ms / 3_600_000);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.ceil(h / 24)} days`;
}
