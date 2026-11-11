// Telefy.me - ধাপ ৬: ডিসকভার (খোঁজা, নতুন ক্রিয়েটর, ট্রেন্ডিং ভিডিও)

const shared = require("../lib/shared.js");
const bunny = require("../lib/bunny.js");

const QUERY_RE = /^[\p{L}\p{M}\p{N}_ ]{1,30}$/u;

function shapeUser(row, followingSet) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    followers: row.followers_count,
    is_following: followingSet.has(row.id),
  };
}

async function followingSetFor(config, meId, ids) {
  if (!ids.length) return new Set();
  const r = await shared.sb(config, "follows?follower_id=eq." + meId + "&following_id=in.(" + ids.join(",") + ")&select=following_id");
  if (!r.ok) throw new Error("follow check failed: " + r.status);
  return new Set((await r.json()).map((x) => x.following_id));
}

async function handler(req, res) {
  const auth = shared.authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const action = auth.body.action;
  if (action !== "search" && action !== "home") {
    res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
    return;
  }
  const bunnyConfig = bunny.getBunnyConfig();
  if (!bunnyConfig) {
    res.status(500).json({ error: "ভিডিও সার্ভিসের সেটিংস অসম্পূর্ণ (Environment Variables)" });
    return;
  }

  const config = auth.config;
  const fields = "id,username,display_name,followers_count";
  try {
    const me = await shared.getUserRow(config, auth.tgUser.id);
    if (!me) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }

    if (action === "search") {
      let q = typeof auth.body.q === "string" ? auth.body.q.trim().replace(/^@+/, "") : "";
      if (!q) {
        res.status(200).json({ users: [] });
        return;
      }
      if (!QUERY_RE.test(q)) {
        res.status(400).json({ error: "খোঁজার লেখায় শুধু অক্ষর, সংখ্যা আর _ চলবে" });
        return;
      }
      const enc = encodeURIComponent(q);
      const r = await shared.sb(
        config,
        "users?or=(username.ilike.*" + enc + "*,display_name.ilike.*" + enc + "*)&id=neq." + me.id +
          "&select=" + fields + "&order=followers_count.desc&limit=20"
      );
      if (!r.ok) throw new Error("search failed: " + r.status + " " + (await r.text()).slice(0, 300));
      const rows = await r.json();
      const set = await followingSetFor(config, me.id, rows.map((x) => x.id));
      res.status(200).json({ users: rows.map((x) => shapeUser(x, set)) });
      return;
    }

    // home
    const cRes = await shared.sb(config, "users?id=neq." + me.id + "&select=" + fields + "&order=created_at.desc&limit=10");
    if (!cRes.ok) throw new Error("creators failed: " + cRes.status);
    const creators = await cRes.json();
    const set = await followingSetFor(config, me.id, creators.map((x) => x.id));

    const tRes = await shared.sb(
      config,
      "videos?status=eq.ready&select=id,bunny_video_id,duration_seconds,likes_count,users!user_id(username)&order=likes_count.desc,created_at.desc&limit=12"
    );
    if (!tRes.ok) throw new Error("trending failed: " + tRes.status + " " + (await tRes.text()).slice(0, 300));
    const trending = await tRes.json();

    res.status(200).json({
      libraryId: bunnyConfig.libraryId,
      creators: creators.map((x) => shapeUser(x, set)),
      trending: trending.map((v) => ({
        id: v.id,
        video_id: v.bunny_video_id,
        duration: v.duration_seconds,
        likes: v.likes_count,
        thumbnail: bunny.thumbnailUrl(bunnyConfig, v.bunny_video_id),
        author: v.users ? v.users.username : "",
      })),
    });
  } catch (e) {
    console.error("discover error:", e && e.message);
    res.status(500).json({ error: "ডিসকভার লোড করা যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
