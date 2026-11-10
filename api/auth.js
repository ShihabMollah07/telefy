// Telefy.me - ধাপ ২: Telegram লগইন যাচাই + ইউজার অ্যাকাউন্ট
// এই ফাইল Vercel-এ সার্ভারে চলে। গোপন কী (টোকেন) শুধু Vercel-এর Environment Variables-এ থাকবে।

const crypto = require("crypto");

const MAX_AGE_SECONDS = 24 * 60 * 60; // ২৪ ঘণ্টার পুরনো লগইন তথ্য গ্রহণ করা হবে না

// Telegram-এর পাঠানো তথ্য আসল কিনা যাচাই করে। আসল হলে ইউজার ফেরত দেয়, নয়তো null।
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = Array.from(params.entries())
    .map(([key, value]) => key + "=" + value)
    .sort()
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get("user"));
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}

function supabaseHeaders(key, extra) {
  const headers = Object.assign({ apikey: key, "Content-Type": "application/json" }, extra || {});
  // পুরনো ধরনের (JWT) কী হলে Authorization হেডারও লাগে
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  return headers;
}

async function getOrCreateUser(tgUser, supabaseUrl, key) {
  const base = supabaseUrl.replace(/\/+$/, "") + "/rest/v1/users";

  // নতুন ইউজার হলে তৈরি হবে, আগে থেকে থাকলে কিছুই বদলাবে না
  const insertRes = await fetch(base + "?on_conflict=telegram_id", {
    method: "POST",
    headers: supabaseHeaders(key, { Prefer: "resolution=ignore-duplicates" }),
    body: JSON.stringify({
      telegram_id: tgUser.id,
      first_name: tgUser.first_name || null,
      last_name: tgUser.last_name || null,
      telegram_username: tgUser.username || null,
      display_name: tgUser.first_name || "ইউজার",
      username: "user_" + tgUser.id,
    }),
  });
  if (!insertRes.ok) throw new Error("insert failed: " + insertRes.status);

  const selectRes = await fetch(
    base +
      "?telegram_id=eq." +
      tgUser.id +
      "&select=id,telegram_id,display_name,username,bio,gender,age,coins,created_at",
    { headers: supabaseHeaders(key) }
  );
  if (!selectRes.ok) throw new Error("select failed: " + selectRes.status);
  const rows = await selectRes.json();
  return rows[0] || null;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "শুধু POST চলবে" });
    return;
  }

  const botToken = process.env.BOT_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!botToken || !supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "সার্ভারের সেটিংস অসম্পূর্ণ (Environment Variables)" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const tgUser = verifyInitData(body.initData, botToken);
  if (!tgUser) {
    res.status(401).json({ error: "লগইন তথ্য যাচাই হয়নি" });
    return;
  }

  try {
    const user = await getOrCreateUser(tgUser, supabaseUrl, supabaseKey);
    res.status(200).json({ user: user });
  } catch (e) {
    res.status(500).json({ error: "ডাটাবেসে সমস্যা হয়েছে" });
  }
}

module.exports = handler;
module.exports.verifyInitData = verifyInitData;
