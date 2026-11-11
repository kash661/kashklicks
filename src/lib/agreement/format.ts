// Formatting helpers for agreement text. Dates of signing are Toronto dates.

const TZ = 'America/Toronto';

const parts = (fmt: Intl.DateTimeFormat, d: Date): Record<string, string> =>
  Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));

const torontoDay = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const torontoIso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const torontoClock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
// A calendar date has no time zone; format it at noon UTC so it never shifts.
const calendarDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const atNoonUtc = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** 501.25 -> '$501.25', 1451.25 -> '$1,451.25' */
export function money(n: number): string {
  const [whole, cents] = (Math.round(n * 100) / 100).toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+$)/g, ',')}.${cents}`;
}

/** '2026-12-12' -> 'Saturday 12 December 2026' */
export function longDate(iso: string): string {
  const p = parts(calendarDay, atNoonUtc(iso));
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** The Toronto date of an instant, '10 November 2026' */
export function shortDate(d: Date): string {
  const p = parts(torontoDay, d);
  return `${p.day} ${p.month} ${p.year}`;
}

/** The Toronto date of an instant as 'YYYY-MM-DD' */
export function torontoIsoDate(d: Date): string {
  const p = parts(torontoIso, d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** '12:00' -> '12:00 pm', '14:00' -> '2:00 pm', '09:30' -> '9:30 am' */
export function clockTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Toronto date and clock time of an instant: { date: '9 November 2026', time: '2:41 pm' } */
export function torontoStamp(d: Date): { date: string; time: string } {
  const p = parts(torontoClock, d);
  return { date: shortDate(d), time: `${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}` };
}

/** Calendar arithmetic on 'YYYY-MM-DD' */
export function addDays(iso: string, days: number): string {
  const d = atNoonUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
