const DEFAULT_CENTER = { lat: 55.7558, lon: 37.6173 };
const DEFAULT_RADIUS = 1500;
const MIN_RADIUS = 200;
const MAX_RADIUS = 5000;
const HISTORY_LIMIT = 10;

function nowIso() {
  return new Date().toISOString();
}

function profileKey(chatId) {
  return "profile:" + chatId;
}

function historyKey(chatId) {
  return "history:" + chatId;
}

function cleanPoint(lat, lon) {
  return {
    lat: Number(Number(lat).toFixed(6)),
    lon: Number(Number(lon).toFixed(6))
  };
}

function randomPoint(center, radiusM) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radiusM;
  const earth = 6371000;

  const dLat = (distance * Math.cos(angle)) / earth;
  const dLon = (distance * Math.sin(angle)) / (earth * Math.cos(center.lat * Math.PI / 180));

  return cleanPoint(
    center.lat + dLat * 180 / Math.PI,
    center.lon + dLon * 180 / Math.PI
  );
}

function pointUrl(p) {
  return "https://www.google.com/maps?q=" + p.lat + "," + p.lon;
}

function routeUrl(a, b) {
  return "https://www.google.com/maps/dir/?api=1&origin=" +
    a.lat + "," + a.lon +
    "&destination=" + b.lat + "," + b.lon +
    "&travelmode=walking";
}

function commandOf(message) {
  const text = message && message.text ? message.text.trim() : "";
  if (!text) return "";
  return text.split(/\s+/)[0].split("@")[0].toLowerCase();
}

function textOf(message) {
  return message && message.text ? message.text.trim() : "";
}

function htmlSafe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function disclaimer() {
  return "Важно: WanderOS предлагает идею прогулки, а не гарантированно безопасный маршрут. Не заходите на частные, закрытые, промышленные и опасные территории.";
}

