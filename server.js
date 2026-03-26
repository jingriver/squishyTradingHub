require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const https = require("https");
const querystring = require("querystring");
const { initDb, run, get, all, safeJsonParse } = require("./db");

const app = express();
const port = process.env.PORT || 8000;

app.set("trust proxy", 1);
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 8) || ".jpg";
    const safeName = `post_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
});

const stateStore = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  if (options.path) parts.push(`Path=${options.path}`);
  return parts.join("; ");
}

function getBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  return `${req.protocol}://${req.get("host")}`;
}

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await run(
    db,
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [token, userId, now.toISOString(), expiresAt.toISOString()]
  );
  return token;
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies.sth_session || null;
}

async function getSessionUserId(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = await get(
    db,
    "SELECT user_id, expires_at FROM sessions WHERE token = ?",
    [token]
  );
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await run(db, "DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }
  return session.user_id;
}

async function deleteSession(token) {
  if (!token) return;
  await run(db, "DELETE FROM sessions WHERE token = ?", [token]);
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        method: options.method || "GET",
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        headers: options.headers || {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Request failed: ${res.statusCode} ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

const matches = [
  {
    name: "Luna",
    vibe: "Trades: smiski, mofusand. Aesthetic: moody cafe.",
    tags: ["smiski", "warm tones", "glow shelf"],
    wants: "Looking for Needoh Swirl + Squishy Star",
    opener: "hey! love your pastel vibe. got any glow smiski?",
  },
  {
    name: "Aria",
    vibe: "Trades: needohs, plush squishys. Aesthetic: pastel cloud.",
    tags: ["pastel", "cloud core", "soft focus"],
    wants: "Wants Smiski Yoga + rare mofusand",
    opener: "hii! your needohs are cute. wanna trade?",
  },
  {
    name: "Kai",
    vibe: "Trades: smiski. Aesthetic: clean desk neutrals.",
    tags: ["minimal", "clean desk", "light wood"],
    wants: "Looking for Needoh Cloud",
    opener: "yo! i have smiski dupes if you have needoh cloud.",
  },
];

function randomPick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeItems(items) {
  if (Array.isArray(items)) {
    return items.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof items === "string") {
    return items
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

let db;

app.use("/uploads", express.static(uploadsDir));

app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).send("Google OAuth is not configured.");
    return;
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${getBaseUrl(req)}/auth/google/callback`;
  const state = crypto.randomBytes(16).toString("hex");
  stateStore.set(state, Date.now());
  const query = querystring.stringify({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    res.redirect("/?auth=error");
    return;
  }
  const stateIssued = stateStore.get(state);
  stateStore.delete(state);
  if (!stateIssued || Date.now() - stateIssued > STATE_TTL_MS) {
    res.redirect("/?auth=invalid_state");
    return;
  }
  if (!code) {
    res.redirect("/?auth=missing_code");
    return;
  }
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${getBaseUrl(req)}/auth/google/callback`;
    if (!clientId || !clientSecret) {
      res.redirect("/?auth=missing_config");
      return;
    }
    const tokenResponse = await requestJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: querystring.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const userInfo = await requestJson("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
      },
    });
    const now = new Date().toISOString();
    await run(
      db,
      `INSERT INTO users (google_sub, email, name, picture, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture, last_login_at=excluded.last_login_at`,
      [userInfo.sub, userInfo.email || "", userInfo.name || "Google User", userInfo.picture || "", now, now]
    );
    const userRow = await get(db, "SELECT id FROM users WHERE google_sub = ?", [userInfo.sub]);
    const profileRow = await get(db, "SELECT user_id FROM user_profiles WHERE user_id = ?", [
      userRow.id,
    ]);
    if (!profileRow) {
      const defaultTags = ["new", "aesthetic"];
      const displayName = userInfo.name || "Google User";
      const bio = userInfo.email ? `Trading as ${userInfo.email}` : "Signed in with Google.";
      await run(
        db,
        "INSERT INTO user_profiles (user_id, name, bio, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [userRow.id, displayName, bio, JSON.stringify(defaultTags), now, now]
      );
    }
    const sessionToken = await createSession(userRow.id);
    const cookie = serializeCookie("sth_session", sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: req.secure,
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    res.setHeader("Set-Cookie", cookie);
    res.redirect("/?auth=success");
  } catch (err) {
    console.error("Google OAuth error:", err);
    res.redirect("/?auth=failed");
  }
});

