// Telefy.me - Telegram Bot API-তে অনুরোধ পাঠানোর ছোট সহায়ক

async function tgCall(botToken, method, body) {
  const res = await fetch("https://api.telegram.org/bot" + botToken + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    /* ফাঁকা উত্তর */
  }
  return { ok: res.ok && data.ok === true, status: res.status, data: data };
}

module.exports = { tgCall };
