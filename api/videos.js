// Telefy.me - ধাপ ৪: ইউজারের নিজের ভিডিওর তালিকা
// যেসব ভিডিও এখনো আপলোড বা প্রসেস হচ্ছে, সেগুলোর সর্বশেষ অবস্থা Bunny থেকে জেনে ডাটাবেসে হালনাগাদ করে।
// ৬০ সেকেন্ডের বেশি লম্বা ভিডিও এখানেই ধরা পড়ে মুছে ফেলা হয় (ইউজারের ফোনের পরীক্ষা এড়িয়ে গেলেও)।

const shared = require("../lib/shared.js");
const bunny = require("../lib/bunny.js");

const MAX_SECONDS = 60;
const TOLERANCE_SECONDS = 5;
const UPLOAD_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_SYNC_PER_REQUEST = 12;

async function syncVideo(config, bunnyConfig, video) {
  const info = await bunny.getVideo(bunnyConfig, video.bunny_video_id);
  const ageMs = Date.now() - new Date(video.created_at).getTime();

  let status = video.status;
  let failReason = null;
  let duration = video.duration_seconds;

  if (info === null) {
    status = "failed";
    failReason = "missing";
  } else if (info.length > MAX_SECONDS + TOLERANCE_SECONDS) {
    await bunny.deleteVideo(bunnyConfig, video.bunny_video_id);
    status = "failed";
    failReason = "too_long";
    duration = info.length;
  } else {
    status = bunny.mapStatus(info);
    if (info.length > 0) duration = info.length;
    if (status === "failed") failReason = "encode_failed";
    if (status === "uploading" && ageMs > UPLOAD_TIMEOUT_MS) {
      status = "failed";
      failReason = "upload_timeout";
    }
  }

  if (status === video.status && duration === video.duration_seconds) return;

  const res = await shared.sb(config, "videos?id=eq." + video.id, {
    method: "PATCH",
    body: { status: status, fail_reason: failReason, duration_seconds: duration },
  });
  if (!res.ok) throw new Error("video update failed: " + res.status);

  video.status = status;
  video.duration_seconds = duration;
}

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

  const config = auth.config;
  try {
    const user = await shared.getUserRow(config, auth.tgUser.id);
    if (!user) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }

    const listRes = await shared.sb(
      config,
      "videos?user_id=eq." + user.id +
        "&select=id,bunny_video_id,caption,status,duration_seconds,created_at&order=created_at.desc&limit=60"
    );
    if (!listRes.ok) throw new Error("list failed: " + listRes.status);
    const videos = await listRes.json();

    const pending = videos
      .filter(function (v) { return v.status === "uploading" || v.status === "processing"; })
      .slice(0, MAX_SYNC_PER_REQUEST);
    await Promise.all(pending.map(function (v) { return syncVideo(config, bunnyConfig, v).catch(function () {}); }));

    res.status(200).json({
      libraryId: bunnyConfig.libraryId,
      videos: videos.map(function (v) {
        return {
          id: v.id,
          video_id: v.bunny_video_id,
          caption: v.caption,
          status: v.status,
          duration: v.duration_seconds,
          thumbnail: v.status === "ready" ? bunny.thumbnailUrl(bunnyConfig, v.bunny_video_id) : null,
          created_at: v.created_at,
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ error: "ভিডিওর তালিকা আনা যায়নি" });
  }
}

module.exports = handler;