app.get("/auth/logout", async (req, res) => {
  const token = getSessionToken(req);
  await deleteSession(token);
  res.setHeader(
    "Set-Cookie",
    serializeCookie("sth_session", "", {
      httpOnly: true,
      sameSite: "Lax",
      secure: req.secure,
      path: "/",
      expires: new Date(0),
    })
  );
  res.redirect("/?auth=logged_out");
});

app.get("/api/session", async (req, res) => {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      res.json({ authenticated: false });
      return;
    }
    const user = await get(
      db,
      "SELECT id, email, name, picture, last_login_at FROM users WHERE id = ?",
      [userId]
    );
    if (!user) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, user });
  } catch (err) {
    res.status(500).json({ error: "Unable to load session." });
  }
});

app.get("/api/listings", async (req, res) => {
  try {
    const rows = await all(db, "SELECT * FROM listings ORDER BY id DESC");
    res.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        vibe: row.vibe,
        wants: row.wants,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Unable to load listings." });
  }
});

app.post("/api/listings", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const wants = String(req.body?.wants || "").trim();
    const vibe = String(req.body?.vibe || "").trim() || "Fresh drop";
    if (!title || !wants) {
      res.status(400).json({ error: "Title and wants are required." });
      return;
    }
    const result = await run(
      db,
      "INSERT INTO listings (title, vibe, wants, created_at) VALUES (?, ?, ?, ?)",
      [title, vibe, wants, new Date().toISOString()]
    );
    res.status(201).json({ id: result.lastID, title, vibe, wants });
  } catch (err) {
    res.status(500).json({ error: "Unable to save listing." });
  }
});

app.get("/api/posts", async (req, res) => {
  try {
    const rows = await all(db, "SELECT * FROM posts ORDER BY id DESC");
    res.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        desc: row.desc,
        items: safeJsonParse(row.items, []),
        likes: row.likes,
        imageUrl: row.image_url || null,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Unable to load posts." });
  }
});

app.post("/api/posts", upload.single("image"), async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const desc = String(req.body?.desc || "").trim() || "New trade post.";
    const items = normalizeItems(req.body?.items);
    if (!title || items.length === 0) {
      res.status(400).json({ error: "Title and items are required." });
      return;
    }
    const likes = Number.isFinite(Number(req.body?.likes))
      ? Number(req.body.likes)
      : Math.floor(Math.random() * 220) + 40;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const result = await run(
      db,
      "INSERT INTO posts (title, desc, items, likes, created_at, image_url) VALUES (?, ?, ?, ?, ?, ?)",
      [title, desc, JSON.stringify(items), likes, new Date().toISOString(), imageUrl]
    );
    res.status(201).json({ id: result.lastID, title, desc, items, likes, imageUrl });
  } catch (err) {
    res.status(500).json({ error: "Unable to save post." });
  }
});

app.get("/api/profile", async (req, res) => {
  try {
    const userId = await getSessionUserId(req);
    if (userId) {
      let row = await get(db, "SELECT * FROM user_profiles WHERE user_id = ?", [userId]);
      if (!row) {
        const userRow = await get(db, "SELECT name, email FROM users WHERE id = ?", [userId]);
        const now = new Date().toISOString();
        const defaultTags = ["new", "aesthetic"];
        const displayName = userRow?.name || "your.handle";
        const bio = userRow?.email ? `Trading as ${userRow.email}` : "Tell people your vibe.";
        await run(
          db,
          "INSERT INTO user_profiles (user_id, name, bio, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [userId, displayName, bio, JSON.stringify(defaultTags), now, now]
        );
        row = { name: displayName, bio, tags: JSON.stringify(defaultTags) };
      }
      res.json({
        name: row.name,
        bio: row.bio,
        tags: safeJsonParse(row.tags, ["new", "aesthetic"]),
      });
      return;
    }
    const row = await get(db, "SELECT * FROM profile WHERE id = 1");
    if (!row) {
      res.json({ name: "your.handle", bio: "Tell people your vibe.", tags: ["new", "aesthetic"] });
      return;
    }
    res.json({
      name: row.name,
      bio: row.bio,
      tags: safeJsonParse(row.tags, ["new", "aesthetic"]),
    });
  } catch (err) {
    res.status(500).json({ error: "Unable to load profile." });
  }
});

