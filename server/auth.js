const crypto = require("crypto");

function createAuthService(db, sessionTtlMs, queries) {
  const { run, get } = queries;

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
    const expiresAt = new Date(now.getTime() + sessionTtlMs);
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

  async function requireAuth(req, res, next) {
    try {
      const userId = await getSessionUserId(req);
      if (!userId) {
        res.status(401).json({ error: "Sign in required." });
        return;
      }
      req.userId = userId;
      next();
    } catch (err) {
      res.status(500).json({ error: "Unable to verify session." });
    }
  }

  return {
    createSession,
    deleteSession,
    getBaseUrl,
    getSessionToken,
    getSessionUserId,
    requireAuth,
    serializeCookie,
  };
}

module.exports = {
  createAuthService,
};
