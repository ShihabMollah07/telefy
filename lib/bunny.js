// Telefy.me - Bunny Stream (ভিডিও রাখার সার্ভিস) এর সাথে যোগাযোগ

const crypto = require("crypto");

const API = "https://video.bunnycdn.com";
const TUS_ENDPOINT = API + "/tusupload";

function getBunnyConfig() {
  const libraryId = process.env.BUNNY_LIBRARY_ID;
  const apiKey = process.env.BUNNY_API_KEY;
  const cdnHostname = (process.env.BUNNY_CDN_HOSTNAME || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!libraryId || !apiKey || !cdnHostname) return null;
  return { libraryId: String(libraryId).trim(), apiKey: apiKey.trim(), cdnHostname: cdnHostname.trim() };
}

function jsonHeaders(config) {
  return { AccessKey: config.apiKey, Accept: "application/json", "Content-Type": "application/json" };
}

// Bunny-তে খালি একটি ভিডিও তৈরি করে, তার আইডি (guid) ফেরত দেয়
async function createVideo(config, title) {
  const res = await fetch(API + "/library/" + config.libraryId + "/videos", {
    method: "POST",
    headers: jsonHeaders(config),
    body: JSON.stringify({ title: title }),
  });
  if (!res.ok) throw new Error("bunny create failed: " + res.status);
  const data = await res.json();
  if (!data.guid) throw new Error("bunny create: no guid");
  return data.guid;
}

// ভিডিওর অবস্থা জানে। ভিডিও না পেলে null ফেরত দেয়
async function getVideo(config, guid) {
  const res = await fetch(API + "/library/" + config.libraryId + "/videos/" + encodeURIComponent(guid), {
    headers: jsonHeaders(config),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("bunny get failed: " + res.status);
  return res.json();
}

async function deleteVideo(config, guid) {
  const res = await fetch(API + "/library/" + config.libraryId + "/videos/" + encodeURIComponent(guid), {
    method: "DELETE",
    headers: jsonHeaders(config),
  });
  return res.ok || res.status === 404;
}

// ইউজারের ফোন থেকে সরাসরি Bunny-তে আপলোডের অনুমতিপত্র (সই)।
// সই = SHA256(libraryId + apiKey + expire + videoId)। API কী কখনো ইউজারের কাছে যায় না।
function signUpload(config, videoId, ttlSeconds) {
  const expire = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = crypto
    .createHash("sha256")
    .update(config.libraryId + config.apiKey + expire + videoId)
    .digest("hex");
  return { endpoint: TUS_ENDPOINT, libraryId: config.libraryId, videoId: videoId, signature: signature, expire: expire };
}

function thumbnailUrl(config, guid) {
  return "https://" + config.cdnHostname + "/" + guid + "/thumbnail.jpg";
}

// Bunny-র status: 0 তৈরি, 1 আপলোড হয়েছে, 2 প্রসেসিং, 3 রূপান্তর চলছে, 4 শেষ, 5 ব্যর্থ, 6 আপলোড ব্যর্থ
function mapStatus(info) {
  const status = info.status;
  if (status === 4) return "ready";
  if (status === 3 && info.availableResolutions) return "ready"; // অন্তত একটি মানে চালানো যায়
  if (status === 5 || status === 6) return "failed";
  if (status === 0) return "uploading";
  return "processing";
}

module.exports = { getBunnyConfig, createVideo, getVideo, deleteVideo, signUpload, thumbnailUrl, mapStatus, TUS_ENDPOINT };
