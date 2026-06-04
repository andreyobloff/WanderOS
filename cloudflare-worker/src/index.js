const DEFAULT_CENTER = { lat: 55.7558, lon: 37.6173 };
const DEFAULT_RADIUS = 1200;
const MIN_RADIUS = 200;
const MAX_RADIUS = 5000;
const PAGE_SIZE = 10;

const TITLES = [
  "слепой двор",
  "ржавая арка",
  "фонарь без свидетелей",
  "порог между домами",
  "тихий карман города",
  "место, где карта врёт",
  "пустой угол",
  "эхо переулка"
];

const OMENS = [
  "найди знак, который смотрит не туда",
  "досчитай до семи окон и сверни взгляд",
  "заметь предмет, который будто забыли специально",
  "не фотографируй первым — сначала посмотри",
  "ищи отражение: стекло, вода, витрина",
  "остановись там, где шум внезапно провалится"
];

function now() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function safeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function urlHtml(v) {
  return String(v).replaceAll("&", "&amp;");
}

function hasLink(text) {
  return /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.ru\b|\.com\b|\.net\b|\.org\b)/i.test(String(text || ""));
}

function shortText(text, max) {
  return String(text || "").trim().slice(0, max);
}

function cleanPoint(lat, lon) {
  return {
    lat: Number(Number(lat).toFixed(6)),
    lon: Number(Number(lon).toFixed(6))
  };
}

function isValidPoint(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function distanceM(a, b) {
  const R = 6371000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;

  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function randomPoint(center, radiusM) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radiusM;
  const earth = 6371000;

  const dLat = (distance * Math.cos(angle)) / earth;
  const dLon = (distance * Math.sin(angle)) / (earth * Math.cos(center.lat * Math.PI / 180));

  return cleanPoint(center.lat + dLat * 180 / Math.PI, center.lon + dLon * 180 / Math.PI);
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
  const low = text.toLowerCase();

  if (low.startsWith("/")) return low.split(/\s+/)[0].split("@")[0];

  if (low.includes("штаб")) return "/sethome";
  if (low.includes("сигнал")) return "/point";
  if (low.includes("точка")) return "/point";
  if (low.includes("выход")) return "/route";
  if (low.includes("маршрут")) return "/route";
  if (low.includes("досье")) return "/profile";
  if (low.includes("профиль")) return "/profile";
  if (low.includes("архив")) return "/history";
  if (low.includes("история")) return "/history";
  if (low.includes("радиус")) return "/radius";
  if (low.includes("терминал")) return "/menu";
  if (low.includes("оперативники")) return "/operators";
  if (low.includes("кооперация")) return "/coops";

  return "";
}

function textOf(message) {
  return message && message.text ? message.text.trim() : "";
}

function bestPhotoFileId(message) {
  if (!message || !Array.isArray(message.photo) || !message.photo.length) return null;
  return message.photo[message.photo.length - 1].file_id;
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: "⌂ Штаб" }],
      [{ text: "◌ Сигнал" }, { text: "⟡ Выход" }],
      [{ text: "⊕ Оперативники" }, { text: "⚭ Кооперация" }],
      [{ text: "☾ Досье" }, { text: "‡ Архив" }],
      [{ text: "⛯ Радиус" }, { text: "? Терминал" }]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "WanderOS terminal"
  };
}

function ik(rows) {
  return { inline_keyboard: rows };
}

async function tg(env, method, payload) {
  const api = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method;

  const res = await fetch(api, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data = null;
  try { data = await res.json(); } catch { data = { ok: false, description: "bad json" }; }

  if (!res.ok || data.ok !== true) {
    console.error("Telegram API failed", method, res.status, JSON.stringify(data));
  }

  return data;
}

async function deleteMessage(env, chatId, messageId) {
  if (!messageId || Number(messageId) <= 0) return false;

  try {
    const data = await tg(env, "deleteMessage", {
      chat_id: chatId,
      message_id: Number(messageId)
    });
    return data.ok === true;
  } catch {
    return false;
  }
}

async function deleteMessageList(env, chatId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];
  for (const messageId of unique) await deleteMessage(env, chatId, messageId);
}

async function rememberMessage(env, chatId, messageId, direction) {
  if (!messageId) return;

  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO ui_messages(chat_id, message_id, direction, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(String(chatId), Number(messageId), direction, now()).run();
  } catch {}
}

