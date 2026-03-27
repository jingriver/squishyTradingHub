const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "data.db");

function openDb() {
  return new sqlite3.Database(dbPath);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

async function ensureColumn(db, table, column, definition) {
  const rows = await all(db, `PRAGMA table_info(${table})`);
  const hasColumn = rows.some((row) => row.name === column);
  if (!hasColumn) {
    await run(db, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDb() {
  const db = openDb();
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      vibe TEXT NOT NULL,
      wants TEXT NOT NULL,
      user_id INTEGER,
      created_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      desc TEXT NOT NULL,
      items TEXT NOT NULL,
      likes INTEGER NOT NULL,
      user_id INTEGER,
      created_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS board_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(board_id, post_id)
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      picture TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS local_credentials (
      user_id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      bio TEXT NOT NULL,
      tags TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS matchmaking_queue (
      user_id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id INTEGER NOT NULL,
      user_b_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      accepted_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_a_id) REFERENCES users(id),
      FOREIGN KEY(user_b_id) REFERENCES users(id)
    )`
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL,
      recipient_user_id INTEGER NOT NULL,
      selected_post_ids TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY(match_id) REFERENCES matches(id),
      FOREIGN KEY(sender_user_id) REFERENCES users(id),
      FOREIGN KEY(recipient_user_id) REFERENCES users(id)
    )`
  );
  await run(db, "DROP TABLE IF EXISTS profile");

  await ensureColumn(db, "posts", "image_url", "TEXT");
  await ensureColumn(db, "posts", "user_id", "INTEGER");
  await ensureColumn(db, "matches", "accepted_by_user_id", "INTEGER");
  await ensureColumn(db, "listings", "user_id", "INTEGER");
  await ensureColumn(db, "offers", "recipient_user_id", "INTEGER");

  const listingCount = await get(db, "SELECT COUNT(*) as count FROM listings");
  const postCount = await get(db, "SELECT COUNT(*) as count FROM posts");

  if (listingCount.count === 0) {
    const defaults = [
      { title: "Needoh Swirl", vibe: "Soft & glossy", wants: "Smiski Yoga, Mofusand Bento" },
      { title: "Mofusand Bento", vibe: "Cafe core", wants: "Smiski series 2" },
      { title: "Smiski Yoga", vibe: "Glow mini", wants: "Needoh Cloud" },
      { title: "Squishy Star", vibe: "Pastel pop", wants: "Mofusand keychains" },
    ];
    for (const item of defaults) {
      await run(
        db,
        "INSERT INTO listings (title, vibe, wants, user_id, created_at) VALUES (?, ?, ?, ?, ?)",
        [item.title, item.vibe, item.wants, null, new Date().toISOString()]
      );
    }
  }

  if (postCount.count === 0) {
    const defaults = [
      {
        title: "Rose desk setup",
        desc: "Soft pink, marshmallow squishy closeups.",
        likes: 482,
        items: ["Needoh Swirl", "Squishy Star"],
      },
      {
        title: "Moody cafe shelf",
        desc: "Smiski glow shots + mofusand stack.",
        likes: 301,
        items: ["Smiski Yoga", "Mofusand Bento"],
      },
      {
        title: "Mini haul board",
        desc: "New smiski + needoh drop.",
        likes: 129,
        items: ["Needoh Cloud", "Smiski Yoga"],
      },
    ];
    for (const post of defaults) {
      await run(
        db,
        "INSERT INTO posts (title, desc, items, likes, user_id, created_at, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [post.title, post.desc, JSON.stringify(post.items), post.likes, null, new Date().toISOString(), null]
      );
    }
  }

  return db;
}

module.exports = {
  initDb,
  run,
  get,
  all,
  safeJsonParse,
};
