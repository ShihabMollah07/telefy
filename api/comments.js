// Telefy.me - ধাপ ৫: কমেন্ট (তালিকা / যোগ / নিজের কমেন্ট মোছা)

const shared = require("../lib/shared.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const PAGE_SIZE = 30;
const MAX_CHARS = 300;
const RATE_LIMIT = 8; // প্রতি মিনিটে সর্বোচ্চ ৮টি কমেন্ট
const SELECT = "id,body,created_at,user_id,users(username,display_name)";

function shape(row, myId) {
  return {
    id: row.id,
    text: row.body,
    created_at: row.created_at,
    mine: row.user_id === myId,
    author: {
      username: row.users ? row.users.username : "",
      display_name: row.users ? row.users.display_name : "",
    },
  };
}

function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  const length = Array.from(text).length;
  if (length < 1 || length > MAX_CHARS) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

async function commentCount(config, videoId) {
  const r = await shared.sb(config, "videos?id=eq." + videoId + "&select=comments_count");
  if (!r.ok) throw new Error("count failed: " + r.status);
  const rows = await r.json();
  return rows.length ? rows[0].comments_count : null;
}

async function handler(req, res) {
  const auth = shared.authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const body = auth.body;
  const action = body.action;
  if (action !== "list" && action !== "add" && action !== "delete") {
    res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
    return;
  }
  const idField = action === "delete" ? body.comment_id : body.video_id;
  if (typeof idField !== "string" || !UUID_RE.test(idField)) {
    res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
    return;
  }

  const config = auth.config;
  try {
    const user = await shared.getUserRow(config, auth.tgUser.id);
    if (!user) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }

    if (action === "list") {
      const before = body.before;
      if (before !== undefined && before !== null && !(typeof before === "string" && CURSOR_RE.test(before))) {
        res.status(400).json({ error: "অনুরোধ ঠিক নেই" });
        return;
      }
      let path = "video_comments?video_id=eq." + idField + "&select=" + SELECT + "&order=created_at.desc&limit=" + PAGE_SIZE;
      if (before) path += "&created_at=lt." + encodeURIComponent(before);
      const r = await shared.sb(config, path);
      if (!r.ok) throw new Error("list failed: " + r.status);
      const rows = await r.json();
      res.status(200).json({
        comments: rows.map((row) => shape(row, user.id)),
        next: rows.length === PAGE_SIZE ? rows[rows.length - 1].created_at : null,
      });
      return;
    }

    if (action === "add") {
      const text = cleanText(body.text);
      if (!text) {
        res.status(400).json({ error: "কমেন্ট ১ থেকে " + MAX_CHARS + " অক্ষরের মধ্যে লিখুন" });
        return;
      }
      const since = new Date(Date.now() - 60 * 1000).toISOString();
      const recent = await shared.sb(
        config,
        "video_comments?user_id=eq." + user.id + "&created_at=gt." + encodeURIComponent(since) + "&select=id&limit=" + RATE_LIMIT
      );
      if (!recent.ok) throw new Error("rate check failed: " + recent.status);
      if ((await recent.json()).length >= RATE_LIMIT) {
        res.status(429).json({ error: "অনেক দ্রুত কমেন্ট করছেন, একটু অপেক্ষা করুন" });
        return;
      }
      const ins = await shared.sb(config, "video_comments?select=" + SELECT, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: { video_id: idField, user_id: user.id, body: text },
      });
      if (ins.status === 409) {
        res.status(404).json({ error: "ভিডিওটি পাওয়া যায়নি" });
        return;
      }
      if (!ins.ok) throw new Error("insert failed: " + ins.status);
      const rows = await ins.json();
      res.status(200).json({ comment: shape(rows[0], user.id), comments_count: await commentCount(config, idField) });
      return;
    }

    // delete: শুধু নিজের কমেন্ট
    const del = await shared.sb(config, "video_comments?id=eq." + idField + "&user_id=eq." + user.id + "&select=id,video_id", {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (!del.ok) throw new Error("delete failed: " + del.status);
    const gone = await del.json();
    if (!gone.length) {
      res.status(404).json({ error: "কমেন্টটি পাওয়া যায়নি" });
      return;
    }
    res.status(200).json({ ok: true, comments_count: await commentCount(config, gone[0].video_id) });
  } catch (e) {
    console.error("comments error:", e && e.message);
    res.status(500).json({ error: "কমেন্টের কাজ করা যায়নি, আবার চেষ্টা করুন" });
  }
}

module.exports = handler;