async function knownMessageIds(env, chatId, limit = 80) {
  try {
    const result = await env.DB.prepare(`
      SELECT message_id FROM ui_messages
      WHERE chat_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(String(chatId), limit).all();

    return (result.results || []).map(r => Number(r.message_id)).filter(Boolean);
  } catch {
    return [];
  }
}

async function pruneKnownMessages(env, chatId, keepId) {
  try {
    await env.DB.prepare(`
      DELETE FROM ui_messages
      WHERE chat_id = ? AND message_id <> ?
    `).bind(String(chatId), Number(keepId || 0)).run();
  } catch {}
}

async function getUiState(env, chatId) {
  return await env.DB.prepare(`
    SELECT active_message_id FROM ui_state WHERE chat_id = ?
  `).bind(String(chatId)).first();
}

async function setActiveMessage(env, chatId, messageId) {
  await env.DB.prepare(`
    INSERT INTO ui_state(chat_id, active_message_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      active_message_id = excluded.active_message_id,
      updated_at = excluded.updated_at
  `).bind(String(chatId), Number(messageId), now()).run();
}

async function clearActiveMessage(env, chatId) {
  await env.DB.prepare(`
    INSERT INTO ui_state(chat_id, active_message_id, updated_at)
    VALUES (?, NULL, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      active_message_id = NULL,
      updated_at = excluded.updated_at
  `).bind(String(chatId), now()).run();
}

async function sendScreen(env, ctx, chatId, text, extraDeleteIds = [], options = {}) {
  const state = await getUiState(env, chatId);
  const previousActive = state && state.active_message_id ? Number(state.active_message_id) : null;

  const replyMarkup = options.inline ? options.inline : mainKeyboard();

  let method = "sendMessage";
  let payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup
  };

  if (options.photo) {
    method = "sendPhoto";
    payload = {
      chat_id: chatId,
      photo: options.photo,
      caption: text,
      parse_mode: "HTML",
      reply_markup: replyMarkup
    };
  }

  if (options.video) {
    method = "sendVideo";
    payload = {
      chat_id: chatId,
      video: options.video,
      caption: text,
      parse_mode: "HTML",
      reply_markup: replyMarkup
    };
  }

  const sent = await tg(env, method, payload);

  if (sent.ok && sent.result && sent.result.message_id) {
    const newMessageId = Number(sent.result.message_id);
    await setActiveMessage(env, chatId, newMessageId);
    await rememberMessage(env, chatId, newMessageId, "bot");

    const deleteIds = extraDeleteIds.concat(previousActive || []);
    ctx.waitUntil(deleteMessageList(env, chatId, deleteIds));
    ctx.waitUntil(pruneKnownMessages(env, chatId, newMessageId));
  }
}

async function setFlow(env, chatId, mode, payload = {}) {
  await env.DB.prepare(`
    INSERT INTO flow_state(chat_id, mode, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      mode = excluded.mode,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).bind(String(chatId), mode, JSON.stringify(payload || {}), now()).run();
}

async function getFlow(env, chatId) {
  const row = await env.DB.prepare(`
    SELECT mode, payload_json FROM flow_state WHERE chat_id = ?
  `).bind(String(chatId)).first();

  if (!row) return { mode: null, payload: {} };

  let payload = {};
  try { payload = row.payload_json ? JSON.parse(row.payload_json) : {}; } catch { payload = {}; }

  return { mode: row.mode, payload };
}

async function clearFlow(env, chatId) {
  await env.DB.prepare(`
    INSERT INTO flow_state(chat_id, mode, payload_json, updated_at)
    VALUES (?, NULL, NULL, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      mode = NULL,
      payload_json = NULL,
      updated_at = excluded.updated_at
  `).bind(String(chatId), now()).run();
}

async function logEvent(env, chatId, type, payload) {
  try {
    await env.DB.prepare(`
      INSERT INTO events(chat_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(String(chatId), type, JSON.stringify(payload || {}), now()).run();
  } catch {}
}

async function upsertUser(env, message) {
  const chatId = String(message.chat.id);
  const from = message.from || {};
  const t = now();

  await env.DB.prepare(`
    INSERT INTO users(chat_id, username, first_name, language_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      language_code = excluded.language_code,
      updated_at = excluded.updated_at
  `).bind(
    chatId,
    from.username || null,
    from.first_name || null,
    from.language_code || null,
    t,
    t
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO profiles(chat_id, city, radius_m, mood, created_at, updated_at)
    VALUES (?, 'Москва', ?, 'liminal', ?, ?)
  `).bind(chatId, DEFAULT_RADIUS, t, t).run();

  return chatId;
}

async function upsertCallbackUser(env, cb) {
  const chatId = String(cb.message.chat.id);
  const from = cb.from || {};
  const t = now();

  await env.DB.prepare(`
    INSERT INTO users(chat_id, username, first_name, language_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      language_code = excluded.language_code,
      updated_at = excluded.updated_at
  `).bind(
    chatId,
    from.username || null,
    from.first_name || null,
    from.language_code || null,
    t,
    t
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO profiles(chat_id, city, radius_m, mood, created_at, updated_at)
    VALUES (?, 'Москва', ?, 'liminal', ?, ?)
  `).bind(chatId, DEFAULT_RADIUS, t, t).run();

  return chatId;
}

async function profile(env, chatId) {
  return await env.DB.prepare(`
    SELECT u.chat_id, u.username, u.first_name,
           p.city, p.base_lat, p.base_lon, p.base_label,
           p.radius_m, p.mood, p.updated_at,
           op.callsign, op.age, op.sex, op.bio, op.photo_file_id, op.is_visible
    FROM users u
    JOIN profiles p ON p.chat_id = u.chat_id
    LEFT JOIN operator_profiles op ON op.chat_id = u.chat_id
    WHERE u.chat_id = ?
  `).bind(String(chatId)).first();
}

async function operatorProfile(env, chatId) {
  return await env.DB.prepare(`
    SELECT op.*, u.username, u.first_name, p.base_lat, p.base_lon, p.radius_m
    FROM operator_profiles op
    JOIN users u ON u.chat_id = op.chat_id
    JOIN profiles p ON p.chat_id = op.chat_id
    WHERE op.chat_id = ?
  `).bind(String(chatId)).first();
}

async function updateHome(env, chatId, lat, lon, label) {
  const p = cleanPoint(lat, lon);

  await env.DB.prepare(`
    UPDATE profiles
    SET base_lat = ?, base_lon = ?, base_label = ?, updated_at = ?
    WHERE chat_id = ?
  `).bind(p.lat, p.lon, label || "штаб", now(), String(chatId)).run();

  return p;
}

async function updateRadius(env, chatId, radius) {
  await env.DB.prepare(`
    UPDATE profiles
    SET radius_m = ?, updated_at = ?
    WHERE chat_id = ?
  `).bind(radius, now(), String(chatId)).run();
}

async function addRoute(env, chatId, kind, origin, target, radius, title, omen) {
  const routeId = uuid();
  const map = pointUrl(target);
  const route = routeUrl(origin, target);

  await env.DB.prepare(`
    INSERT INTO routes(
      id, chat_id, kind,
      origin_lat, origin_lon,
      target_lat, target_lon,
      radius_m, title, omen,
      map_url, route_url, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    routeId, String(chatId), kind,
    origin.lat, origin.lon,
    target.lat, target.lon,
    radius, title, omen,
    map, route, now()
  ).run();

  await env.DB.prepare(`
    INSERT OR IGNORE INTO trace_cards(route_id, chat_id, summary, updated_at)
    VALUES (?, ?, NULL, ?)
  `).bind(routeId, String(chatId), now()).run();

  return { id: routeId, map, route };
}

async function history(env, chatId, page = 0) {
  const result = await env.DB.prepare(`
    SELECT id, kind, target_lat, target_lon, title, omen, route_url, created_at
    FROM routes
    WHERE chat_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(String(chatId), PAGE_SIZE, page * PAGE_SIZE).all();

  return result.results || [];
}

async function stats(env, chatId) {
  return await env.DB.prepare(`
    SELECT COUNT(*) AS total FROM routes WHERE chat_id = ?
  `).bind(String(chatId)).first();
}

async function coopStats(env, chatId) {
  return await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM cooperations
    WHERE status = 'accepted' AND (requester_chat_id = ? OR target_chat_id = ?)
  `).bind(String(chatId), String(chatId)).first();
}

function hasHome(p) {
  return p && typeof p.base_lat === "number" && typeof p.base_lon === "number";
}

function isRegistered(p) {
  return Boolean(p && p.callsign);
}

function parsePointFromText(text) {
  if (!text) return null;

  const raw = text.trim();
  const decoded = decodeURIComponent(raw);

  try {
    const url = new URL(decoded);
    const host = url.hostname.toLowerCase();

    if (host.includes("yandex")) {
      const ll = url.searchParams.get("ll");
      const pt = url.searchParams.get("pt");

      for (const value of [pt, ll]) {
        if (!value) continue;
        const parts = value.split(/[,\s]+/).map(Number);
        if (parts.length >= 2) {
          const lon = parts[0];
          const lat = parts[1];
          if (isValidPoint(lat, lon)) return { point: cleanPoint(lat, lon), label: "Yandex Maps" };
        }
      }
    }

    const q = url.searchParams.get("q") || url.searchParams.get("query");
    if (q) {
      const m = q.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
      if (m) {
        const lat = Number(m[1]);
        const lon = Number(m[2]);
        if (isValidPoint(lat, lon)) return { point: cleanPoint(lat, lon), label: "Google Maps" };
      }
    }

    const at = decoded.match(/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (at) {
      const lat = Number(at[1]);
      const lon = Number(at[2]);
      if (isValidPoint(lat, lon)) return { point: cleanPoint(lat, lon), label: "map link" };
    }
  } catch {}

  const coord = decoded.match(/(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
  if (coord) {
    const lat = Number(coord[1].replace(",", "."));
    const lon = Number(coord[2].replace(",", "."));
    if (isValidPoint(lat, lon)) return { point: cleanPoint(lat, lon), label: "координаты" };
  }

  return null;
}

async function geocodeAddress(query) {
  const q = query.trim();
  if (!q || q.length < 3 || q.length > 180) return null;

  const enriched = /москва|moscow/i.test(q) ? q : "Москва, " + q;
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=" + encodeURIComponent(enriched);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "WanderOS Telegram bot / educational project",
      "Accept": "application/json"
    }
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  const item = data[0];
  const lat = Number(item.lat);
  const lon = Number(item.lon);

  if (!isValidPoint(lat, lon)) return null;

  return { point: cleanPoint(lat, lon), label: item.display_name || enriched };
}

function menuText() {
  return "<b>WanderOS</b>\n" +
    "<i>полевой терминал бюро</i>\n\n" +
    "⌂ <b>Штаб</b> — база операций\n" +
    "◌ <b>Сигнал</b> — метка рядом со штабом\n" +
    "⟡ <b>Выход</b> — путь до сигнала\n" +
    "⊕ <b>Оперативники</b> — ближайшие сотрудники\n" +
    "⚭ <b>Кооперация</b> — совместные выходы\n" +
    "☾ <b>Досье</b> — профиль оператора\n" +
    "‡ <b>Архив</b> — следы";
}

function registerIntroText() {
  return "<b>Регистрация в бюро</b>\n\n" +
    "Нужно оформить досье оператора.\n\n" +
    "Укажи позывной.";
}

function setHomeText() {
  return "<b>⌂ Установка штаба</b>\n\n" +
    "Отправь координаты, ссылку на карту или адрес.\n\n" +
    "<code>55.7558, 37.6173</code>\n" +
    "<code>Тверская 13</code>";
}

function needHomeText() {
  return "<b>Штаб не установлен.</b>\n\n" +
    "Открой ⌂ <b>Штаб</b> и задай базу операций.";
}

function needRegisterText() {
  return "<b>Досье не оформлено.</b>\n\n" +
    "Для кооперации нужна регистрация в бюро.";
}

function homeSavedText(origin, target, route, label) {
  return "<b>⌂ Штаб установлен.</b>\n\n" +
    "База: <code>" + origin.lat + ", " + origin.lon + "</code>\n" +
    "Метка: " + safeHtml(label || "штаб") + "\n\n" +
    "Первичный сигнал: <code>" + target.lat + ", " + target.lon + "</code>\n" +
    "<a href=\"" + urlHtml(route) + "\">Открыть путь</a>";
}

function profileText(p, routeCount, coopCount) {
  if (!isRegistered(p)) {
    return "<b>☾ Досье оператора</b>\n\n" +
      "Статус: не оформлено.\n\n" +
      "Команда: <code>/register</code>";
  }

  const username = p.username ? "@" + safeHtml(p.username) : safeHtml(p.first_name || "нет");
  const base = hasHome(p)
    ? "<code>" + p.base_lat + ", " + p.base_lon + "</code>\n" + safeHtml(p.base_label || "штаб")
    : "не установлен";

  return "<b>☾ Досье оператора</b>\n\n" +
    "Позывной: <b>" + safeHtml(p.callsign) + "</b>\n" +
    "Пользователь: " + username + "\n" +
    "Возраст: " + p.age + "\n" +
    "Пол: " + safeHtml(p.sex) + "\n" +
    "Радиус: <b>" + p.radius_m + " м</b>\n" +
    "Штаб: " + base + "\n" +
    "Следы: <b>" + routeCount + "</b>\n" +
    "Кооперации: <b>" + coopCount + "</b>\n\n" +
    safeHtml(p.bio);
}

function operatorsText(items, page, radius) {
  if (!items.length) {
    return "<b>⊕ Оперативники</b>\n\n" +
      "В радиусе " + radius + " м никого не найдено.";
  }

  let out = "<b>⊕ Оперативники рядом</b>\n\n";
  items.forEach((x, i) => {
    out += "<b>" + (i + 1) + ".</b> " + safeHtml(x.callsign) +
      " · " + x.age + " · " + x.distance_m + " м\n";
  });

  out += "\nСтраница: " + (page + 1);
  return out;
}

function operatorDossierText(op, dist, traceCount, coopCount) {
  const username = op.username ? "@" + safeHtml(op.username) : safeHtml(op.first_name || "нет");

  return "<b>☾ Досье: " + safeHtml(op.callsign) + "</b>\n\n" +
    "Пользователь: " + username + "\n" +
    "Возраст: " + op.age + "\n" +
    "Дистанция: " + dist + " м\n" +
    "Следы: <b>" + traceCount + "</b>\n" +
    "Кооперации: <b>" + coopCount + "</b>\n\n" +
    safeHtml(op.bio);
}

function pointText(target, route, title, omen, routeId) {
  return "<b>◌ Сигнал: " + safeHtml(title) + "</b>\n\n" +
    "Метка: <code>" + target.lat + ", " + target.lon + "</code>\n" +
    "<a href=\"" + urlHtml(route) + "\">Открыть путь</a>\n\n" +
    "<i>" + safeHtml(omen) + "</i>\n\n" +
    "След: <code>" + routeId.slice(0, 8) + "</code>";
}

function routeText(target, route, title, omen, routeId) {
  return "<b>⟡ Выход: " + safeHtml(title) + "</b>\n\n" +
    "Цель: <code>" + target.lat + ", " + target.lon + "</code>\n" +
    "<a href=\"" + urlHtml(route) + "\">Идти</a>\n\n" +
    "<i>" + safeHtml(omen) + "</i>\n\n" +
    "След: <code>" + routeId.slice(0, 8) + "</code>";
}

function radiusHelpText() {
  return "<b>⛯ Радиус поиска</b>\n\n" +
    "Напиши число от 200 до 5000.\n\n" +
    "<code>800</code>";
}

function parseRadius(text) {
  const m = text.match(/(\d+)/);
  if (!m) return null;

  const value = Number.parseInt(m[1], 10);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_RADIUS || value > MAX_RADIUS) return null;

  return value;
}

function historyText(rows, page, ownerLabel) {
  if (!rows.length) {
    return "<b>‡ Архив пуст.</b>\n\nСледов ещё нет.";
  }

  let out = "<b>‡ Архив следов</b>\n";
  if (ownerLabel) out += "<i>" + safeHtml(ownerLabel) + "</i>\n";
  out += "\n";

  rows.forEach((r, i) => {
    out += "<b>" + (i + 1) + ". " + safeHtml(r.title || "сигнал") + "</b>\n";
    out += "<code>" + r.target_lat + ", " + r.target_lon + "</code>\n\n";
  });

  out += "Страница: " + (page + 1);
  return out.trim();
}

function traceText(trace, card, mediaIndex, mediaCount, owner) {
  let out = "<b>‡ След: " + safeHtml(trace.title || "сигнал") + "</b>\n\n";
  out += "Оператор: " + safeHtml(owner || "неизвестно") + "\n";
  out += "Цель: <code>" + trace.target_lat + ", " + trace.target_lon + "</code>\n";
  out += "<a href=\"" + urlHtml(trace.route_url) + "\">путь</a>\n\n";

  if (card && card.summary) {
    out += "<b>Сводка:</b>\n" + safeHtml(card.summary) + "\n\n";
  } else {
    out += "<i>Сводка не заполнена.</i>\n\n";
  }

  if (mediaCount > 0) {
    out += "Медиа: " + (mediaIndex + 1) + "/" + mediaCount + "\n";
  }

  return out.trim();
}

function coopsText(rows) {
  if (!rows.length) {
    return "<b>⚭ Кооперация</b>\n\nАктивных записей нет.";
  }

  let out = "<b>⚭ Кооперация</b>\n\n";
  rows.forEach((r, i) => {
    out += "<b>" + (i + 1) + ".</b> " + safeHtml(r.name) + " · " + safeHtml(r.status) + "\n";
  });
  return out.trim();
}

async function saveHomeAndReply(env, ctx, chatId, origin, label, cleanupIds) {
  const savedOrigin = await updateHome(env, chatId, origin.lat, origin.lon, label);
  const p = await profile(env, chatId);
  const radius = p.radius_m || DEFAULT_RADIUS;
  const target = randomPoint(savedOrigin, radius);
  const title = pick(TITLES);
  const omen = pick(OMENS);
  const saved = await addRoute(env, chatId, "home", savedOrigin, target, radius, title, omen);

  await clearFlow(env, chatId);
  await logEvent(env, chatId, "home_saved", { origin: savedOrigin, target, label });
  await sendScreen(env, ctx, chatId, homeSavedText(savedOrigin, target, saved.route, label), cleanupIds, {
    inline: ik([[{ text: "‡ Открыть след", callback_data: "tr:" + saved.id + ":0" }]])
  });
}

async function handleLocation(env, ctx, chatId, message, cleanupIds) {
  let label = "штаб";

  if (message.venue) {
    label = [message.venue.title, message.venue.address].filter(Boolean).join(" — ");
  }

  const loc = message.location || message.venue?.location;
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
    await sendScreen(env, ctx, chatId, "<b>Штаб не принят.</b>\n\nОтправь координаты, ссылку или адрес.", cleanupIds);
    return;
  }

  await saveHomeAndReply(env, ctx, chatId, cleanPoint(loc.latitude, loc.longitude), label, cleanupIds);
}

async function handleHomeText(env, ctx, chatId, text, cleanupIds) {
  const parsed = parsePointFromText(text);
  if (parsed) {
    await saveHomeAndReply(env, ctx, chatId, parsed.point, parsed.label, cleanupIds);
    return true;
  }

  const geocoded = await geocodeAddress(text);
  if (geocoded) {
    await saveHomeAndReply(env, ctx, chatId, geocoded.point, geocoded.label, cleanupIds);
    return true;
  }

  await sendScreen(env, ctx, chatId, "<b>Штаб не найден.</b>\n\nНужны координаты, ссылка на карту или точный адрес.", cleanupIds);
  return true;
}

async function geocodeAddress(query) {
  const q = query.trim();
  if (!q || q.length < 3 || q.length > 180) return null;

  const enriched = /москва|moscow/i.test(q) ? q : "Москва, " + q;
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=" + encodeURIComponent(enriched);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "WanderOS Telegram bot / educational project",
      "Accept": "application/json"
    }
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  const item = data[0];
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  if (!isValidPoint(lat, lon)) return null;

  return { point: cleanPoint(lat, lon), label: item.display_name || enriched };
}

async function makePoint(env, ctx, chatId, kind, cleanupIds) {
  const p = await profile(env, chatId);

  if (!hasHome(p)) {
    await sendScreen(env, ctx, chatId, needHomeText(), cleanupIds);
    return;
  }

  const origin = cleanPoint(p.base_lat, p.base_lon);
  const radius = p.radius_m || DEFAULT_RADIUS;
  const target = randomPoint(origin, radius);
  const title = pick(TITLES);
  const omen = pick(OMENS);
  const saved = await addRoute(env, chatId, kind, origin, target, radius, title, omen);

  await logEvent(env, chatId, kind, { target });

  const text = kind === "route"
    ? routeText(target, saved.route, title, omen, saved.id)
    : pointText(target, saved.route, title, omen, saved.id);

  await sendScreen(env, ctx, chatId, text, cleanupIds, {
    inline: ik([
      [{ text: "✎ Сводка", callback_data: "tn:" + saved.id }, { text: "＋ Медиа", callback_data: "tm:" + saved.id }],
      [{ text: "‡ Открыть след", callback_data: "tr:" + saved.id + ":0" }]
    ])
  });
}

async function showProfile(env, ctx, chatId, cleanupIds) {
  const p = await profile(env, chatId);
  const s = await stats(env, chatId);
  const c = await coopStats(env, chatId);

  const buttons = isRegistered(p)
    ? ik([[{ text: "‡ Мои следы", callback_data: "trs:" + chatId + ":0" }]])
    : ik([[{ text: "Оформить досье", callback_data: "reg:start" }]]);

  await sendScreen(env, ctx, chatId, profileText(p, s.total || 0, c.total || 0), cleanupIds, {
    photo: p.photo_file_id || null,
    inline: buttons
  });
}

async function startRegistration(env, ctx, chatId, cleanupIds) {
  await setFlow(env, chatId, "reg_callsign", {});
  await sendScreen(env, ctx, chatId, registerIntroText(), cleanupIds);
}

async function finishRegistration(env, ctx, chatId, payload, photoFileId, cleanupIds) {
  await env.DB.prepare(`
    INSERT INTO operator_profiles(
      chat_id, callsign, age, sex, bio, photo_file_id, is_visible, registered_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      callsign = excluded.callsign,
      age = excluded.age,
      sex = excluded.sex,
      bio = excluded.bio,
      photo_file_id = excluded.photo_file_id,
      is_visible = 1,
      updated_at = excluded.updated_at
  `).bind(
    String(chatId),
    payload.callsign,
    payload.age,
    payload.sex,
    payload.bio,
    photoFileId || null,
    now(),
    now()
  ).run();

  await clearFlow(env, chatId);

  await sendScreen(env, ctx, chatId,
    "<b>Досье оформлено.</b>\n\n" +
    "Позывной: <b>" + safeHtml(payload.callsign) + "</b>\n" +
    "Статус: оператор бюро.",
    cleanupIds
  );
}

async function handleRegistrationFlow(env, ctx, chatId, message, flow, cleanupIds) {
  const text = textOf(message);

  if (flow.mode === "reg_callsign") {
    const callsign = shortText(text, 32);

    if (!callsign || hasLink(callsign)) {
      await sendScreen(env, ctx, chatId, "<b>Позывной не принят.</b>\n\nДо 32 символов, без ссылок.", cleanupIds);
      return true;
    }

    await setFlow(env, chatId, "reg_age", { callsign });
    await sendScreen(env, ctx, chatId, "<b>Возраст оператора.</b>\n\nНапиши число.", cleanupIds);
    return true;
  }

  if (flow.mode === "reg_age") {
    const age = Number.parseInt(text, 10);

    if (!Number.isFinite(age) || age < 14 || age > 99) {
      await sendScreen(env, ctx, chatId, "<b>Возраст не принят.</b>\n\nДиапазон: 14–99.", cleanupIds);
      return true;
    }

    await setFlow(env, chatId, "reg_sex", { ...flow.payload, age });
    await sendScreen(env, ctx, chatId, "<b>Пол.</b>\n\nНапиши коротко: м / ж / другое.", cleanupIds);
    return true;
  }

  if (flow.mode === "reg_sex") {
    const sex = shortText(text, 32);

    if (!sex || hasLink(sex)) {
      await sendScreen(env, ctx, chatId, "<b>Поле не принято.</b>\n\nКороткая запись, без ссылок.", cleanupIds);
      return true;
    }

    await setFlow(env, chatId, "reg_bio", { ...flow.payload, sex });
    await sendScreen(env, ctx, chatId, "<b>Биография.</b>\n\nДо 512 символов. Ссылки запрещены.", cleanupIds);
    return true;
  }

  if (flow.mode === "reg_bio") {
    const bio = shortText(text, 512);

    if (!bio || bio.length > 512 || hasLink(bio)) {
      await sendScreen(env, ctx, chatId, "<b>Биография не принята.</b>\n\nДо 512 символов, без ссылок.", cleanupIds);
      return true;
    }

    await setFlow(env, chatId, "reg_photo", { ...flow.payload, bio });
    await sendScreen(env, ctx, chatId,
      "<b>Фото досье.</b>\n\n" +
      "Отправь фото одним сообщением.\n\n" +
      "Можно пропустить: <code>/skip</code>",
      cleanupIds
    );
    return true;
  }

  if (flow.mode === "reg_photo") {
    const photoFileId = bestPhotoFileId(message);

    if (text === "/skip" || text.toLowerCase() === "пропустить") {
      await finishRegistration(env, ctx, chatId, flow.payload, null, cleanupIds);
      return true;
    }

    if (!photoFileId) {
      await sendScreen(env, ctx, chatId, "<b>Жду фото.</b>\n\nИли <code>/skip</code>.", cleanupIds);
      return true;
    }

    await finishRegistration(env, ctx, chatId, flow.payload, photoFileId, cleanupIds);
    return true;
  }

  return false;
}

async function nearbyOperators(env, chatId, page) {
  const self = await profile(env, chatId);

  if (!isRegistered(self)) return { error: "not_registered", items: [], radius: 0 };
  if (!hasHome(self)) return { error: "no_home", items: [], radius: 0 };

  const origin = cleanPoint(self.base_lat, self.base_lon);
  const radius = self.radius_m || DEFAULT_RADIUS;

  const result = await env.DB.prepare(`
    SELECT op.chat_id, op.callsign, op.age, op.bio, op.photo_file_id,
           u.username, u.first_name,
           p.base_lat, p.base_lon
    FROM operator_profiles op
    JOIN users u ON u.chat_id = op.chat_id
    JOIN profiles p ON p.chat_id = op.chat_id
    WHERE op.is_visible = 1
      AND op.chat_id <> ?
      AND p.base_lat IS NOT NULL
      AND p.base_lon IS NOT NULL
    LIMIT 300
  `).bind(String(chatId)).all();

  const all = (result.results || [])
    .map(x => {
      const d = distanceM(origin, cleanPoint(x.base_lat, x.base_lon));
      return { ...x, distance_m: d };
    })
    .filter(x => x.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m);

  return {
    items: all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    total: all.length,
    radius
  };
}

async function showOperators(env, ctx, chatId, page, cleanupIds = []) {
  const data = await nearbyOperators(env, chatId, page);

  if (data.error === "not_registered") {
    await sendScreen(env, ctx, chatId, needRegisterText(), cleanupIds, {
      inline: ik([[{ text: "Оформить досье", callback_data: "reg:start" }]])
    });
    return;
  }

  if (data.error === "no_home") {
    await sendScreen(env, ctx, chatId, needHomeText(), cleanupIds);
    return;
  }

  const rows = [];
  const nums = data.items.map((x, i) => ({
    text: String(i + 1),
    callback_data: "op:" + x.chat_id + ":" + page
  }));

  for (let i = 0; i < nums.length; i += 5) rows.push(nums.slice(i, i + 5));

  const nav = [];
  if (page > 0) nav.push({ text: "◀", callback_data: "ops:" + (page - 1) });
  if ((page + 1) * PAGE_SIZE < data.total) nav.push({ text: "▶", callback_data: "ops:" + (page + 1) });
  if (nav.length) rows.push(nav);

  rows.push([{ text: "⌂ Терминал", callback_data: "menu" }]);

  await sendScreen(env, ctx, chatId, operatorsText(data.items, page, data.radius), cleanupIds, {
    inline: ik(rows)
  });
}

async function showOperatorDossier(env, ctx, viewerChatId, targetChatId, page, cleanupIds = []) {
  const viewer = await profile(env, viewerChatId);
  const op = await operatorProfile(env, targetChatId);

  if (!op || !hasHome(viewer) || !hasHome(op)) {
    await showOperators(env, ctx, viewerChatId, page, cleanupIds);
    return;
  }

  const dist = distanceM(cleanPoint(viewer.base_lat, viewer.base_lon), cleanPoint(op.base_lat, op.base_lon));
  const s = await stats(env, targetChatId);
  const c = await coopStats(env, targetChatId);

  await sendScreen(env, ctx, viewerChatId, operatorDossierText(op, dist, s.total || 0, c.total || 0), cleanupIds, {
    photo: op.photo_file_id || null,
    inline: ik([
      [{ text: "⚭ Запросить кооперацию", callback_data: "coop:" + targetChatId }],
      [{ text: "‡ Следы", callback_data: "trs:" + targetChatId + ":0" }],
      [{ text: "◀ К списку", callback_data: "ops:" + page }]
    ])
  });
}

async function createCoopRequest(env, ctx, requesterChatId, targetChatId, cleanupIds = []) {
  const requester = await profile(env, requesterChatId);
  const target = await operatorProfile(env, targetChatId);

  if (!isRegistered(requester) || !target) {
    await sendScreen(env, ctx, requesterChatId, needRegisterText(), cleanupIds);
    return;
  }

  const existing = await env.DB.prepare(`
    SELECT id, status FROM cooperations
    WHERE ((requester_chat_id = ? AND target_chat_id = ?)
       OR  (requester_chat_id = ? AND target_chat_id = ?))
      AND status IN ('pending', 'accepted')
    LIMIT 1
  `).bind(String(requesterChatId), String(targetChatId), String(targetChatId), String(requesterChatId)).first();

  if (existing) {
    await sendScreen(env, ctx, requesterChatId, "<b>⚭ Канал уже открыт.</b>\n\nСтатус: " + safeHtml(existing.status), cleanupIds);
    return;
  }

  const id = uuid();

  await env.DB.prepare(`
    INSERT INTO cooperations(id, requester_chat_id, target_chat_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).bind(id, String(requesterChatId), String(targetChatId), now(), now()).run();

  await sendScreen(env, ctx, requesterChatId, "<b>⚭ Запрос отправлен.</b>\n\nОжидание ответа оператора.", cleanupIds);

  await sendScreen(env, ctx, targetChatId,
    "<b>⚭ Запрос кооперации</b>\n\n" +
    "Оператор: <b>" + safeHtml(requester.callsign) + "</b>\n\n" +
    "Совместный выход требует подтверждения.",
    [],
    {
      photo: requester.photo_file_id || null,
      inline: ik([
        [{ text: "Принять", callback_data: "ca:" + id }, { text: "Отклонить", callback_data: "cd:" + id }]
      ])
    }
  );
}

async function answerCoop(env, ctx, chatId, coopId, status) {
  const row = await env.DB.prepare(`
    SELECT * FROM cooperations WHERE id = ?
  `).bind(coopId).first();

  if (!row || String(row.target_chat_id) !== String(chatId)) {
    await sendScreen(env, ctx, chatId, "<b>Канал не найден.</b>");
    return;
  }

  await env.DB.prepare(`
    UPDATE cooperations
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).bind(status, now(), coopId).run();

  const requester = await operatorProfile(env, row.requester_chat_id);
  const target = await operatorProfile(env, row.target_chat_id);

  if (status === "accepted") {
    await sendScreen(env, ctx, chatId, "<b>⚭ Кооперация подтверждена.</b>\n\nКанал открыт.");
    await sendScreen(env, ctx, row.requester_chat_id,
      "<b>⚭ Кооперация подтверждена.</b>\n\nОператор: <b>" + safeHtml(target.callsign) + "</b>"
    );
  } else {
    await sendScreen(env, ctx, chatId, "<b>Запрос отклонён.</b>");
    await sendScreen(env, ctx, row.requester_chat_id,
      "<b>⚭ Запрос не принят.</b>\n\nОператор: <b>" + safeHtml(target.callsign) + "</b>"
    );
  }
}

async function showCoops(env, ctx, chatId, cleanupIds = []) {
  const result = await env.DB.prepare(`
    SELECT c.status,
           CASE
             WHEN c.requester_chat_id = ? THEN op2.callsign
             ELSE op1.callsign
           END AS name
    FROM cooperations c
    LEFT JOIN operator_profiles op1 ON op1.chat_id = c.requester_chat_id
    LEFT JOIN operator_profiles op2 ON op2.chat_id = c.target_chat_id
    WHERE c.requester_chat_id = ? OR c.target_chat_id = ?
    ORDER BY c.updated_at DESC
    LIMIT 10
  `).bind(String(chatId), String(chatId), String(chatId)).all();

  await sendScreen(env, ctx, chatId, coopsText(result.results || []), cleanupIds);
}

async function showTraceList(env, ctx, viewerChatId, ownerChatId, page, cleanupIds = []) {
  const owner = await operatorProfile(env, ownerChatId);
  const rows = await history(env, ownerChatId, page);

  const buttons = [];
  const nums = rows.map((r, i) => ({ text: String(i + 1), callback_data: "tr:" + r.id + ":0" }));
  for (let i = 0; i < nums.length; i += 5) buttons.push(nums.slice(i, i + 5));

  const nav = [];
  if (page > 0) nav.push({ text: "◀", callback_data: "trs:" + ownerChatId + ":" + (page - 1) });
  if (rows.length === PAGE_SIZE) nav.push({ text: "▶", callback_data: "trs:" + ownerChatId + ":" + (page + 1) });
  if (nav.length) buttons.push(nav);

  buttons.push([{ text: "⌂ Терминал", callback_data: "menu" }]);

  await sendScreen(env, ctx, viewerChatId, historyText(rows, page, owner ? owner.callsign : null), cleanupIds, {
    inline: ik(buttons)
  });
}

async function getTrace(env, routeId) {
  return await env.DB.prepare(`
    SELECT r.*, op.callsign
    FROM routes r
    LEFT JOIN operator_profiles op ON op.chat_id = r.chat_id
    WHERE r.id = ?
  `).bind(routeId).first();
}

async function getTraceCard(env, routeId) {
  return await env.DB.prepare(`
    SELECT * FROM trace_cards WHERE route_id = ?
  `).bind(routeId).first();
}

async function getTraceMedia(env, routeId) {
  const result = await env.DB.prepare(`
    SELECT * FROM trace_media
    WHERE route_id = ?
    ORDER BY position ASC
  `).bind(routeId).all();

  return result.results || [];
}

async function showTrace(env, ctx, viewerChatId, routeId, mediaIndex = 0, cleanupIds = []) {
  const trace = await getTrace(env, routeId);
  if (!trace) {
    await sendScreen(env, ctx, viewerChatId, "<b>След не найден.</b>", cleanupIds);
    return;
  }

  const card = await getTraceCard(env, routeId);
  const media = await getTraceMedia(env, routeId);
  const idx = Math.max(0, Math.min(Number(mediaIndex || 0), Math.max(0, media.length - 1)));
  const current = media[idx] || null;
  const isOwner = String(trace.chat_id) === String(viewerChatId);

  const buttons = [];

  if (media.length > 1) {
    const prev = idx > 0 ? idx - 1 : media.length - 1;
    const next = idx < media.length - 1 ? idx + 1 : 0;
    buttons.push([
      { text: "◀ Медиа", callback_data: "tr:" + routeId + ":" + prev },
      { text: "▶ Медиа", callback_data: "tr:" + routeId + ":" + next }
    ]);
  }

  if (isOwner) {
    buttons.push([
      { text: "✎ Сводка", callback_data: "tn:" + routeId },
      { text: "＋ Медиа", callback_data: "tm:" + routeId }
    ]);
  }

  buttons.push([{ text: "‡ Архив", callback_data: "trs:" + trace.chat_id + ":0" }]);

  const options = { inline: ik(buttons) };

  if (current && current.media_type === "photo") options.photo = current.file_id;
  if (current && current.media_type === "video") options.video = current.file_id;

  await sendScreen(env, ctx, viewerChatId, traceText(trace, card, idx, media.length, trace.callsign), cleanupIds, options);
}

async function setTraceSummary(env, ctx, chatId, routeId, text, cleanupIds) {
  const trace = await getTrace(env, routeId);

  if (!trace || String(trace.chat_id) !== String(chatId)) {
    await sendScreen(env, ctx, chatId, "<b>След не найден.</b>", cleanupIds);
    return;
  }

  const summary = shortText(text, 512);

  if (!summary || summary.length > 512 || hasLink(summary)) {
    await sendScreen(env, ctx, chatId, "<b>Сводка не принята.</b>\n\nДо 512 символов, без ссылок.", cleanupIds);
    return;
  }

  await env.DB.prepare(`
    INSERT INTO trace_cards(route_id, chat_id, summary, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(route_id) DO UPDATE SET
      summary = excluded.summary,
      updated_at = excluded.updated_at
  `).bind(routeId, String(chatId), summary, now()).run();

  await clearFlow(env, chatId);
  await showTrace(env, ctx, chatId, routeId, 0, cleanupIds);
}

async function addTraceMedia(env, ctx, chatId, routeId, message, cleanupIds) {
  const trace = await getTrace(env, routeId);

  if (!trace || String(trace.chat_id) !== String(chatId)) {
    await sendScreen(env, ctx, chatId, "<b>След не найден.</b>", cleanupIds);
    return;
  }

  const existing = await getTraceMedia(env, routeId);
  const hasVideo = existing.some(x => x.media_type === "video");
  const photoFileId = bestPhotoFileId(message);
  const video = message.video || null;

  if (photoFileId) {
    if (hasVideo || existing.length >= 3) {
      await sendScreen(env, ctx, chatId, "<b>Медиа не принято.</b>\n\nДо 3 фото или одно видео.", cleanupIds);
      return;
    }

    await env.DB.prepare(`
      INSERT INTO trace_media(id, route_id, chat_id, media_type, file_id, duration, position, created_at)
      VALUES (?, ?, ?, 'photo', ?, NULL, ?, ?)
    `).bind(uuid(), routeId, String(chatId), photoFileId, existing.length + 1, now()).run();

    await showTrace(env, ctx, chatId, routeId, existing.length, cleanupIds);
    return;
  }

  if (video) {
    if (existing.length > 0 || Number(video.duration || 0) > 15) {
      await sendScreen(env, ctx, chatId, "<b>Видео не принято.</b>\n\nТолько одно видео до 15 секунд.", cleanupIds);
      return;
    }

    await env.DB.prepare(`
      INSERT INTO trace_media(id, route_id, chat_id, media_type, file_id, duration, position, created_at)
      VALUES (?, ?, ?, 'video', ?, ?, 1, ?)
    `).bind(uuid(), routeId, String(chatId), video.file_id, Number(video.duration || 0), now()).run();

    await showTrace(env, ctx, chatId, routeId, 0, cleanupIds);
    return;
  }

  await sendScreen(env, ctx, chatId, "<b>Жду медиа.</b>\n\nФото до 3 штук или одно видео до 15 секунд.", cleanupIds);
}

async function handleFlow(env, ctx, chatId, message, flow, cleanupIds) {
  if (!flow.mode) return false;

  if (flow.mode.startsWith("reg_")) {
    return await handleRegistrationFlow(env, ctx, chatId, message, flow, cleanupIds);
  }

  if (flow.mode === "await_home") {
    if (message.location || message.venue) {
      await handleLocation(env, ctx, chatId, message, cleanupIds);
      return true;
    }
    return await handleHomeText(env, ctx, chatId, textOf(message), cleanupIds);
  }

  if (flow.mode === "await_radius") {
    const r = parseRadius(textOf(message));

    if (!r) {
      await sendScreen(env, ctx, chatId, radiusHelpText(), cleanupIds);
      return true;
    }

    await updateRadius(env, chatId, r);
    await clearFlow(env, chatId);
    await sendScreen(env, ctx, chatId, "<b>Радиус изменён.</b>\n\nКруг поиска: <b>" + r + " м</b>.", cleanupIds);
    return true;
  }

  if (flow.mode === "trace_note") {
    await setTraceSummary(env, ctx, chatId, flow.payload.route_id, textOf(message), cleanupIds);
    return true;
  }

  if (flow.mode === "trace_media") {
    await addTraceMedia(env, ctx, chatId, flow.payload.route_id, message, cleanupIds);
    return true;
  }

  return false;
}

async function handleRegistrationFlow(env, ctx, chatId, message, flow, cleanupIds) {
  const text = textOf(message);

  if (flow.mode === "reg_callsign") {
    const callsign = shortText(text, 32);
    if (!callsign || hasLink(callsign)) {
      await sendScreen(env, ctx, chatId, "<b>Позывной не принят.</b>\n\nДо 32 символов, без ссылок.", cleanupIds);
      return true;
    }
    await setFlow(env, chatId, "reg_age", { callsign });
    await sendScreen(env, ctx, chatId, "<b>Возраст.</b>\n\nНапиши число.", cleanupIds);
    return true;
  }

  if (flow.mode === "reg_age") {
    const age = Number.parseInt(text, 10);
    if (!Number.isFinite(age) || age < 14 || age > 99) {
      await sendScreen(env, ctx, chatId, "<b>Возраст не принят.</b>\n\nДиапазон: 14–99.", cleanupIds);
      return true;
    }
    await setFlow(env, chatId, "reg_sex", { ...flow.payload, age });
    await sendScreen(env, ctx, chatId, "<b>Пол.</b>\n\nКороткая запись.", cleanupIds);
    return true;
  }

  if (flow.mode === "reg_sex") {
    const sex = shortText(text, 32);
    if (!sex || hasLink(sex)) {
      await sendScreen(env, ctx, chatId, "<b>Запись не принята.</b>\n\nКоротко, без ссылок.", cleanupIds);
      return true;
    }
    await setFlow(env, chatId, "reg_bio", { ...flow.payload, sex });
    await sendScreen(env, ctx, chatId, "<b>Биография.</b>\n\nДо 512 символов. Ссылки запрещены.", cleanupIds);
    return true;
  }

  if (flow.mode === "reg_bio") {
    const bio = shortText(text, 512);
    if (!bio || bio.length > 512 || hasLink(bio)) {
      await sendScreen(env, ctx, chatId, "<b>Биография не принята.</b>\n\nДо 512 символов, без ссылок.", cleanupIds);
      return true;
    }
    await setFlow(env, chatId, "reg_photo", { ...flow.payload, bio });
    await sendScreen(env, ctx, chatId, "<b>Фото досье.</b>\n\nОтправь фото или <code>/skip</code>.", cleanupIds);
    return true;
  }

  if (flow.mode === "reg_photo") {
    const photoFileId = bestPhotoFileId(message);

    if (text === "/skip" || text.toLowerCase() === "пропустить") {
      await finishRegistration(env, ctx, chatId, flow.payload, null, cleanupIds);
      return true;
    }

    if (!photoFileId) {
      await sendScreen(env, ctx, chatId, "<b>Жду фото.</b>\n\nИли <code>/skip</code>.", cleanupIds);
      return true;
    }

    await finishRegistration(env, ctx, chatId, flow.payload, photoFileId, cleanupIds);
    return true;
  }

  return false;
}

async function finishRegistration(env, ctx, chatId, payload, photoFileId, cleanupIds) {
  await env.DB.prepare(`
    INSERT INTO operator_profiles(chat_id, callsign, age, sex, bio, photo_file_id, is_visible, registered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      callsign = excluded.callsign,
      age = excluded.age,
      sex = excluded.sex,
      bio = excluded.bio,
      photo_file_id = excluded.photo_file_id,
      is_visible = 1,
      updated_at = excluded.updated_at
  `).bind(
    String(chatId),
    payload.callsign,
    payload.age,
    payload.sex,
    payload.bio,
    photoFileId || null,
    now(),
    now()
  ).run();

  await clearFlow(env, chatId);
  await sendScreen(env, ctx, chatId,
    "<b>Досье оформлено.</b>\n\n" +
    "Позывной: <b>" + safeHtml(payload.callsign) + "</b>\n" +
    "Статус: оператор бюро.",
    cleanupIds
  );
}

async function handleTelegram(request, env, ctx) {
  const update = await request.json();

  if (update.callback_query) {
    return await handleCallback(update.callback_query, env, ctx);
  }

  const message = update.message || update.edited_message;
  if (!message || !message.chat || !message.chat.id) return new Response("ignored", { status: 200 });

  const chatId = await upsertUser(env, message);
  const cmd = commandOf(message);
  const text = textOf(message);
  const incomingId = message.message_id ? Number(message.message_id) : null;

  if (incomingId) await rememberMessage(env, chatId, incomingId, "user");

  let cleanupIds = incomingId ? [incomingId] : [];

  if (cmd === "/wipe" || cmd === "/clean") {
    const known = await knownMessageIds(env, chatId, 80);
    cleanupIds = cleanupIds.concat(known);
    await clearActiveMessage(env, chatId);
    await clearFlow(env, chatId);
    await sendScreen(env, ctx, chatId, menuText(), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  const flow = await getFlow(env, chatId);
  if (flow.mode) {
    const done = await handleFlow(env, ctx, chatId, message, flow, cleanupIds);
    if (done) return new Response("ok", { status: 200 });
  }

  if (message.location || message.venue) {
    await handleLocation(env, ctx, chatId, message, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/start" || cmd === "/menu" || cmd === "/help") {
    await clearFlow(env, chatId);
    await sendScreen(env, ctx, chatId, menuText(), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/register") {
    await startRegistration(env, ctx, chatId, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/sethome" || cmd === "/home" || cmd === "/location") {
    await setFlow(env, chatId, "await_home", {});
    await sendScreen(env, ctx, chatId, setHomeText(), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/profile") {
    await clearFlow(env, chatId);
    await showProfile(env, ctx, chatId, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/operators") {
    await clearFlow(env, chatId);
    await showOperators(env, ctx, chatId, 0, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/coops") {
    await clearFlow(env, chatId);
    await showCoops(env, ctx, chatId, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/radius") {
    const r = parseRadius(text);

    if (!r) {
      await setFlow(env, chatId, "await_radius", {});
      await sendScreen(env, ctx, chatId, radiusHelpText(), cleanupIds);
      return new Response("ok", { status: 200 });
    }

    await updateRadius(env, chatId, r);
    await sendScreen(env, ctx, chatId, "<b>Радиус изменён.</b>\n\nКруг поиска: <b>" + r + " м</b>.", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/point") {
    await clearFlow(env, chatId);
    await makePoint(env, ctx, chatId, "point", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/route") {
    await clearFlow(env, chatId);
    await makePoint(env, ctx, chatId, "route", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/history") {
    await clearFlow(env, chatId);
    await showTraceList(env, ctx, chatId, chatId, 0, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/report") {
    const p = await profile(env, chatId);
    const s = await stats(env, chatId);
    await sendScreen(env, ctx, chatId, reportText(p, s.total || 0), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/clearhome") {
    await env.DB.prepare(`
      UPDATE profiles
      SET base_lat = NULL, base_lon = NULL, base_label = NULL, updated_at = ?
      WHERE chat_id = ?
    `).bind(now(), String(chatId)).run();

    await sendScreen(env, ctx, chatId, "<b>Штаб сброшен.</b>\n\nПривязка удалена.", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  const maybePoint = parsePointFromText(text);
  if (maybePoint) {
    await saveHomeAndReply(env, ctx, chatId, maybePoint.point, maybePoint.label, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  await sendScreen(env, ctx, chatId, menuText(), cleanupIds);
  return new Response("ok", { status: 200 });
}

async function handleCallback(cb, env, ctx) {
  await tg(env, "answerCallbackQuery", { callback_query_id: cb.id });

  const chatId = await upsertCallbackUser(env, cb);
  const data = cb.data || "";

  if (data === "menu") {
    await clearFlow(env, chatId);
    await sendScreen(env, ctx, chatId, menuText());
    return new Response("ok", { status: 200 });
  }

  if (data === "reg:start") {
    await startRegistration(env, ctx, chatId, []);
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("ops:")) {
    const page = Number(data.split(":")[1] || 0);
    await showOperators(env, ctx, chatId, page);
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("op:")) {
    const parts = data.split(":");
    await showOperatorDossier(env, ctx, chatId, parts[1], Number(parts[2] || 0));
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("coop:")) {
    await createCoopRequest(env, ctx, chatId, data.split(":")[1]);
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("ca:")) {
    await answerCoop(env, ctx, chatId, data.split(":")[1], "accepted");
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("cd:")) {
    await answerCoop(env, ctx, chatId, data.split(":")[1], "declined");
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("trs:")) {
    const parts = data.split(":");
    await showTraceList(env, ctx, chatId, parts[1], Number(parts[2] || 0));
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("tr:")) {
    const parts = data.split(":");
    await showTrace(env, ctx, chatId, parts[1], Number(parts[2] || 0));
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("tn:")) {
    const routeId = data.split(":")[1];
    await setFlow(env, chatId, "trace_note", { route_id: routeId });
    await sendScreen(env, ctx, chatId, "<b>Сводка следа.</b>\n\nДо 512 символов. Ссылки запрещены.");
    return new Response("ok", { status: 200 });
  }

  if (data.startsWith("tm:")) {
    const routeId = data.split(":")[1];
    await setFlow(env, chatId, "trace_media", { route_id: routeId });
    await sendScreen(env, ctx, chatId, "<b>Медиа следа.</b>\n\nДо 3 фото или одно видео до 15 секунд.");
    return new Response("ok", { status: 200 });
  }

  await sendScreen(env, ctx, chatId, menuText());
  return new Response("ok", { status: 200 });
}

function reportText(p, count) {
  return "<b>Архив WanderOS</b>\n\n" +
    "Штаб: " + (hasHome(p) ? "установлен" : "нет") + "\n" +
    "Радиус: " + p.radius_m + " м\n" +
    "Следов в базе: " + count + "\n\n" +
    "<i>архив содержит рабочие следы</i>";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      let db = "missing";
      try {
        if (env.DB) {
          await env.DB.prepare("SELECT 1 AS ok").first();
          db = "D1 ready";
        }
      } catch {
        db = "D1 error";
      }

      return Response.json({
        service: "WanderOS",
        status: "ok",
        runtime: "Cloudflare Workers",
        database: db,
        modules: ["cooperation", "operator-profiles", "trace-cards", "media"]
      });
    }

    if (url.pathname !== "/webhook") return new Response("not found", { status: 404 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (!env.TELEGRAM_BOT_TOKEN) return new Response("missing token", { status: 500 });
    if (!env.DB) return new Response("missing D1 binding DB", { status: 500 });

    return handleTelegram(request, env, ctx);
  }
};
