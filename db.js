import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { todayUTC, rangeDaysBack, nowUTCISO } from './utils/date.js';

dayjs.extend(utc);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbDir = path.join(__dirname, 'data');
const dbPath = path.join(dbDir, 'data.db');

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL CHECK(name IN ('Shamil','Halit')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, day),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS research_entries (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      tickers TEXT,
      links TEXT,
      confidence INTEGER CHECK(confidence BETWEEN 1 AND 5),
      minutes_spent INTEGER CHECK(minutes_spent BETWEEN 0 AND 1440),
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      meta TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkins_user_day ON checkins(user_id, day);
    CREATE INDEX IF NOT EXISTS idx_re_user_day ON research_entries(user_id, day);
    CREATE INDEX IF NOT EXISTS idx_re_day ON research_entries(day);
  `);

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (name, created_at) VALUES (?, ?)');
  const now = nowUTCISO();
  insertUser.run('Shamil', now);
  insertUser.run('Halit', now);
}

export function getUserByName(name) {
  if (!name) return null;
  return db.prepare('SELECT * FROM users WHERE lower(name) = lower(?) LIMIT 1').get(name.trim());
}

export function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY name ASC').all();
}

export function upsertCheckin(userId, day, note) {
  const now = nowUTCISO();
  const stmt = db.prepare(`
    INSERT INTO checkins (user_id, day, note, created_at)
    VALUES (@userId, @day, @note, @now)
    ON CONFLICT(user_id, day)
    DO UPDATE SET note = excluded.note, created_at = excluded.created_at
  `);
  stmt.run({ userId, day, note, now });
  return db.prepare('SELECT * FROM checkins WHERE user_id = ? AND day = ?').get(userId, day);
}

export function getCheckin(userId, day) {
  return db.prepare('SELECT * FROM checkins WHERE user_id = ? AND day = ?').get(userId, day);
}

export function getLastActivity(userId) {
  const row = db
    .prepare(
      `SELECT MAX(created_at) AS last_activity FROM (
        SELECT created_at FROM checkins WHERE user_id = ?
        UNION ALL
        SELECT created_at FROM research_entries WHERE user_id = ?
      )`
    )
    .get(userId, userId);
  return row?.last_activity || null;
}

export function createResearch(userId, payload) {
  const now = nowUTCISO();
  const stmt = db.prepare(`
    INSERT INTO research_entries (user_id, day, title, summary, tickers, links, confidence, minutes_spent, created_at)
    VALUES (@userId, @day, @title, @summary, @tickers, @links, @confidence, @minutes, @now)
  `);
  const info = stmt.run({
    userId,
    day: payload.day,
    title: payload.title,
    summary: payload.summary,
    tickers: payload.tickers,
    links: payload.links,
    confidence: payload.confidence,
    minutes: payload.minutes_spent,
    now,
  });
  return db.prepare('SELECT * FROM research_entries WHERE id = ?').get(info.lastInsertRowid);
}

export function updateResearch(id, userId, payload) {
  const stmt = db.prepare(`
    UPDATE research_entries
    SET title = @title,
        summary = @summary,
        tickers = @tickers,
        links = @links,
        confidence = @confidence,
        minutes_spent = @minutes
    WHERE id = @id AND user_id = @userId
  `);
  const info = stmt.run({
    id,
    userId,
    title: payload.title,
    summary: payload.summary,
    tickers: payload.tickers,
    links: payload.links,
    confidence: payload.confidence,
    minutes: payload.minutes_spent,
  });
  return info.changes > 0;
}

export function deleteResearch(id, userId) {
  const stmt = db.prepare('DELETE FROM research_entries WHERE id = ? AND user_id = ?');
  const info = stmt.run(id, userId);
  return info.changes > 0;
}

export function getResearchById(id) {
  return db.prepare('SELECT * FROM research_entries WHERE id = ?').get(id);
}

export function getRecentResearch({ limit = 30, userName = null, days = null } = {}) {
  const params = [];
  let where = 'WHERE 1=1';
  if (userName && userName !== 'All') {
    where += ' AND lower(u.name) = lower(?)';
    params.push(userName);
  }
  if (days) {
    const startDay = rangeDaysBack(days, { newestFirst: false })[0];
    where += ' AND re.day >= ?';
    params.push(startDay);
  }
  const sql = `
    SELECT re.*, u.name AS user_name
    FROM research_entries re
    JOIN users u ON re.user_id = u.id
    ${where}
    ORDER BY re.created_at DESC
    LIMIT ?
  `;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  return rows.map((row) => ({
    ...row,
    links: row.links ? JSON.parse(row.links) : [],
  }));
}

export function getDailyPresenceMap(userId, daysBack) {
  const map = new Map();
  const range = rangeDaysBack(daysBack, { newestFirst: false });
  range.forEach((day) => map.set(day, 0));
  const startDay = range[0];
  const rows = db
    .prepare(
      `SELECT day, COUNT(*) as count FROM (
        SELECT day FROM checkins WHERE user_id = ? AND day >= ?
        UNION ALL
        SELECT day FROM research_entries WHERE user_id = ? AND day >= ?
      )
      GROUP BY day`
    )
    .all(userId, startDay, userId, startDay);
  rows.forEach((row) => {
    if (map.has(row.day)) {
      map.set(row.day, Number(row.count));
    }
  });
  return map;
}

export function computeStreak(userId) {
  const rows = db
    .prepare('SELECT day FROM checkins WHERE user_id = ? ORDER BY day DESC')
    .all(userId);
  const daySet = new Set(rows.map((r) => r.day));
  let streak = 0;
  let cursor = dayjs().utc();
  while (daySet.has(cursor.format('YYYY-MM-DD'))) {
    streak += 1;
    cursor = cursor.subtract(1, 'day');
  }
  return streak;
}

export function computeCompletion(userId, windowDays) {
  if (windowDays <= 0) {
    return { totalDays: 0, completedDays: 0, percent: 0 };
  }
  const range = rangeDaysBack(windowDays, { newestFirst: false });
  const startDay = range[0];
  const row = db
    .prepare('SELECT COUNT(*) as count FROM checkins WHERE user_id = ? AND day >= ?')
    .get(userId, startDay);
  const completedDays = row?.count ? Number(row.count) : 0;
  return {
    totalDays: windowDays,
    completedDays,
    percent: Math.round((completedDays / windowDays) * 100),
  };
}

export function getResearchForUser(userId, days) {
  const startDay = rangeDaysBack(days, { newestFirst: false })[0];
  return db
    .prepare(
      `SELECT * FROM research_entries
       WHERE user_id = ? AND day >= ?
       ORDER BY created_at DESC`
    )
    .all(userId, startDay)
    .map((row) => ({ ...row, links: row.links ? JSON.parse(row.links) : [] }));
}

export function writeAudit(userId, action, entityType, entityId, meta = {}) {
  const now = nowUTCISO();
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, action, entityType, entityId, JSON.stringify(meta || {}), now);
}

export default db;
