import express from 'express';
import path from 'path';
import morgan from 'morgan';
import cookieSession from 'cookie-session';
import {
  init,
  getUserByName,
  getAllUsers,
  upsertCheckin,
  getCheckin,
  getLastActivity,
  createResearch,
  updateResearch,
  deleteResearch,
  getResearchById,
  getRecentResearch,
  getDailyPresenceMap,
  computeStreak,
  computeCompletion,
  getResearchForUser,
  writeAudit,
} from './db.js';
import { todayUTC, nowUTCISO, formatDayShort } from './utils/date.js';
import { escapeHtml, linkify } from './utils/sanitize.js';

const app = express();
const PORT = process.env.PORT || 3000;

init();

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.locals.escapeHtml = escapeHtml;
app.locals.linkify = linkify;
app.locals.formatDayShort = formatDayShort;

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'dev-secret-crypto-checkin'],
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
);
app.use(express.static(path.join(process.cwd(), 'public')));

app.use((req, res, next) => {
  const render = res.render.bind(res);
  res.render = (view, options = {}, callback) => {
    if (typeof callback === 'function') {
      return render(view, options, callback);
    }
    return render(view, options, (err, html) => {
      if (err) {
        throw err;
      }
      return render('layout', { ...options, body: html });
    });
  };

  res.locals.currentUser = req.session?.user || null;
  res.locals.flash = req.session?.flash || null;
  if (req.session?.flash) {
    delete req.session.flash;
  }
  next();
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    setFlash(req, 'error', 'Please log in.');
    return res.redirect('/login');
  }
  return next();
}

function ownerOnly(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    setFlash(req, 'error', 'Unauthorized');
    return res.redirect('/login');
  }
  const entryId = Number(req.params.id);
  if (Number.isNaN(entryId)) {
    setFlash(req, 'error', 'Invalid request.');
    return res.redirect('/dashboard');
  }
  const entry = getResearchById(entryId);
  if (!entry || entry.user_id !== user.id) {
    setFlash(req, 'error', 'Not allowed.');
    return res.redirect('/dashboard');
  }
  req.entry = entry;
  return next();
}

app.get('/', (req, res) => {
  res.redirect('/public');
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

app.post('/login', (req, res) => {
  const name = req.body.name?.trim();
  const user = getUserByName(name);
  if (!user) {
    setFlash(req, 'error', 'Unable to log in with that name.');
    return res.redirect('/login');
  }
  req.session.user = { id: user.id, name: user.name };
  setFlash(req, 'success', `Welcome back, ${user.name}!`);
  return res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/public');
});

app.get('/dashboard', requireAuth, (req, res) => {
  const { user } = req.session;
  const today = todayUTC();
  const checkin = getCheckin(user.id, today);
  const recentResearch = getResearchForUser(user.id, 7);
  res.render('dashboard', {
    title: 'Dashboard',
    today,
    checkin,
    recentResearch,
  });
});

function parseTickers(raw) {
  if (!raw) return '';
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.toUpperCase())
    .join(',');
}

function parseLinks(raw) {
  if (!raw) return [];
  let linksArray = [];
  if (Array.isArray(raw)) {
    linksArray = raw;
  } else if (typeof raw === 'string') {
    linksArray = raw.split(/[\n,]+/);
  } else {
    linksArray = [raw];
  }
  const clean = [];
  linksArray.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      const url = new URL(trimmed);
      if (['http:', 'https:'].includes(url.protocol)) {
        clean.push(url.toString());
      }
    } catch (err) {
      // ignore bad URLs
    }
  });
  return clean;
}

app.post('/checkin', requireAuth, (req, res) => {
  const { user } = req.session;
  const today = todayUTC();
  const note = req.body.note?.toString().slice(0, 2000) || '';
  const saved = upsertCheckin(user.id, today, note);
  writeAudit(user.id, 'checkin.upsert', 'checkin', saved.id, { day: today });
  setFlash(req, 'success', 'Check-in recorded.');
  res.redirect('/dashboard');
});

app.post('/research', requireAuth, (req, res) => {
  const { user } = req.session;
  const today = todayUTC();
  const {
    title,
    summary,
    tickers,
    confidence,
    minutes_spent,
    day = today,
  } = req.body;
  if (!title?.trim() || !summary?.trim()) {
    setFlash(req, 'error', 'Title and summary are required.');
    return res.redirect('/dashboard');
  }
  const parsed = {
    day,
    title: title.trim().slice(0, 255),
    summary: summary.trim().slice(0, 5000),
    tickers: parseTickers(tickers).slice(0, 255),
    links: JSON.stringify(parseLinks(req.body.links)),
    confidence: Math.min(5, Math.max(1, Number(confidence) || 3)),
    minutes_spent: Math.min(1440, Math.max(0, Number(minutes_spent) || 0)),
  };
  const entry = createResearch(user.id, parsed);
  writeAudit(user.id, 'research.create', 'research', entry.id, { day: parsed.day });
  setFlash(req, 'success', 'Research entry added.');
  res.redirect('/dashboard');
});

