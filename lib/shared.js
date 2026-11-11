// Telefy.me - সার্ভারের সবার ব্যবহারের সাধারণ কোড (লগইন যাচাই, ডাটাবেসে যোগাযোগ)

const { verifyInitData } = require("../api/auth.js");

function getConfig() {
  const config = {
    botToken: process.env.BOT_TOKEN,
    supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  };
  return config.botToken && config.supabaseUrl && config.supabaseKey ? config : null;
}

function supabaseHeaders(key, extra) {
  const headers = Object.assign({ apikey: key, "Content-Type": "application/json" }, extra || {});
  // পুরনো ধরনের (JWT) কী হলে Authorization হেডারও লাগে
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  return headers;
}

// Supabase-এর টেবিলে অনুরোধ পাঠায়। path উদাহরণ: "videos?user_id=eq.123&select=id"
function sb(config, path, options) {
  const opts = options || {};
  return fetch(config.supabaseUrl + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: supabaseHeaders(config.supabaseKey, opts.headers),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// অনুরোধ ঠিক আছে কিনা এবং ইউজার আসল কিনা যাচাই করে।
// সফল হলে { ok: true, config, body, tgUser }, নয়তো { ok: false, status, error }
function authenticate(req) {
  if (req.method !== "POST") return { ok: false, status: 405, error: "শুধু POST চলবে" };

  const config = getConfig();
  if (!config) return { ok: false, status: 500, error: "সার্ভারের সেটিংস অসম্পূর্ণ (Environment Variables)" };

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch (e) {
    return { ok: false, status: 400, error: "পাঠানো তথ্য বোঝা যায়নি" };
  }

  const tgUser = verifyInitData(body.initData, config.botToken);
  if (!tgUser) return { ok: false, status: 401, error: "লগইন তথ্য যাচাই হয়নি" };

  return { ok: true, config: config, body: body, tgUser: tgUser };
}

async function getUserRow(config, telegramId) {
  const res = await sb(config, "users?telegram_id=eq." + encodeURIComponent(String(telegramId)) + "&select=id,telegram_id");
  if (!res.ok) throw new Error("user lookup failed: " + res.status);
  const rows = await res.json();
  return rows[0] || null;
}

module.exports = { getConfig, sb, authenticate, getUserRow };
