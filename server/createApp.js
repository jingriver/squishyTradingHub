const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const express = require("express");
const multer = require("multer");
const path = require("path");
const querystring = require("querystring");
const { run, get, all, safeJsonParse } = require("../db");
const { createAuthService } = require("./auth");
const { createMatchmakingService } = require("./matchmaking");

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

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
    if (options.body) req.write(options.body);
    req.end();
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash: derived };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function createApp(db) {
  const app = express();
  const uploadsDir = path.join(__dirname, "..", "uploads");
  const stateStore = new Map();

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").slice(0, 8) || ".jpg";
      const safeName = `post_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
      cb(null, safeName);
    },
  });

  const upload = multer({ storage, limits: { fileSize: 4 * 1024 * 1024 } });
  const auth = createAuthService(db, SESSION_TTL_MS, { run, get });
  const matchmaking = createMatchmakingService(db, { run, get, all, safeJsonParse });

  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  app.post("/auth/register", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const name = String(req.body?.name || "").trim() || email.split("@")[0] || "Trader";
      if (!email || !email.includes("@")) {
        res.status(400).json({ error: "Valid email required." });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters." });
        return;
      }

      const existingUser = await get(db, "SELECT id, google_sub FROM users WHERE email = ?", [email]);
      if (existingUser) {
        res.status(409).json({ error: "Account already exists for this email. Log in instead." });
        return;
      }

      const now = new Date().toISOString();
      const localSub = `local:${email}`;
      const { salt, hash } = hashPassword(password);
      const result = await run(
        db,
        "INSERT INTO users (google_sub, email, name, picture, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
        [localSub, email, name, "", now, now]
      );
      await run(
        db,
        "INSERT INTO local_credentials (user_id, email, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [result.lastID, email, hash, salt, now, now]
      );
      await run(
        db,
        "INSERT INTO user_profiles (user_id, name, bio, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [result.lastID, name, "Tell people your vibe.", JSON.stringify(["new", "aesthetic"]), now, now]
      );

      const sessionToken = await auth.createSession(result.lastID);
      res.setHeader("Set-Cookie", auth.serializeCookie("sth_session", sessionToken, {
        httpOnly: true,
        sameSite: "Lax",
        secure: req.secure,
        path: "/",
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      }));
      res.status(201).json({ message: "Account created." });
    } catch (err) {
      res.status(500).json({ error: "Unable to register account." });
    }
  });

  app.post("/auth/login", async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required." });
        return;
      }

      const credential = await get(
        db,
        `SELECT lc.user_id, lc.password_hash, lc.password_salt
         FROM local_credentials lc
         WHERE lc.email = ?`,
        [email]
      );
      if (!credential || !verifyPassword(password, credential.password_salt, credential.password_hash)) {
        res.status(401).json({ error: "Invalid email or password." });
        return;
      }

      await run(db, "UPDATE users SET last_login_at = ? WHERE id = ?", [new Date().toISOString(), credential.user_id]);
      const sessionToken = await auth.createSession(credential.user_id);
      res.setHeader("Set-Cookie", auth.serializeCookie("sth_session", sessionToken, {
        httpOnly: true,
        sameSite: "Lax",
        secure: req.secure,
        path: "/",
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      }));
      res.json({ message: "Logged in." });
    } catch (err) {
      res.status(500).json({ error: "Unable to log in." });
    }
  });

  app.get("/auth/google", (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      res.status(500).send("Google OAuth is not configured.");
      return;
    }
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${auth.getBaseUrl(req)}/auth/google/callback`;
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
    if (error) return res.redirect("/?auth=error");
    const stateIssued = stateStore.get(state);
    stateStore.delete(state);
    if (!stateIssued || Date.now() - stateIssued > STATE_TTL_MS) return res.redirect("/?auth=invalid_state");
    if (!code) return res.redirect("/?auth=missing_code");

    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${auth.getBaseUrl(req)}/auth/google/callback`;
      if (!clientId || !clientSecret) return res.redirect("/?auth=missing_config");

      const tokenResponse = await requestJson("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: querystring.stringify({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const userInfo = await requestJson("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
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
      const profileRow = await get(db, "SELECT user_id FROM user_profiles WHERE user_id = ?", [userRow.id]);
      if (!profileRow) {
        await run(
          db,
          "INSERT INTO user_profiles (user_id, name, bio, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          [userRow.id, userInfo.name || "Google User", userInfo.email ? `Trading as ${userInfo.email}` : "Signed in with Google.", JSON.stringify(["new", "aesthetic"]), now, now]
        );
      }
      const sessionToken = await auth.createSession(userRow.id);
      res.setHeader("Set-Cookie", auth.serializeCookie("sth_session", sessionToken, {
        httpOnly: true,
        sameSite: "Lax",
        secure: req.secure,
        path: "/",
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      }));
      res.redirect("/?auth=success");
    } catch (err) {
      console.error("Google OAuth error:", err);
      res.redirect("/?auth=failed");
    }
  });

  app.get("/auth/logout", async (req, res) => {
    const token = auth.getSessionToken(req);
    const userId = await auth.getSessionUserId(req);
    if (userId) await run(db, "DELETE FROM matchmaking_queue WHERE user_id = ?", [userId]).catch(() => {});
    await auth.deleteSession(token);
    res.setHeader("Set-Cookie", auth.serializeCookie("sth_session", "", {
      httpOnly: true,
      sameSite: "Lax",
      secure: req.secure,
      path: "/",
      expires: new Date(0),
    }));
    res.redirect("/?auth=logged_out");
  });

  app.get("/api/session", async (req, res) => {
    try {
      const userId = await auth.getSessionUserId(req);
      if (!userId) return res.json({ authenticated: false });
      const user = await get(db, "SELECT id, email, name, picture, last_login_at FROM users WHERE id = ?", [userId]);
      if (!user) return res.json({ authenticated: false });
      res.json({ authenticated: true, user });
    } catch (err) {
      res.status(500).json({ error: "Unable to load session." });
    }
  });

  app.get("/api/listings", auth.requireAuth, async (req, res) => {
    try {
      const rows = await all(db, "SELECT * FROM listings WHERE user_id = ? ORDER BY id DESC", [req.userId]);
      res.json(rows.map((row) => ({ id: row.id, title: row.title, vibe: row.vibe, wants: row.wants })));
    } catch (err) {
      res.status(500).json({ error: "Unable to load listings." });
    }
  });

  app.post("/api/listings", auth.requireAuth, async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim();
      const wants = String(req.body?.wants || "").trim();
      const vibe = String(req.body?.vibe || "").trim() || "Fresh drop";
      if (!title || !wants) return res.status(400).json({ error: "Title and wants are required." });
      const result = await run(db, "INSERT INTO listings (title, vibe, wants, user_id, created_at) VALUES (?, ?, ?, ?, ?)", [title, vibe, wants, req.userId, new Date().toISOString()]);
      res.status(201).json({ id: result.lastID, title, vibe, wants });
    } catch (err) {
      res.status(500).json({ error: "Unable to save listing." });
    }
  });

  app.get("/api/posts", auth.requireAuth, async (req, res) => {
    try {
      const rows = await all(db, "SELECT * FROM posts WHERE user_id = ? ORDER BY id DESC", [req.userId]);
      res.json(rows.map((row) => ({ id: row.id, title: row.title, desc: row.desc, items: safeJsonParse(row.items, []), likes: row.likes, imageUrl: row.image_url || null })));
    } catch (err) {
      res.status(500).json({ error: "Unable to load posts." });
    }
  });

  app.post("/api/posts", auth.requireAuth, upload.single("image"), async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim();
      const desc = String(req.body?.desc || "").trim() || "New trade post.";
      const items = matchmaking.normalizeItems(req.body?.items);
      if (!title || items.length === 0) return res.status(400).json({ error: "Title and items are required." });
      const likes = Number.isFinite(Number(req.body?.likes)) ? Number(req.body.likes) : Math.floor(Math.random() * 220) + 40;
      const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
      const result = await run(db, "INSERT INTO posts (title, desc, items, likes, user_id, created_at, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)", [title, desc, JSON.stringify(items), likes, req.userId, new Date().toISOString(), imageUrl]);
      res.status(201).json({ id: result.lastID, title, desc, items, likes, imageUrl });
    } catch (err) {
      res.status(500).json({ error: "Unable to save post." });
    }
  });

  app.get("/api/profile", auth.requireAuth, async (req, res) => {
    try {
      let row = await get(db, "SELECT * FROM user_profiles WHERE user_id = ?", [req.userId]);
      if (!row) {
        const userRow = await get(db, "SELECT name, email FROM users WHERE id = ?", [req.userId]);
        const now = new Date().toISOString();
        const displayName = userRow?.name || "your.handle";
        const bio = userRow?.email ? `Trading as ${userRow.email}` : "Tell people your vibe.";
        await run(db, "INSERT INTO user_profiles (user_id, name, bio, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [req.userId, displayName, bio, JSON.stringify(["new", "aesthetic"]), now, now]);
        row = { name: displayName, bio, tags: JSON.stringify(["new", "aesthetic"]) };
      }
      res.json({ name: row.name, bio: row.bio, tags: safeJsonParse(row.tags, ["new", "aesthetic"]) });
    } catch (err) {
      res.status(500).json({ error: "Unable to load profile." });
    }
  });

  app.put("/api/profile", auth.requireAuth, async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim() || "your.handle";
      const bio = String(req.body?.bio || "").trim() || "Tell people your vibe.";
      const tags = matchmaking.normalizeItems(req.body?.tags);
      const safeTags = tags.length ? tags : ["new", "aesthetic"];
      const now = new Date().toISOString();
      await run(db, "INSERT INTO user_profiles (user_id, name, bio, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, bio=excluded.bio, tags=excluded.tags, updated_at=excluded.updated_at", [req.userId, name, bio, JSON.stringify(safeTags), now, now]);
      res.json({ name, bio, tags: safeTags });
    } catch (err) {
      res.status(500).json({ error: "Unable to save profile." });
    }
  });

  app.get("/api/profile/stats", auth.requireAuth, async (req, res) => {
    try {
      const [listingCount, postStats, offerCount] = await Promise.all([
        get(db, "SELECT COUNT(*) as count FROM listings WHERE user_id = ?", [req.userId]),
        get(db, "SELECT COUNT(*) as postCount, COALESCE(SUM(likes), 0) as totalLikes FROM posts WHERE user_id = ?", [req.userId]),
        get(db, "SELECT COUNT(*) as count FROM offers WHERE sender_user_id = ? OR recipient_user_id = ?", [req.userId, req.userId]),
      ]);
      res.json({ trades: Number(listingCount?.count || 0), likes: Number(postStats?.totalLikes || 0), offers: Number(offerCount?.count || 0) });
    } catch (err) {
      res.status(500).json({ error: "Unable to load profile stats." });
    }
  });

  app.get("/api/boards", auth.requireAuth, async (req, res) => {
    try {
      const rows = await all(db, `SELECT b.id, b.name, b.description, COUNT(bp.id) as itemCount FROM boards b LEFT JOIN board_posts bp ON bp.board_id = b.id GROUP BY b.id ORDER BY b.id DESC`);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: "Unable to load boards." });
    }
  });

  app.post("/api/boards", auth.requireAuth, async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim();
      const description = String(req.body?.description || "").trim() || "";
      if (!name) return res.status(400).json({ error: "Board name is required." });
      const result = await run(db, "INSERT INTO boards (name, description, created_at) VALUES (?, ?, ?)", [name, description, new Date().toISOString()]);
      res.status(201).json({ id: result.lastID, name, description, itemCount: 0 });
    } catch (err) {
      res.status(500).json({ error: "Unable to create board." });
    }
  });

  app.get("/api/boards/:id/posts", auth.requireAuth, async (req, res) => {
    try {
      const rows = await all(db, `SELECT p.* FROM board_posts bp JOIN posts p ON p.id = bp.post_id WHERE bp.board_id = ? ORDER BY bp.id DESC`, [Number(req.params.id)]);
      res.json(rows.map((row) => ({ id: row.id, title: row.title, desc: row.desc, items: safeJsonParse(row.items, []), likes: row.likes, imageUrl: row.image_url || null })));
    } catch (err) {
      res.status(500).json({ error: "Unable to load board posts." });
    }
  });

  app.post("/api/boards/:id/posts", auth.requireAuth, async (req, res) => {
    try {
      const boardId = Number(req.params.id);
      const postId = Number(req.body?.postId);
      if (!boardId || !postId) return res.status(400).json({ error: "Board and post required." });
      await run(db, "INSERT OR IGNORE INTO board_posts (board_id, post_id, created_at) VALUES (?, ?, ?)", [boardId, postId, new Date().toISOString()]);
      res.json({ status: "ok" });
    } catch (err) {
      res.status(500).json({ error: "Unable to save to board." });
    }
  });

  app.post("/api/match", auth.requireAuth, async (req, res) => {
    try {
      res.json(await matchmaking.queueOrCreateMatch(req.userId));
    } catch (err) {
      res.status(500).json({ error: "Unable to match right now." });
    }
  });

  app.post("/api/match/action", auth.requireAuth, async (req, res) => {
    try {
      const matchId = Number(req.body?.matchId);
      const action = String(req.body?.action || "").trim().toLowerCase();
      if (!matchId || !["accept", "decline"].includes(action)) return res.status(400).json({ error: "Valid match action required." });
      const match = await get(db, `SELECT * FROM matches WHERE id = ? AND (user_a_id = ? OR user_b_id = ?)`, [matchId, req.userId, req.userId]);
      if (!match) return res.status(404).json({ error: "Match not found." });
      const now = new Date().toISOString();
      if (action === "accept") {
        await run(db, "UPDATE matches SET status = 'accepted', accepted_by_user_id = ?, updated_at = ? WHERE id = ?", [req.userId, now, matchId]);
        const updated = await get(db, "SELECT * FROM matches WHERE id = ?", [matchId]);
        return res.json(await matchmaking.buildMatchPayload(updated, req.userId));
      }
      await run(db, "UPDATE matches SET status = 'declined', updated_at = ? WHERE id = ?", [now, matchId]);
      await run(db, "DELETE FROM matchmaking_queue WHERE user_id IN (?, ?)", [match.user_a_id, match.user_b_id]);
      res.json({ status: "declined", matchId });
    } catch (err) {
      res.status(500).json({ error: "Unable to update match." });
    }
  });

  app.post("/api/offers", auth.requireAuth, async (req, res) => {
    try {
      const matchId = Number(req.body?.matchId);
      const selectedPostIds = matchmaking.normalizeIdList(req.body?.selectedPostIds);
      if (!matchId || !selectedPostIds.length) return res.status(400).json({ error: "Match and selected posts are required." });
      const match = await get(db, `SELECT * FROM matches WHERE id = ? AND status IN ('active', 'accepted') AND (user_a_id = ? OR user_b_id = ?)`, [matchId, req.userId, req.userId]);
      if (!match) return res.status(404).json({ error: "Active match not found." });
      const placeholders = selectedPostIds.map(() => "?").join(", ");
      const rows = await all(db, `SELECT id, title FROM posts WHERE id IN (${placeholders})`, selectedPostIds);
      if (rows.length !== selectedPostIds.length) return res.status(400).json({ error: "One or more selected posts do not exist." });
      const recipientUserId = match.user_a_id === req.userId ? match.user_b_id : match.user_a_id;
      const createdAt = new Date().toISOString();
      const result = await run(db, "INSERT INTO offers (match_id, sender_user_id, recipient_user_id, selected_post_ids, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)", [matchId, req.userId, recipientUserId, JSON.stringify(selectedPostIds), createdAt]);
      res.status(201).json({ id: result.lastID, matchId, senderUserId: req.userId, recipientUserId, selectedPostIds, selectedPosts: rows, status: "pending", createdAt });
    } catch (err) {
      res.status(500).json({ error: "Unable to send offer." });
    }
  });

  app.get("/api/offers", auth.requireAuth, async (req, res) => {
    try {
      const scope = String(req.query?.scope || "all").trim().toLowerCase();
      const whereClause = scope === "sent" ? "o.sender_user_id = ?" : scope === "received" ? "o.recipient_user_id = ?" : "(o.sender_user_id = ? OR o.recipient_user_id = ?)";
      const params = scope === "all" ? [req.userId, req.userId] : [req.userId];
      const rows = await all(db, `SELECT o.id, o.match_id, o.sender_user_id, o.recipient_user_id, o.selected_post_ids, o.status, o.created_at, sender.name AS sender_name, recipient.name AS recipient_name, sender_profile.name AS sender_profile_name, recipient_profile.name AS recipient_profile_name FROM offers o JOIN users sender ON sender.id = o.sender_user_id JOIN users recipient ON recipient.id = o.recipient_user_id LEFT JOIN user_profiles sender_profile ON sender_profile.user_id = o.sender_user_id LEFT JOIN user_profiles recipient_profile ON recipient_profile.user_id = o.recipient_user_id WHERE ${whereClause} ORDER BY o.created_at DESC LIMIT 30`, params);
      const offers = [];
      for (const row of rows) {
        const normalizedIds = matchmaking.normalizeIdList(safeJsonParse(row.selected_post_ids, []));
        let selectedPosts = [];
        if (normalizedIds.length) {
          const placeholders = normalizedIds.map(() => "?").join(", ");
          selectedPosts = await all(db, `SELECT id, title FROM posts WHERE id IN (${placeholders})`, normalizedIds);
        }
        offers.push({
          id: row.id,
          matchId: row.match_id,
          senderUserId: row.sender_user_id,
          recipientUserId: row.recipient_user_id,
          senderName: row.sender_profile_name || row.sender_name || "Trader",
          recipientName: row.recipient_profile_name || row.recipient_name || "Trader",
          selectedPostIds: normalizedIds,
          selectedPosts,
          status: row.status,
          createdAt: row.created_at,
          direction: row.sender_user_id === req.userId ? "sent" : "received",
        });
      }
      res.json(offers);
    } catch (err) {
      res.status(500).json({ error: "Unable to load offers." });
    }
  });

  app.get("/api/feed/live", auth.requireAuth, async (req, res) => {
    try {
      const offers = await all(db, `SELECT o.id, o.selected_post_ids, o.status, o.created_at, u.name AS user_name, up.name AS profile_name FROM offers o JOIN users u ON u.id = o.sender_user_id LEFT JOIN user_profiles up ON up.user_id = o.sender_user_id ORDER BY o.created_at DESC LIMIT 12`);
      const acceptedMatches = await all(db, `SELECT m.id, m.updated_at, u.name AS user_name, up.name AS profile_name FROM matches m JOIN users u ON u.id = m.accepted_by_user_id LEFT JOIN user_profiles up ON up.user_id = m.accepted_by_user_id WHERE m.status = 'accepted' AND m.accepted_by_user_id IS NOT NULL ORDER BY m.updated_at DESC LIMIT 12`);
      const feed = [];
      for (const offer of offers) {
        const normalizedIds = matchmaking.normalizeIdList(safeJsonParse(offer.selected_post_ids, []));
        let titles = [];
        if (normalizedIds.length) {
          const placeholders = normalizedIds.map(() => "?").join(", ");
          const posts = await all(db, `SELECT id, title FROM posts WHERE id IN (${placeholders})`, normalizedIds);
          const titleMap = new Map(posts.map((post) => [post.id, post.title]));
          titles = normalizedIds.map((id) => titleMap.get(id)).filter(Boolean);
        }
        const actorName = offer.profile_name || offer.user_name || "Trader";
        feed.push({ id: `offer-${offer.id}`, type: "offer", actorName, actorInitial: actorName.slice(0, 1).toUpperCase(), message: titles.length ? `${actorName} offered ${titles.join(", ")}.` : `${actorName} sent a trade offer.`, createdAt: offer.created_at, status: offer.status });
      }
      for (const match of acceptedMatches) {
        const actorName = match.profile_name || match.user_name || "Trader";
        feed.push({ id: `match-${match.id}`, type: "accepted_match", actorName, actorInitial: actorName.slice(0, 1).toUpperCase(), message: `${actorName} accepted a trade match.`, createdAt: match.updated_at, status: "accepted" });
      }
      feed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(feed.slice(0, 12));
    } catch (err) {
      res.status(500).json({ error: "Unable to load live trade feed." });
    }
  });

  app.post("/api/chat", auth.requireAuth, (req, res) => {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "Message is required." });
    const replies = ["oooh cute! i can add a keychain too.", "that works for me. want to confirm the trade?", "can you share closeups?", "i can swap for smiski + needoh cloud."];
    res.json({ reply: replies[Math.floor(Math.random() * replies.length)] });
  });

  app.post("/api/checkout", auth.requireAuth, (req, res) => {
    res.json({ status: "ok", message: "Trade checkout started." });
  });

  app.use(express.static(path.join(__dirname, "..")));
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
  });

  return app;
}

module.exports = { createApp };