function defaultProfile(chatId, message) {
  const from = message.from || {};
  return {
    chat_id: String(chatId),
    telegram: {
      username: from.username || null,
      first_name: from.first_name || null
    },
    base_location: null,
    settings: {
      city: "Москва",
      radius_m: DEFAULT_RADIUS
    },
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

async function getProfile(env, chatId, message) {
  if (!env.WANDEROS_KV) {
    return defaultProfile(chatId, message);
  }

  const raw = await env.WANDEROS_KV.get(profileKey(chatId));
  let profile = null;

  if (raw) {
    try {
      profile = JSON.parse(raw);
    } catch {
      profile = null;
    }
  }

  if (!profile) {
    profile = defaultProfile(chatId, message);
  }

  if (!profile.settings) profile.settings = {};
  if (!profile.settings.city) profile.settings.city = "Москва";
  if (!profile.settings.radius_m) profile.settings.radius_m = DEFAULT_RADIUS;

  return profile;
}

async function saveProfile(env, chatId, profile) {
  if (!env.WANDEROS_KV) return;
  profile.updated_at = nowIso();
  await env.WANDEROS_KV.put(profileKey(chatId), JSON.stringify(profile));
}

async function getHistory(env, chatId) {
  if (!env.WANDEROS_KV) return [];

  const raw = await env.WANDEROS_KV.get(historyKey(chatId));
  if (!raw) return [];

  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function addHistory(env, chatId, item) {
  if (!env.WANDEROS_KV) return;

  const history = await getHistory(env, chatId);
  history.unshift(item);

  await env.WANDEROS_KV.put(
    historyKey(chatId),
    JSON.stringify(history.slice(0, HISTORY_LIMIT))
  );
}

function hasHome(profile) {
  return profile &&
    profile.base_location &&
    typeof profile.base_location.lat === "number" &&
    typeof profile.base_location.lon === "number";
}

function locationKeyboard() {
  return {
    keyboard: [
      [
        {
          text: "Сохранить базовую точку",
          request_location: true
        }
      ],
      [
        { text: "/profile" },
        { text: "/help" }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

function removeKeyboard() {
  return {
    remove_keyboard: true
  };
}

async function sendMessage(env, chatId, text, replyMarkup) {
  const url = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage";

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    console.error("Telegram sendMessage failed", res.status, await res.text());
  }
}

function startText() {
  return "<b>WanderOS</b>\n\n" +
    "Теперь бот работает от сохранённой базовой точки пользователя.\n\n" +
    "<b>Как пользоваться:</b>\n" +
    "1. /sethome — сохранить стартовую точку.\n" +
    "2. /point — получить точку рядом с сохранённой базой.\n" +
    "3. /route — построить пеший маршрут.\n\n" +
    "<b>Команды:</b>\n" +
    "/sethome - сохранить базовую точку\n" +
    "/profile - профиль\n" +
    "/radius 800 - изменить радиус\n" +
    "/point - точка рядом с базой\n" +
    "/route - маршрут от базы\n" +
    "/history - история\n" +
    "/report - отчёт\n" +
    "/clearhome - удалить базу\n" +
    "/demo - демо вокруг центра Москвы\n\n" +
    disclaimer();
}

function helpText() {
  return "<b>Справка WanderOS</b>\n\n" +
    "/sethome - отправить геолокацию и сохранить её в профиль\n" +
    "/profile - показать сохранённую точку и радиус\n" +
    "/radius 800 - изменить радиус генерации, от 200 до 5000 м\n" +
    "/point - случайная точка рядом с сохранённой базой\n" +
    "/route - пеший маршрут от базы до новой точки\n" +
    "/history - последние маршруты\n" +
    "/report - учебный отчёт\n" +
    "/clearhome - удалить базовую точку\n\n" +
    "Можно отправить не текущую позицию, а выбранную точку на карте: дом, вуз, работа или удобное место старта.";
}

function setHomeText() {
  return "<b>Сохранение базовой точки</b>\n\n" +
    "Нажмите кнопку «Сохранить базовую точку» и отправьте геолокацию.\n\n" +
    "После этого /point и /route будут работать относительно сохранённого адреса, а не от центра Москвы.";
}

function needHomeText() {
  return "<b>Базовая точка ещё не сохранена.</b>\n\n" +
    "Сначала используйте /sethome и отправьте геолокацию. После этого бот будет строить точки рядом с вашим выбранным адресом.";
}

function profileText(profile, historyCount) {
  let base = "не задана";

  if (hasHome(profile)) {
    base = profile.base_location.lat + ", " + profile.base_location.lon +
      "\nОбновлена: " + htmlSafe(profile.base_location.updated_at || "неизвестно");
  }

  const username = profile.telegram && profile.telegram.username
    ? "@" + htmlSafe(profile.telegram.username)
    : "не указан";

  return "<b>Профиль WanderOS</b>\n\n" +
    "<b>Telegram:</b> " + username + "\n" +
    "<b>Город:</b> " + htmlSafe(profile.settings.city || "Москва") + "\n" +
    "<b>Радиус:</b> " + profile.settings.radius_m + " м\n" +
    "<b>Базовая точка:</b> " + base + "\n" +
    "<b>Записей в истории:</b> " + historyCount + "\n\n" +
    "Изменить базовую точку: /sethome\n" +
    "Изменить радиус: /radius 1000";
}

function radiusHelpText() {
  return "<b>Настройка радиуса</b>\n\n" +
    "Формат:\n" +
    "<code>/radius 800</code>\n\n" +
    "Диапазон: " + MIN_RADIUS + "-" + MAX_RADIUS + " м.";
}

function savedRadiusText(radius) {
  return "<b>Радиус сохранён.</b>\n\n" +
    "Новый радиус: " + radius + " м.";
}

function pointText(origin, target, radius) {
  return "<b>Точка WanderOS</b>\n\n" +
    "<b>База:</b> сохранённая точка профиля\n" +
    "<b>Цель:</b> " + target.lat + ", " + target.lon + "\n" +
    "<b>Радиус:</b> " + radius + " м\n" +
    "<b>Карта:</b> " + pointUrl(target) + "\n" +
    "<b>Пеший маршрут:</b> " + routeUrl(origin, target) + "\n\n" +
    "<b>Задание:</b>\n" +
    "1. Проверьте маршрут на карте.\n" +
    "2. Не заходите на закрытые или опасные территории.\n" +
    "3. Найдите рядом необычную городскую деталь.\n\n" +
    disclaimer();
}

function routeText(origin, target, radius) {
  return "<b>Маршрут WanderOS</b>\n\n" +
    "<b>Старт:</b> сохранённая базовая точка\n" +
    "<b>Цель:</b> " + target.lat + ", " + target.lon + "\n" +
    "<b>Радиус:</b> " + radius + " м\n" +
    "<b>Пеший маршрут:</b> " + routeUrl(origin, target) + "\n\n" +
    disclaimer();
}

function homeSavedText(origin, target, radius) {
  return "<b>Базовая точка сохранена.</b>\n\n" +
    "<b>База:</b> " + origin.lat + ", " + origin.lon + "\n" +
    "<b>Радиус:</b> " + radius + " м\n\n" +
    "Теперь /point и /route работают относительно этой точки.\n\n" +
    "<b>Первая демо-точка:</b> " + target.lat + ", " + target.lon + "\n" +
    "<b>Маршрут:</b> " + routeUrl(origin, target) + "\n\n" +
    disclaimer();
}

function demoText() {
  const target = randomPoint(DEFAULT_CENTER, DEFAULT_RADIUS);

  return "<b>Демо-точка</b>\n\n" +
    "Это демо вокруг центра Москвы. Для нормальной работы используйте /sethome.\n\n" +
    "<b>Координаты:</b> " + target.lat + ", " + target.lon + "\n" +
    "<b>Карта:</b> " + pointUrl(target);
}

function historyText(history) {
  if (!history || history.length === 0) {
    return "<b>История пуста.</b>\n\n" +
      "Сначала используйте /sethome, затем /point или /route.";
  }

  let text = "<b>История WanderOS</b>\n\n";

  history.slice(0, 5).forEach((item, index) => {
    text += "<b>" + (index + 1) + ".</b> " + htmlSafe(item.type) + "\n" +
      "Дата: " + htmlSafe(item.created_at) + "\n" +
      "Цель: " + item.target.lat + ", " + item.target.lon + "\n" +
      "Маршрут: " + routeUrl(item.origin, item.target) + "\n\n";
  });

  return text.trim();
}

function reportText(profile, history) {
  return "<b>Отчёт WanderOS</b>\n\n" +
    "<b>Архитектура:</b> Telegram Webhook + Cloudflare Workers + Workers KV\n" +
    "<b>ПК:</b> не требуется\n" +
    "<b>VPS:</b> не используется\n" +
    "<b>Базовая точка:</b> " + (hasHome(profile) ? "сохранена" : "не сохранена") + "\n" +
    "<b>Радиус:</b> " + profile.settings.radius_m + " м\n" +
    "<b>История:</b> " + history.length + " записей\n\n" +
    "Бот хранит профиль пользователя и строит точки относительно сохранённого адреса.";
}

function parseRadius(text) {
  const parts = text.split(/\s+/);
  if (parts.length < 2) return null;

  const value = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_RADIUS || value > MAX_RADIUS) return null;

  return value;
}

async function handleLocation(env, chatId, message) {
  const profile = await getProfile(env, chatId, message);
  const origin = cleanPoint(message.location.latitude, message.location.longitude);
  const radius = profile.settings.radius_m || DEFAULT_RADIUS;
  const target = randomPoint(origin, radius);

  profile.base_location = {
    lat: origin.lat,
    lon: origin.lon,
    source: "telegram_location",
    updated_at: nowIso()
  };

  await saveProfile(env, chatId, profile);

  await addHistory(env, chatId, {
    type: "home_saved",
    origin,
    target,
    radius_m: radius,
    created_at: nowIso()
  });

  await sendMessage(env, chatId, homeSavedText(origin, target, radius), removeKeyboard());
}

async function generate(env, chatId, message, mode) {
  const profile = await getProfile(env, chatId, message);

  if (!hasHome(profile)) {
    await sendMessage(env, chatId, needHomeText(), locationKeyboard());
    return;
  }

  const origin = cleanPoint(profile.base_location.lat, profile.base_location.lon);
  const radius = profile.settings.radius_m || DEFAULT_RADIUS;
  const target = randomPoint(origin, radius);

  await addHistory(env, chatId, {
    type: mode,
    origin,
    target,
    radius_m: radius,
    created_at: nowIso()
  });

  if (mode === "route") {
    await sendMessage(env, chatId, routeText(origin, target, radius), removeKeyboard());
  } else {
    await sendMessage(env, chatId, pointText(origin, target, radius), removeKeyboard());
  }
}

async function handleTelegram(request, env) {
  const update = await request.json();
  const message = update.message || update.edited_message;

  if (!message || !message.chat || !message.chat.id) {
    return new Response("ignored", { status: 200 });
  }

  const chatId = message.chat.id;

  if (message.location) {
    await handleLocation(env, chatId, message);
    return new Response("ok", { status: 200 });
  }

  const command = commandOf(message);
  const text = textOf(message);

  if (command === "/start") {
    await sendMessage(env, chatId, startText());
    return new Response("ok", { status: 200 });
  }

  if (command === "/help") {
    await sendMessage(env, chatId, helpText());
    return new Response("ok", { status: 200 });
  }

  if (command === "/sethome" || command === "/location" || command === "/home") {
    await sendMessage(env, chatId, setHomeText(), locationKeyboard());
    return new Response("ok", { status: 200 });
  }

  if (command === "/profile") {
    const profile = await getProfile(env, chatId, message);
    const history = await getHistory(env, chatId);
    await sendMessage(env, chatId, profileText(profile, history.length));
    return new Response("ok", { status: 200 });
  }

  if (command === "/radius") {
    const radius = parseRadius(text);

    if (!radius) {
      await sendMessage(env, chatId, radiusHelpText());
      return new Response("ok", { status: 200 });
    }

    const profile = await getProfile(env, chatId, message);
    profile.settings.radius_m = radius;
    await saveProfile(env, chatId, profile);

    await sendMessage(env, chatId, savedRadiusText(radius));
    return new Response("ok", { status: 200 });
  }

  if (command === "/point" || command === "/near") {
    await generate(env, chatId, message, "point");
    return new Response("ok", { status: 200 });
  }

  if (command === "/route") {
    await generate(env, chatId, message, "route");
    return new Response("ok", { status: 200 });
  }

  if (command === "/history") {
    const history = await getHistory(env, chatId);
    await sendMessage(env, chatId, historyText(history));
    return new Response("ok", { status: 200 });
  }

  if (command === "/report") {
    const profile = await getProfile(env, chatId, message);
    const history = await getHistory(env, chatId);
    await sendMessage(env, chatId, reportText(profile, history));
    return new Response("ok", { status: 200 });
  }

  if (command === "/clearhome") {
    const profile = await getProfile(env, chatId, message);
    profile.base_location = null;
    await saveProfile(env, chatId, profile);

    await sendMessage(env, chatId, "<b>Базовая точка удалена.</b>\n\nЧтобы сохранить новую, используйте /sethome.", removeKeyboard());
    return new Response("ok", { status: 200 });
  }

  if (command === "/demo") {
    await sendMessage(env, chatId, demoText());
    return new Response("ok", { status: 200 });
  }

  await sendMessage(env, chatId, "Команды:\n/start\n/help\n/sethome\n/profile\n/radius 800\n/point\n/route\n/history\n/report\n/clearhome");
  return new Response("ok", { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        service: "WanderOS",
        status: "ok",
        runtime: "Cloudflare Workers",
        storage: env.WANDEROS_KV ? "Workers KV connected" : "Workers KV missing",
        features: [
          "telegram-webhook",
          "user-profile",
          "saved-base-location",
          "radius-settings",
          "history"
        ]
      });
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

    return handleTelegram(request, env);
  }
};

