// Telefy.me - ধাপ ৪: নতুন ভিডিও আপলোডের অনুমতি দেয়
// ১) Bunny-তে খালি ভিডিও তৈরি করে  ২) ডাটাবেসে রেকর্ড রাখে  ৩) ফোন থেকে আপলোডের সই পাঠায়

const shared = require("../lib/shared.js");
const bunny = require("../lib/bunny.js");

const MAX_PER_HOUR = 10; // একজন ইউজার ঘণ্টায় সর্বোচ্চ এতটি ভিডিও শুরু করতে পারবে
const UPLOAD_VALID_SECONDS = 6 * 60 * 60;

function cleanCaption(value) {
  if (value === undefined || value === null) return { caption: null };
  const text = String(value).trim();
  if (Array.from(text).length > 150) return { error: "ক্যাপশন সর্বোচ্চ ১৫০ অক্ষরের হতে পারে" };
  return { caption: text === "" ? null : text };
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

  const checked = cleanCaption(auth.body.caption);
  if (checked.error) {
    res.status(400).json({ error: checked.error });
    return;
  }

  const config = auth.config;
  let guid = null;
  try {
    const user = await shared.getUserRow(config, auth.tgUser.id);
    if (!user) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }

    // অপব্যবহার ঠেকাতে: ঘণ্টায় সীমিত সংখ্যক ভিডিও
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await shared.sb(
      config,
      "videos?user_id=eq." + user.id + "&created_at=gte." + encodeURIComponent(since) + "&select=id&limit=" + (MAX_PER_HOUR + 1)
    );
    if (!recent.ok) throw new Error("rate check failed: " + recent.status);
    if ((await recent.json()).length >= MAX_PER_HOUR) {
      res.status(429).json({ error: "এক ঘণ্টায় অনেক ভিডিও দেওয়া হয়ে গেছে, একটু পরে চেষ্টা করুন" });
      return;
    }

    const title = checked.caption ? Array.from(checked.caption).slice(0, 100).join("") : "Telefy video";
    guid = await bunny.createVideo(bunnyConfig, title);

    const inserted = await shared.sb(config, "videos", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { user_id: user.id, bunny_video_id: guid, caption: checked.caption },
    });
    if (!inserted.ok) throw new Error("insert failed: " + inserted.status);
    const row = (await inserted.json())[0];

    res.status(200).json({
      video: { id: row.id },
      upload: bunny.signUpload(bunnyConfig, guid, UPLOAD_VALID_SECONDS),
    });
  } catch (e) {
    // ডাটাবেসে রাখা না গেলে Bunny-তে বানানো খালি ভিডিওটি মুছে ফেলি
    if (guid) await bunny.deleteVideo(bunnyConfig, guid).catch(function () {});
    res.status(500).json({ error: "ভিডিও আপলোড শুরু করা যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
module.exports.cleanCaption = cleanCaption;
