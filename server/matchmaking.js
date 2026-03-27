function createMatchmakingService(db, queries) {
  const { run, get, all, safeJsonParse } = queries;

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

  function normalizeIdList(values) {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  async function getActiveMatchForUser(userId) {
    return get(
      db,
      `SELECT * FROM matches
       WHERE status IN ('active', 'accepted') AND (user_a_id = ? OR user_b_id = ?)
       ORDER BY id DESC
       LIMIT 1`,
      [userId, userId]
    );
  }

  async function buildMatchPayload(matchRow, viewerUserId) {
    const otherUserId = matchRow.user_a_id === viewerUserId ? matchRow.user_b_id : matchRow.user_a_id;
    const otherUser = await get(db, "SELECT id, name, email, picture FROM users WHERE id = ?", [otherUserId]);
    const otherProfile = await get(db, "SELECT name, bio, tags FROM user_profiles WHERE user_id = ?", [
      otherUserId,
    ]);
    const recentPost = await get(db, "SELECT title, items FROM posts ORDER BY id DESC LIMIT 1");
    const tags = safeJsonParse(otherProfile?.tags, []);
    const recentItems = safeJsonParse(recentPost?.items, []);
    return {
      id: matchRow.id,
      matched: true,
      waiting: false,
      status: matchRow.status,
      userId: otherUserId,
      name: otherProfile?.name || otherUser?.name || "Trader",
      vibe: otherProfile?.bio || "Open to trading right now.",
      tags: tags.length ? tags : ["new", "trader"],
      wants: recentItems.length
        ? `Interested in ${recentItems.slice(0, 3).join(", ")}`
        : "Open to trading.",
      opener: `hey! i'm ${otherProfile?.name || otherUser?.name || "a trader"}. want to compare trade items?`,
      picture: otherUser?.picture || "",
    };
  }

  async function queueOrCreateMatch(userId) {
    const existingMatch = await getActiveMatchForUser(userId);
    if (existingMatch) {
      return buildMatchPayload(existingMatch, userId);
    }

    const now = new Date().toISOString();
    await run(db, "BEGIN IMMEDIATE TRANSACTION");
    try {
      const candidate = await get(
        db,
        `SELECT mq.user_id
         FROM matchmaking_queue mq
         WHERE mq.user_id != ?
           AND NOT EXISTS (
             SELECT 1 FROM matches m
             WHERE m.status = 'active'
               AND (m.user_a_id = mq.user_id OR m.user_b_id = mq.user_id)
           )
         ORDER BY mq.created_at ASC
         LIMIT 1`,
        [userId]
      );

      const duplicateCheck = await getActiveMatchForUser(userId);
      if (duplicateCheck) {
        await run(db, "DELETE FROM matchmaking_queue WHERE user_id = ?", [userId]);
        await run(db, "COMMIT");
        return buildMatchPayload(duplicateCheck, userId);
      }

      if (!candidate) {
        await run(
          db,
          "INSERT OR IGNORE INTO matchmaking_queue (user_id, created_at) VALUES (?, ?)",
          [userId, now]
        );
        await run(db, "COMMIT");
        return { matched: false, waiting: true };
      }

      const matchResult = await run(
        db,
        "INSERT INTO matches (user_a_id, user_b_id, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
        [candidate.user_id, userId, now, now]
      );
      await run(db, "DELETE FROM matchmaking_queue WHERE user_id IN (?, ?)", [candidate.user_id, userId]);
      await run(db, "COMMIT");
      return buildMatchPayload(
        {
          id: matchResult.lastID,
          user_a_id: candidate.user_id,
          user_b_id: userId,
          status: "active",
        },
        userId
      );
    } catch (err) {
      await run(db, "ROLLBACK").catch(() => {});
      throw err;
    }
  }

  return {
    buildMatchPayload,
    getActiveMatchForUser,
    normalizeIdList,
    normalizeItems,
    queueOrCreateMatch,
  };
}

module.exports = {
  createMatchmakingService,
};
