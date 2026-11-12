// Telefy.me - ধাপ ৮ক: Telegram যেখানে বটের খবর পাঠায় (পেমেন্টের যাচাই ও কয়েন যোগ)
// শুধু Telegram-ই এখানে অনুরোধ পাঠাতে পারে: গোপন কোড (secret token) না মিললে সরাসরি বাতিল।
// একই পেমেন্ট বারবার এলেও কয়েন একবারই যোগ হয় (ডাটাবেসের charge_id অনন্য)।

const crypto = require("crypto");
const shared = require("../lib/shared.js");
const coins = require("../lib/coins.js");
const telegram = require("../lib/telegram.js");

const APP_URL = (process.env.APP_URL || "https://telefyme.vercel.app").replace(/\/+$/, "");

const TERMS_TEXT =
  "Telefy.me শর্তাবলী\n\n" +
  "১. কয়েন একটি ভার্চুয়াল জিনিস। এর নিজস্ব নগদ মূল্য নেই এবং কেনা কয়েন ফেরত বা অন্যকে হস্তান্তর করা যায় না।\n" +
  "২. কয়েন দিয়ে অ্যাপের ভেতরে অন্য ক্রিয়েটরদের গিফট পাঠানো যায়।\n" +
  "৩. পেমেন্ট Telegram Stars-এ হয়। কেনার আগে আপনি এই শর্ত মেনে নিচ্ছেন।\n" +
  "৪. নিয়ম ভাঙলে বা প্রতারণা ধরা পড়লে অ্যাকাউন্ট ও কয়েন বন্ধ করা হতে পারে।\n" +
  "৫. পেমেন্ট নিয়ে সমস্যা হলে /paysupport লিখুন।";

const SUPPORT_TEXT =
  "পেমেন্ট নিয়ে সমস্যা হলে (কয়েন যোগ হয়নি, ভুল টাকা কাটা হয়েছে) এই বটকে আপনার Telegram নাম আর কেনার সময় লিখে মেসেজ করুন। আমরা যাচাই করে যত দ্রুত সম্ভব সমাধান করব।";

function secretOk(header, secret) {
  if (typeof header !== "string" || typeof secret !== "string" || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function userById(config, id) {
  const r = await shared.sb(config, "users?id=eq." + id + "&select=id,telegram_id");
  if (!r.ok) throw new Error("user lookup failed: " + r.status);
  return (await r.json())[0] || null;
}

// পেমেন্ট ঠিক আছে কিনা: প্যাকেজ, দাম, মুদ্রা ও ক্রেতা মিলছে কিনা। ঠিক থাকলে { ok: true, parsed }
async function validate(config, currency, totalAmount, payload, fromId) {
  const parsed = coins.parsePayload(payload);
  if (!parsed) return { ok: false, reason: "অনুরোধটি ঠিক নেই" };
  if (currency !== "XTR" || totalAmount !== parsed.pack.stars) return { ok: false, reason: "দামে গরমিল হয়েছে" };
  const user = await userById(config, parsed.userId);
  if (!user || String(user.telegram_id) !== String(fromId)) return { ok: false, reason: "অ্যাকাউন্ট মেলেনি" };
  return { ok: true, parsed: parsed };
}

async function onPreCheckout(config, q) {
  let verdict;
  try {
    verdict = await validate(config, q.currency, q.total_amount, q.invoice_payload, q.from && q.from.id);
  } catch (e) {
    console.error("precheckout validate error:", e && e.message);
    verdict = { ok: false, reason: "এখন পেমেন্ট করা যাচ্ছে না, একটু পরে চেষ্টা করুন" };
  }
  const body = { pre_checkout_query_id: q.id, ok: verdict.ok };
  if (!verdict.ok) body.error_message = verdict.reason;
  await telegram.tgCall(config.botToken, "answerPreCheckoutQuery", body);
}

// ডাটাবেসে সমস্যা হলে এরর ছুড়ে দেয়, যাতে Telegram পরে আবার পাঠায় (সুরক্ষিত, কারণ একই পেমেন্ট দুবার যোগ হয় না)
async function onPaid(config, message) {
  const sp = message.successful_payment;
  const fromId = message.from && message.from.id;
  const verdict = await validate(config, sp.currency, sp.total_amount, sp.invoice_payload, fromId);

  if (!verdict.ok) {
    console.error("paid but invalid:", verdict.reason, sp.telegram_payment_charge_id);
    await telegram.tgCall(config.botToken, "refundStarPayment", { user_id: fromId, telegram_payment_charge_id: sp.telegram_payment_charge_id });
    await telegram.tgCall(config.botToken, "sendMessage", { chat_id: fromId, text: "পেমেন্টটি যাচাই করা যায়নি, তাই Stars ফেরত পাঠানো হয়েছে।" });
    return;
  }

  const { pack, userId } = verdict.parsed;
  const r = await shared.sb(config, "rpc/credit_purchase", {
    method: "POST",
    body: { p_user: userId, p_charge: sp.telegram_payment_charge_id, p_pack: pack.id, p_stars: pack.stars, p_coins: pack.coins },
  });
  if (!r.ok) throw new Error("credit failed: " + r.status + " " + (await r.text()).slice(0, 300));
  const added = await r.json();
  if (added === true) {
    await telegram.tgCall(config.botToken, "sendMessage", { chat_id: fromId, text: "✅ " + pack.coins + " কয়েন আপনার অ্যাকাউন্টে যোগ হয়েছে। ধন্যবাদ!" });
  }
}

async function onCommand(config, message) {
  const text = (message.text || "").trim();
  const chatId = message.chat && message.chat.id;
  if (!chatId || message.chat.type !== "private") return;
  const cmd = text.split(/[\s@]/)[0].toLowerCase();

  if (cmd === "/start") {
    await telegram.tgCall(config.botToken, "sendMessage", {
      chat_id: chatId,
      text: "Telefy.me-তে স্বাগতম! নিচের বাটনে চাপ দিয়ে অ্যাপ খুলুন।",
      reply_markup: { inline_keyboard: [[{ text: "Telefy খুলুন", web_app: { url: APP_URL } }]] },
    });
  } else if (cmd === "/terms") {
    await telegram.tgCall(config.botToken, "sendMessage", { chat_id: chatId, text: TERMS_TEXT });
  } else if (cmd === "/paysupport" || cmd === "/support") {
    await telegram.tgCall(config.botToken, "sendMessage", { chat_id: chatId, text: SUPPORT_TEXT });
  }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "শুধু POST চলবে" });
    return;
  }
  const config = shared.getConfig();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!config || !secret) {
    res.status(500).json({ error: "সার্ভারের সেটিংস অসম্পূর্ণ" });
    return;
  }
  if (!secretOk(req.headers["x-telegram-bot-api-secret-token"], secret)) {
    res.status(401).json({ error: "অনুমতি নেই" });
    return;
  }

  let update;
  try {
    update = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch (e) {
    res.status(400).json({ error: "পাঠানো তথ্য বোঝা যায়নি" });
    return;
  }

  try {
    if (update.pre_checkout_query) {
      await onPreCheckout(config, update.pre_checkout_query);
    } else if (update.message && update.message.successful_payment) {
      await onPaid(config, update.message);
    } else if (update.message && typeof update.message.text === "string") {
      try {
        await onCommand(config, update.message);
      } catch (e) {
        console.error("command error:", e && e.message);
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("webhook error:", e && e.message);
    res.status(500).json({ error: "প্রক্রিয়া করা যায়নি" });
  }
}

module.exports = handler;