app.put("/api/profile", async (req, res) => {
  try {
    const userId = await getSessionUserId(req);
    if (!userId) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const name = String(req.body?.name || "").trim() || "your.handle";
    const bio = String(req.body?.bio || "").trim() || "Tell people your vibe.";
    const tags = normalizeItems(req.body?.tags);
    const safeTags = tags.length ? tags : ["new", "aesthetic"];
    const now = new Date().toISOString();
    await run(
      db,
      "INSERT INTO user_profiles (user_id, name, bio, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)\n      ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, bio=excluded.bio, tags=excluded.tags, updated_at=excluded.updated_at",
      [userId, name, bio, JSON.stringify(safeTags), now, now]
    );
    res.json({ name, bio, tags: safeTags });
  } catch (err) {
    res.status(500).json({ error: "Unable to save profile." });
  }
});

app.get("/api/boards", async (req, res) => {
  try {
    const rows = await all(
      db,
      `SELECT b.id, b.name, b.description, COUNT(bp.id) as itemCount
       FROM boards b
       LEFT JOIN board_posts bp ON bp.board_id = b.id
       GROUP BY b.id
       ORDER BY b.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Unable to load boards." });
  }
});

app.post("/api/boards", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim() || "";
    if (!name) {
      res.status(400).json({ error: "Board name is required." });
      return;
    }
    const result = await run(
      db,
      "INSERT INTO boards (name, description, created_at) VALUES (?, ?, ?)",
      [name, description, new Date().toISOString()]
    );
    res.status(201).json({ id: result.lastID, name, description, itemCount: 0 });
  } catch (err) {
    res.status(500).json({ error: "Unable to create board." });
  }
});

app.get("/api/boards/:id/posts", async (req, res) => {
  try {
    const boardId = Number(req.params.id);
    const rows = await all(
      db,
      `SELECT p.* FROM board_posts bp
       JOIN posts p ON p.id = bp.post_id
       WHERE bp.board_id = ?
       ORDER BY bp.id DESC`,
      [boardId]
    );
    res.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        desc: row.desc,
        items: safeJsonParse(row.items, []),
        likes: row.likes,
        imageUrl: row.image_url || null,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Unable to load board posts." });
  }
});

app.post("/api/boards/:id/posts", async (req, res) => {
  try {
    const boardId = Number(req.params.id);
    const postId = Number(req.body?.postId);
    if (!boardId || !postId) {
      res.status(400).json({ error: "Board and post required." });
      return;
    }
    await run(
      db,
      "INSERT OR IGNORE INTO board_posts (board_id, post_id, created_at) VALUES (?, ?, ?)",
      [boardId, postId, new Date().toISOString()]
    );
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "Unable to save to board." });
  }
});

app.post("/api/match", (req, res) => {
  res.json(randomPick(matches));
});

app.post("/api/chat", (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) {
    res.status(400).json({ error: "Message is required." });
    return;
  }
  const replies = [
    "oooh cute! i can add a keychain too.",
    "that works for me. want to confirm the trade?",
    "can you share closeups?",
    "i can swap for smiski + needoh cloud.",
  ];
  res.json({ reply: randomPick(replies) });
});

app.post("/api/checkout", (req, res) => {
  res.json({ status: "ok", message: "Trade checkout started." });
});

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

initDb()
  .then((database) => {
    db = database;
    app.listen(port, () => {
      console.log(`Trading Hub running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