app.post('/research/:id/edit', requireAuth, ownerOnly, (req, res) => {
  const { user } = req.session;
  const entryId = Number(req.params.id);
  const { title, summary, tickers, confidence, minutes_spent } = req.body;
  if (!title?.trim() || !summary?.trim()) {
    setFlash(req, 'error', 'Title and summary are required.');
    return res.redirect('/dashboard');
  }
  const payload = {
    title: title.trim().slice(0, 255),
    summary: summary.trim().slice(0, 5000),
    tickers: parseTickers(tickers).slice(0, 255),
    links: JSON.stringify(parseLinks(req.body.links)),
    confidence: Math.min(5, Math.max(1, Number(confidence) || 3)),
    minutes_spent: Math.min(1440, Math.max(0, Number(minutes_spent) || 0)),
  };
  const success = updateResearch(entryId, user.id, payload);
  if (success) {
    writeAudit(user.id, 'research.edit', 'research', entryId, {});
    setFlash(req, 'success', 'Research entry updated.');
  } else {
    setFlash(req, 'error', 'Unable to update entry.');
  }
  res.redirect('/dashboard');
});

app.post('/research/:id/delete', requireAuth, ownerOnly, (req, res) => {
  const { user } = req.session;
  const entryId = Number(req.params.id);
  const success = deleteResearch(entryId, user.id);
  if (success) {
    writeAudit(user.id, 'research.delete', 'research', entryId, {});
    setFlash(req, 'success', 'Entry removed.');
  } else {
    setFlash(req, 'error', 'Unable to remove entry.');
  }
  res.redirect('/dashboard');
});

function buildHeatmap(map) {
  return Array.from(map.entries()).map(([day, count]) => ({ day, count }));
}

function userStats(user) {
  const today = todayUTC();
  const hasToday = Boolean(getCheckin(user.id, today));
  const lastActivity = getLastActivity(user.id);
  const streak = computeStreak(user.id);
  const completion30 = computeCompletion(user.id, 30);
  const completion90 = computeCompletion(user.id, 90);
  const completion7 = computeCompletion(user.id, 7);
  const heatmap = buildHeatmap(getDailyPresenceMap(user.id, 90));
  return {
    user,
    hasToday,
    lastActivity,
    streak,
    completion30,
    completion90,
    completion7,
    heatmap,
  };
}

app.get('/public', (req, res) => {
  const users = getAllUsers();
  const stats = users.map(userStats);
  const filterUser = req.query.user || 'All';
  const range = Number(req.query.range) || 30;
  const rangeDays = [7, 30, 90].includes(range) ? range : 30;
  const feed = getRecentResearch({ limit: 30, userName: filterUser, days: rangeDays });
  res.render('public', {
    title: 'Public Dashboard',
    stats,
    feed,
    filterUser,
    rangeDays,
  });
});

app.get('/u/:name', (req, res) => {
  const user = getUserByName(req.params.name);
  if (!user) {
    return res.status(404).render('public', {
      title: 'Not found',
      stats: [],
      feed: [],
      filterUser: 'All',
      rangeDays: 30,
      error: 'User not found',
    });
  }
  const stats = userStats(user);
  const feed = getRecentResearch({ limit: 30, userName: user.name, days: 90 });
  res.render('user', {
    title: `${user.name} Profile`,
    stats,
    feed,
  });
});

app.get('/api/stats', (req, res) => {
  const users = getAllUsers();
  const data = users.map((user) => {
    const streak = computeStreak(user.id);
    const completion7 = computeCompletion(user.id, 7);
    const completion30 = computeCompletion(user.id, 30);
    const completion90 = computeCompletion(user.id, 90);
    return {
      name: user.name,
      streak,
      completion7,
      completion30,
      completion90,
    };
  });
  res.json({ generated_at: nowUTCISO(), data });
});

app.use((req, res) => {
  res.status(404).render('public', {
    title: 'Not found',
    stats: [],
    feed: [],
    filterUser: 'All',
    rangeDays: 30,
    error: 'Page not found',
  });
});

app.listen(PORT, () => {
  console.log(`Crypto Research Check-In running on http://localhost:${PORT}`);
});
