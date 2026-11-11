// Telefy.me - ধাপ ৬: যেকোনো ইউজারের প্রোফাইল দেখা
// শুধু প্রকাশ্য তথ্য যায়: নাম, ইউজারনেম, বায়ো, সংখ্যা, ভিডিও। বয়স, জেন্ডার, কয়েন, টেলিগ্রাম আইডি যায় না।

const shared = require("../lib/shared.js");
const bunny = require("../lib/bunny.js");

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const GRID_LIMIT = 60;

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
  const username = typeof auth.body.username === "string" ? auth.body.username.trim().toLowerCase() : "";
  if (!USERNAME_RE.test(username)) {
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

    const uRes = await shared.sb(
      config,
      "users?username=eq." + username + "&select=id,username,display_name,bio,followers_count,following_count"
    );
    if (!uRes.ok) throw new Error("user failed: " + uRes.status);
    const found = (await uRes.json())[0];
    if (!found) {
      res.status(404).json({ error: "ইউজারকে পাওয়া যায়নি" });
      return;
    }

    const vRes = await shared.sb(
      config,
      "videos?user_id=eq." + found.id + "&status=eq.ready&select=id,bunny_video_id,duration_seconds,likes_count,caption&order=created_at.desc&limit=200"
    );
    if (!vRes.ok) throw new Error("videos failed: " + vRes.status);
    const rows = await vRes.json();
    const likes = rows.reduce((sum, v) => sum + (v.likes_count || 0), 0);

    const isMe = found.id === me.id;
    let isFollowing = false;
    if (!isMe) {
      const fRes = await shared.sb(
        config,
        "follows?follower_id=eq." + me.id + "&following_id=eq." + found.id + "&select=follower_id"
      );
      if (!fRes.ok) throw new Error("follow check failed: " + fRes.status);
      isFollowing = (await fRes.json()).length > 0;
    }

    res.status(200).json({
      libraryId: bunnyConfig.libraryId,
      user: {
        id: found.id,
        username: found.username,
        display_name: found.display_name,
        bio: found.bio,
        followers: found.followers_count,
        following: found.following_count,
        likes: likes,
        is_me: isMe,
        is_following: isFollowing,
      },
      videos: rows.slice(0, GRID_LIMIT).map((v) => ({
        id: v.id,
        video_id: v.bunny_video_id,
        caption: v.caption || "",
        duration: v.duration_seconds,
        likes: v.likes_count,
        thumbnail: bunny.thumbnailUrl(bunnyConfig, v.bunny_video_id),
      })),
    });
  } catch (e) {
    console.error("user error:", e && e.message);
    res.status(500).json({ error: "প্রোফাইল আনা যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
