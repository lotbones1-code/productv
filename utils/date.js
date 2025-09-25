import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

/**
 * Return current UTC day string (YYYY-MM-DD)
 */
export function todayUTC() {
  return dayjs().utc().format('YYYY-MM-DD');
}

/**
 * Convert any date-like input to a UTC day string.
 * @param {string|Date|number} input
 */
export function toUTCDay(input) {
  return dayjs(input).utc().format('YYYY-MM-DD');
}

/**
 * Return an array of day strings counting backwards from today.
 * @param {number} n number of days
 * @param {boolean} newestFirst whether newest first (default false -> oldest first)
 */
export function rangeDaysBack(n, { newestFirst = false } = {}) {
  const days = [];
  const today = dayjs().utc();
  for (let i = n - 1; i >= 0; i -= 1) {
    days.push(today.subtract(i, 'day').format('YYYY-MM-DD'));
  }
  if (newestFirst) {
    return days.slice().reverse();
  }
  return days;
}

/**
 * Return ISO timestamp string for now in UTC.
 */
export function nowUTCISO() {
  return dayjs().utc().toISOString();
}

/**
 * Convert a UTC day string to a human readable format (e.g., Apr 5).
 */
export function formatDayShort(day) {
  return dayjs.utc(day).format('MMM D');
}
