// Telefy.me - ধাপ ৭: ব্যক্তিগত মেসেজ
// actions: inbox (চ্যাটের তালিকা), thread (একজনের সাথে চ্যাট), send (পাঠানো), unread (না-পড়া সংখ্যা)
// ইউজার শুধু নিজের চ্যাটই দেখতে পায়: "আমি" সবসময় যাচাই-করা লগইন থেকে আসে, ক্লায়েন্টের পাঠানো আইডি থেকে নয়।

const shared = require("../lib/shared.js");

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const MAX_CHARS = 1000;
const RATE_LIMIT = 20; // প্রতি মিনিটে সর্বোচ্চ ২০টি
const THREAD_PAGE = 40;
const INBOX_SCAN = 300;
const INBOX_MAX = 30;

function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const length = Array.from(text).length;
  if (length < 1 || length > MAX_CHARS) return null;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) return null;
  return text;
}

function shapeMessage(row, meId) {
  return { id: row.id, text: row.body, mine: row.sender_id === meId, created_at: row.created_at, read: !!row.read_at };
}

async function findPartner(config, username) {
  if (typeof username !== "string" || !USERNAME_RE.test(username.trim().toLowerCase())) return { bad: true };
  const r = await shared.sb(config, "users?username=eq." + username.trim().toLowerCase() + "&select=id,username,display_name");
  if (!r.ok) throw new Error("partner failed: " + r.status);
  const row = (await r.json())[0];
  return { user: row || null };
}

async function handler(req, res) {
  const auth = shared.authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const body = auth.body;
  const action = body.action;
  if (!["inbox", "thread", "send", "unread"].includes(action)) {
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

    if (action === "unread") {
      const r = await shared.sb(config, "messages?recipient_id=eq." + me.id + "&read_at=is.null&select=id&limit=100");
      if (!r.ok) throw new Error("unread failed: " + r.status);
      res.status(200).json({ unread: (await r.json()).length });
      return;
    }

    if (action === "inbox") {
      const r = await shared.sb(
        config,
        "messages?or=(sender_id.eq." + me.id + ",recipient_id.eq." + me.id + ")" +
          "&select=id,sender_id,recipient_id,body,created_at&order=created_at.desc&limit=" + INBOX_SCAN
      );
      if (!r.ok) throw new Error("inbox failed: " + r.status + " " + (await r.text()).slice(0, 300));
      const rows = await r.json();
      const lastBy = new Map();
      for (const m of rows) {
        const partner = m.sender_id === me.id ? m.recipient_id : m.sender_id;
        if (!lastBy.has(partner) && lastBy.size < INBOX_MAX) lastBy.set(partner, m);
      }
      const ids = Array.from(lastBy.keys());
      if (!ids.length) {
        res.status(200).json({ conversations: [] });
        return;
      }
      const uRes = await shared.sb(config, "users?id=in.(" + ids.join(",") + ")&select=id,username,display_name");
      if (!uRes.ok) throw new Error("partners failed: " + uRes.status);
      const users = new Map((await uRes.json()).map((u) => [u.id, u]));
      const unRes = await shared.sb(config, "messages?recipient_id=eq." + me.id + "&read_at=is.null&select=sender_id&limit=1000");
      if (!unRes.ok) throw new Error("unread failed: " + unRes.status);
      const unread = new Map();
      for (const x of await unRes.json()) unread.set(x.sender_id, (unread.get(x.sender_id) || 0) + 1);

      const conversations = ids
        .filter((id) => users.has(id))
        .map((id) => {
          const m = lastBy.get(id);
          return {
            user: users.get(id),
            last: { text: m.body, mine: m.sender_id === me.id, created_at: m.created_at },
            unread: unread.get(id) || 0,
          };
        });
      res.status(200).json({ conversations: conversations });
      return;
    }

    // thread, send: দুটোতেই অন্য পাশের ইউজার লাগে
    const found = await findPartner(config, body.with);
    if (found.bad) {
      res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
      return;
    }
    if (!found.user) {
      res.status(404).json({ error: "ইউজারকে পাওয়া যায়নি" });
      return;
    }
    const partner = found.user;
    if (partner.id === me.id) {
      res.status(400).json({ error: "নিজেকে মেসেজ পাঠানো যায় না" });
      return;
    }

    if (action === "thread") {
      const before = body.before;
      if (before !== undefined && before !== null && !(typeof before === "string" && CURSOR_RE.test(before))) {
        res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
        return;
      }
      let path =
        "messages?or=(and(sender_id.eq." + me.id + ",recipient_id.eq." + partner.id + "),and(sender_id.eq." + partner.id + ",recipient_id.eq." + me.id + "))" +
        "&select=id,sender_id,body,created_at,read_at&order=created_at.desc&limit=" + THREAD_PAGE;
      if (before) path += "&created_at=lt." + encodeURIComponent(before);
      const r = await shared.sb(config, path);
      if (!r.ok) throw new Error("thread failed: " + r.status + " " + (await r.text()).slice(0, 300));
      const rows = await r.json();

      if (!before) {
        // এই চ্যাট খুললে/ঝালাই করলে অন্যজনের পাঠানো মেসেজ "পড়া হয়েছে" হয়
        await shared.sb(
          config,
          "messages?recipient_id=eq." + me.id + "&sender_id=eq." + partner.id + "&read_at=is.null",
          { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { read_at: new Date().toISOString() } }
        );
      }
      res.status(200).json({
        partner: partner,
        messages: rows.map((m) => shapeMessage(m, me.id)).reverse(),
        next: rows.length === THREAD_PAGE ? rows[rows.length - 1].created_at : null,
      });
      return;
    }

    // send
    const text = cleanText(body.text);
    if (!text) {
      res.status(400).json({ error: "মেসেজ ১ থেকে " + MAX_CHARS + " অক্ষরের মধ্যে লিখুন" });
      return;
    }
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const recent = await shared.sb(
      config,
      "messages?sender_id=eq." + me.id + "&created_at=gt." + encodeURIComponent(since) + "&select=id&limit=" + RATE_LIMIT
    );
    if (!recent.ok) throw new Error("rate check failed: " + recent.status);
    if ((await recent.json()).length >= RATE_LIMIT) {
      res.status(429).json({ error: "অনেক দ্রুত মেসেজ পাঠাচ্ছেন, একটু অপেক্ষা করুন" });
      return;
    }
    const ins = await shared.sb(config, "messages?select=id,sender_id,body,created_at,read_at", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { sender_id: me.id, recipient_id: partner.id, body: text },
    });
    if (!ins.ok) throw new Error("send failed: " + ins.status + " " + (await ins.text()).slice(0, 300));
    const rows = await ins.json();
    res.status(200).json({ message: shapeMessage(rows[0], me.id) });
  } catch (e) {
    console.error("messages error:", e && e.message);
    res.status(500).json({ error: "মেসেজের কাজ করা যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
