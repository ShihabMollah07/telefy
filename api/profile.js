// Telefy.me - ধাপ ৩: প্রোফাইল আপডেট
// ইউজার নিজের নাম, ইউজারনেম, বায়ো, জেন্ডার ও বয়স বদলাতে পারবে।
// কয়েন বা অন্য কোনো ফিল্ড এখান থেকে বদলানো যাবে না।

const { verifyInitData } = require("./auth.js");

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const GENDERS = ["male", "female", "other"];
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function supabaseHeaders(key, extra) {
  const headers = Object.assign({ apikey: key, "Content-Type": "application/json" }, extra || {});
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  return headers;
}

function length(text) {
  return Array.from(text).length;
}

// ইউজারের পাঠানো তথ্য যাচাই করে। ঠিক থাকলে { values }, ভুল থাকলে { error } ফেরত দেয়।
function validate(body) {
  const values = {};

  if (body.display_name !== undefined) {
    const name = String(body.display_name).trim();
    if (length(name) < 1 || length(name) > 50 || CONTROL_CHARS.test(name)) {
      return { error: "নাম ১ থেকে ৫০ অক্ষরের মধ্যে হতে হবে" };
    }
    values.display_name = name;
  }

  if (body.username !== undefined) {
    const username = String(body.username).trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      return { error: "ইউজারনেমে শুধু ইংরেজি ছোট হাতের অক্ষর (a-z), সংখ্যা ও _ চলবে, ৩ থেকে ২৪ অক্ষর" };
    }
    values.username = username;
  }

  if (body.bio !== undefined) {
    const bio = body.bio === null ? "" : String(body.bio).trim();
    if (length(bio) > 150 || CONTROL_CHARS.test(bio.replace(/\n/g, ""))) {
      return { error: "বায়ো সর্বোচ্চ ১৫০ অক্ষরের হতে পারে" };
    }
    values.bio = bio === "" ? null : bio;
  }

  if (body.gender !== undefined) {
    if (body.gender === null || body.gender === "") {
      values.gender = null;
    } else if (GENDERS.indexOf(body.gender) !== -1) {
      values.gender = body.gender;
    } else {
      return { error: "জেন্ডার ঠিকমতো বাছাই করা হয়নি" };
    }
  }

  if (body.age !== undefined) {
    if (body.age === null || body.age === "") {
      values.age = null;
    } else {
      const age = Number(body.age);
      if (!Number.isInteger(age) || age < 13 || age > 99) {
        return { error: "বয়স ১৩ থেকে ৯৯ এর মধ্যে হতে হবে" };
      }
      values.age = age;
    }
  }

  if (Object.keys(values).length === 0) {
    return { error: "বদলানোর মতো কিছু পাঠানো হয়নি" };
  }
  return { values: values };
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

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch (e) {
    res.status(400).json({ error: "পাঠানো তথ্য বোঝা যায়নি" });
    return;
  }

  // ইউজার কে, তা Telegram-এর যাচাই করা তথ্য থেকে আসে, ইউজারের পাঠানো আইডি থেকে নয়
  const tgUser = verifyInitData(body.initData, botToken);
  if (!tgUser) {
    res.status(401).json({ error: "লগইন তথ্য যাচাই হয়নি" });
    return;
  }

  const checked = validate(body);
  if (checked.error) {
    res.status(400).json({ error: checked.error });
    return;
  }

  try {
    const url =
      supabaseUrl.replace(/\/+$/, "") +
      "/rest/v1/users?telegram_id=eq." +
      tgUser.id +
      "&select=id,telegram_id,display_name,username,bio,gender,age,coins,created_at";

    const response = await fetch(url, {
      method: "PATCH",
      headers: supabaseHeaders(supabaseKey, { Prefer: "return=representation" }),
      body: JSON.stringify(checked.values),
    });

    if (response.status === 409) {
      res.status(409).json({ error: "এই ইউজারনেম আগেই নেওয়া হয়েছে, অন্যটি চেষ্টা করুন" });
      return;
    }
    if (!response.ok) throw new Error("update failed: " + response.status);

    const rows = await response.json();
    if (!rows[0]) {
      res.status(404).json({ error: "অ্যাকাউন্ট পাওয়া যায়নি" });
      return;
    }
    res.status(200).json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: "ডাটাবেসে সমস্যা হয়েছে" });
  }
}

module.exports = handler;
module.exports.validate = validate;
