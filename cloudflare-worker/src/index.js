const MOSCOW_CENTER = { lat: 55.7558, lon: 37.6173 };
const DEFAULT_RADIUS_M = 1500;

function randomPointAroundMoscow() {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * DEFAULT_RADIUS_M;
  const earthRadiusM = 6371000;
  const deltaLat = (distance * Math.cos(angle)) / earthRadiusM;
  const deltaLon = (distance * Math.sin(angle)) / (earthRadiusM * Math.cos(MOSCOW_CENTER.lat * Math.PI / 180));
  const lat = MOSCOW_CENTER.lat + deltaLat * 180 / Math.PI;
  const lon = MOSCOW_CENTER.lon + deltaLon * 180 / Math.PI;
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

function safetyDisclaimer() {
  return "Важно: WanderOS предлагает идею прогулки, а не гарантированно безопасный маршрут. Не заходите на частные, закрытые, промышленные и опасные территории."; 
}

function getCommand(message) {
  let text = "";
  if (message && message.text) {
    text = message.text;
  }
  return text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}

function buildStartText() {
  return "<b>WanderOS</b>\n\n" +
    "Serverless-версия Telegram-бота для безопасных городских мини-квестов по Москве.\n\n" +
    "Команды:\n" +
    "/help - справка\n" +
    "/profile - профиль\n" +
    "/point - случайная городская точка\n" +
    "/report - учебный отчёт\n\n" +
    safetyDisclaimer();
}

function buildHelpText() {
  return "<b>Справка WanderOS</b>\n\n" +
    "/start - запуск бота\n" +
    "/help - справка\n" +
    "/profile - профиль пользователя\n" +
    "/point - генерация безопасной демо-точки\n" +
    "/report - учебный отчёт\n\n" +
    "Эта версия работает через Cloudflare Workers и Telegram Webhook."; 
}

function buildProfileText() {
  return "<b>Профиль WanderOS</b>\n\n" +
    "Город: Москва\n" +
    "Радиус генерации: 1500 м\n" +
    "Режим: serverless / Cloudflare Workers\n" +
    "Тариф: учебный free\n\n" +
    "История маршрутов будет добавлена позже."; 
}

function buildPointText() {
  const p = randomPointAroundMoscow();
  const mapsUrl = "https://www.google.com/maps?q=" + p.lat + "," + p.lon;
  return "<b>Квест WanderOS</b>\n\n" +
    "<b>Координаты:</b> " + p.lat + ", " + p.lon + "\n" +
    "<b>Карта:</b> " + mapsUrl + "\n\n" +
    "<b>Задание:</b>\n" +
    "1. Найдите рядом городской объект, который обычно остаётся незамеченным.\n" +
    "2. Опишите его одним предложением.\n" +
    "3. Сделайте фото только если это безопасно и уместно.\n\n" +
    safetyDisclaimer();
}

function buildReportText() {
  return "<b>Отчёт WanderOS</b>\n\n" +
    "Режим работы: Cloudflare Workers + Telegram Webhook.\n" +
    "Локальный компьютер: не требуется.\n" +
    "VPS: не используется.\n" +
    "Назначение: учебная демонстрация serverless-архитектуры Telegram-бота."; 
}

function buildReply(message) {
  const command = getCommand(message);
  if (command === "/start") return buildStartText();
  if (command === "/help") return buildHelpText();
  if (command === "/profile") return buildProfileText();
  if (command === "/point") return buildPointText();
  if (command === "/report") return buildReportText();
  return "Я пока понимаю только команды.\n\nПопробуйте: /start, /help, /profile, /point, /report";
}

async function sendMessage(env, chatId, text) {
  const apiUrl = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage";
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Telegram sendMessage failed", response.status, errorText);
  }
}

async function handleTelegramUpdate(request, env) {
  const update = await request.json();
  const message = update.message || update.edited_message;

  if (!message || !message.chat || !message.chat.id) {
    return new Response("ignored", { status: 200 });
  }

  const reply = buildReply(message);
  await sendMessage(env, message.chat.id, reply);
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({ service: "WanderOS", status: "ok", runtime: "Cloudflare Workers" });
    }

    if (url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    if (!env.TELEGRAM_BOT_TOKEN) {
      return new Response("missing TELEGRAM_BOT_TOKEN", { status: 500 });
    }

    return handleTelegramUpdate(request, env);
  }
};
