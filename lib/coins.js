// Telefy.me - ধাপ ৮ক: কয়েনের প্যাকেজ (দাম সার্ভারেই ঠিক করা, ক্লায়েন্ট বদলাতে পারে না)
// ১ Star = ১ কয়েন। দাম বদলাতে শুধু এই তালিকা বদলান।

const PACKS = [
  { id: "c50", stars: 50, coins: 50 },
  { id: "c100", stars: 100, coins: 100 },
  { id: "c250", stars: 250, coins: 250 },
  { id: "c500", stars: 500, coins: 500 },
  { id: "c1000", stars: 1000, coins: 1000 },
  { id: "c2500", stars: 2500, coins: 2500 },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findPack(id) {
  return PACKS.find((p) => p.id === id) || null;
}

function buildPayload(packId, userId) {
  return packId + ":" + userId;
}

// "c100:<user-uuid>" -> { pack, userId } অথবা null
function parsePayload(payload) {
  if (typeof payload !== "string") return null;
  const parts = payload.split(":");
  if (parts.length !== 2 || !UUID_RE.test(parts[1])) return null;
  const pack = findPack(parts[0]);
  return pack ? { pack: pack, userId: parts[1].toLowerCase() } : null;
}

module.exports = { PACKS, findPack, buildPayload, parsePayload };
