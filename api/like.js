// Telefy.me - ধাপ ৫: লাইক দেওয়া / তোলা
// একজন ইউজার একটি ভিডিওতে একবারই লাইক দিতে পারে (ডাটাবেসের নিয়মে আটকানো)।

const shared = require("../lib/shared.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req, res) {
  const auth = shared.authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const videoId = auth.body.video_id;
  if (typeof videoId !== "string" || !UUID_RE.test(videoId) || typeof auth.body.like !== "boolean") {
    res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
    return;
  }

  const config = auth.config;
  try {
    const user = await shared.getUserRow(config, auth.tgUser.id);
    if (!user) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }

    if (auth.body.like) {
      const ins = await shared.sb(config, "video_likes", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: { user_id: user.id, video_id: videoId },
      });
      if (ins.status === 409) {
        // ভিডিও নেই
        res.status(404).json({ error: "ভিডিওটি পাওয়া যায়নি" });
        return;
      }
      if (!ins.ok) throw new Error("like failed: " + ins.status);
    } else {
      const del = await shared.sb(
        config,
        "video_likes?user_id=eq." + user.id + "&video_id=eq." + videoId,
        { method: "DELETE", headers: { Prefer: "return=minimal" } }
      );
      if (!del.ok) throw new Error("unlike failed: " + del.status);
    }

    const countRes = await shared.sb(config, "videos?id=eq." + videoId + "&select=likes_count");
    if (!countRes.ok) throw new Error("count failed: " + countRes.status);
    const rows = await countRes.json();
    if (!rows.length) {
      res.status(404).json({ error: "ভিডিওটি পাওয়া যায়নি" });
      return;
    }
    res.status(200).json({ liked: auth.body.like, likes: rows[0].likes_count });
  } catch (e) {
    console.error("like error:", e && e.message);
    res.status(500).json({ error: "লাইক দেওয়া যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
