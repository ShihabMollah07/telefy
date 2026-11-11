// Telefy.me - ধাপ ৬: ফলো / আনফলো

const shared = require("../lib/shared.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req, res) {
  const auth = shared.authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const target = auth.body.user_id;
  if (typeof target !== "string" || !UUID_RE.test(target) || typeof auth.body.follow !== "boolean") {
    res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
    return;
  }

  const config = auth.config;
  try {
    const me = await shared.getUserRow(config, auth.tgUser.id);
    if (!me) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }
    if (me.id === target.toLowerCase()) {
      res.status(400).json({ error: "নিজেকে ফলো করা যায় না" });
      return;
    }

    if (auth.body.follow) {
      const ins = await shared.sb(config, "follows", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: { follower_id: me.id, following_id: target },
      });
      if (ins.status === 409) {
        res.status(404).json({ error: "ইউজারকে পাওয়া যায়নি" });
        return;
      }
      if (!ins.ok) throw new Error("follow failed: " + ins.status + " " + (await ins.text()).slice(0, 300));
    } else {
      const del = await shared.sb(config, "follows?follower_id=eq." + me.id + "&following_id=eq." + target, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
      if (!del.ok) throw new Error("unfollow failed: " + del.status);
    }

    const r = await shared.sb(config, "users?id=eq." + target + "&select=followers_count");
    if (!r.ok) throw new Error("count failed: " + r.status);
    const rows = await r.json();
    if (!rows.length) {
      res.status(404).json({ error: "ইউজারকে পাওয়া যায়নি" });
      return;
    }
    res.status(200).json({ following: auth.body.follow, followers: rows[0].followers_count });
  } catch (e) {
    console.error("follow error:", e && e.message);
    res.status(500).json({ error: "কাজটি করা যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
