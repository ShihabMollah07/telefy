// Telefy.me - ধাপ ৮ক: কয়েনের ব্যালেন্স, প্যাকেজ তালিকা, কেনার ইনভয়েস লিংক
// ইনভয়েস শুধু সার্ভারেই বানানো হয়: দাম আসে PACKS থেকে, ক্লায়েন্ট শুধু প্যাকেজের নাম বলে।

const shared = require("../lib/shared.js");
const coins = require("../lib/coins.js");
const telegram = require("../lib/telegram.js");

// সার্ভারের একই ইনস্ট্যান্সে খুব দ্রুত বারবার ইনভয়েস চাওয়া আটকায় (সম্পূর্ণ নিশ্চিত সীমা নয়, বাড়তি সুরক্ষা)
const recent = new Map();
function tooFast(key) {
  const now = Date.now();
  const list = (recent.get(key) || []).filter((t) => now - t < 30000);
  if (list.length >= 6) { recent.set(key, list); return true; }
  list.push(now);
  recent.set(key, list);
  return false;
}

async function getBalance(config, telegramId) {
  const r = await shared.sb(config, "users?telegram_id=eq." + encodeURIComponent(String(telegramId)) + "&select=id,coins");
  if (!r.ok) throw new Error("balance failed: " + r.status);
  return (await r.json())[0] || null;
}

async function handler(req, res) {
  const auth = shared.authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const action = auth.body.action;
  if (action !== "balance" && action !== "packs" && action !== "invoice") {
    res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
    return;
  }

  const config = auth.config;
  try {
    const me = await getBalance(config, auth.tgUser.id);
    if (!me) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }

    if (action === "balance") {
      res.status(200).json({ coins: me.coins });
      return;
    }
    if (action === "packs") {
      res.status(200).json({ coins: me.coins, packs: coins.PACKS });
      return;
    }

    // invoice
    const pack = coins.findPack(auth.body.pack_id);
    if (!pack) {
      res.status(400).json({ error: "প্যাকেজটি পাওয়া যায়নি" });
      return;
    }
    if (tooFast(String(auth.tgUser.id))) {
      res.status(429).json({ error: "একটু অপেক্ষা করে আবার চেষ্টা করুন" });
      return;
    }
    const made = await telegram.tgCall(config.botToken, "createInvoiceLink", {
      title: pack.coins + " কয়েন",
      description: "Telefy.me-তে গিফট পাঠানোর জন্য " + pack.coins + " কয়েন",
      payload: coins.buildPayload(pack.id, me.id),
      provider_token: "",
      currency: "XTR",
      prices: [{ label: pack.coins + " কয়েন", amount: pack.stars }],
    });
    if (!made.ok || typeof made.data.result !== "string") {
      throw new Error("createInvoiceLink failed: " + made.status + " " + JSON.stringify(made.data).slice(0, 300));
    }
    res.status(200).json({ link: made.data.result });
  } catch (e) {
    console.error("coins error:", e && e.message);
    res.status(500).json({ error: "কয়েনের কাজ করা যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
