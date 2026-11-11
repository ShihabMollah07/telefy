// Telefy.me - ধাপ ৫: সবার ভিডিওর ফিড (নতুন আগে)
// ইউজার শুধু "আরও দাও" বলে; কোন ভিডিও দেখাবে তা সার্ভার ঠিক করে।

const shared = require("../lib/shared.js");
const bunny = require("../lib/bunny.js");

const PAGE_SIZE = 8;
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

async function handler(req, res) {
  const auth = shared.authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const bunnyConfig = bunny.getBunnyConfig();
  if (!bunnyConfig) {
    res.status(500).json({ error: "ভিডিও সার্ভিসের সেটিংস অসম্পূর্ণ (Environment Variables)" });
    return;
  }

  const before = auth.body.before;
  if (before !== undefined && before !== null && !(typeof before === "string" && CURSOR_RE.test(before))) {
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

    let path =
      "videos?status=eq.ready" +
      "&select=id,bunny_video_id,caption,duration_seconds,likes_count,comments_count,created_at,users(username,display_name)" +
      "&order=created_at.desc&limit=" + PAGE_SIZE;
    if (before) path += "&created_at=lt." + encodeURIComponent(before);

    const listRes = await shared.sb(config, path);
    if (!listRes.ok) throw new Error("feed failed: " + listRes.status + " " + (await listRes.text()).slice(0, 300));
    const rows = await listRes.json();

    let likedIds = new Set();
    if (rows.length) {
      const ids = rows.map((r) => r.id).join(",");
      const likeRes = await shared.sb(
        config,
        "video_likes?user_id=eq." + user.id + "&video_id=in.(" + ids + ")&select=video_id"
      );
      if (!likeRes.ok) throw new Error("likes failed: " + likeRes.status + " " + (await likeRes.text()).slice(0, 300));
      likedIds = new Set((await likeRes.json()).map((l) => l.video_id));
    }

    const videos = rows.map((r) => ({
      id: r.id,
      video_id: r.bunny_video_id,
      caption: r.caption || "",
      duration: r.duration_seconds,
      thumbnail: bunny.thumbnailUrl(bunnyConfig, r.bunny_video_id),
      likes: r.likes_count,
      comments: r.comments_count,
      liked: likedIds.has(r.id),
      created_at: r.created_at,
      author: {
        username: r.users ? r.users.username : "",
        display_name: r.users ? r.users.display_name : "",
      },
    }));

    res.status(200).json({
      libraryId: bunnyConfig.libraryId,
      videos: videos,
      next: rows.length === PAGE_SIZE ? rows[rows.length - 1].created_at : null,
    });
  } catch (e) {
    console.error("feed error:", e && e.message);
    res.status(500).json({ error: "ফিড আনা যায়নি, একটু পরে আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
