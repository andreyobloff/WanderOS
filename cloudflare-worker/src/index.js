const DEFAULT_CENTER = { lat: 55.7558, lon: 37.6173 };
const DEFAULT_RADIUS = 1200;
const MIN_RADIUS = 200;
const MAX_RADIUS = 5000;

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

function now() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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
  const low = text.toLowerCase();

  if (low.startsWith("/")) {
    return low.split(/\s+/)[0].split("@")[0];
  }

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
  if (low.includes("меню")) return "/menu";

  return "";
}

function textOf(message) {
  return message && message.text ? message.text.trim() : "";
}

function mainKeyboard() {
  return {
    keyboard: [
      [
        { text: "⌂ Штаб" }
      ],
      [
        { text: "◌ Сигнал" },
        { text: "⟡ Выход" }
      ],
      [
        { text: "☾ Досье" },
        { text: "‡ Архив" }
      ],
      [
        { text: "⛯ Радиус" },
        { text: "? Терминал" }
      ]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "WanderOS terminal"
  };
}

async function tg(env, method, payload) {
  const api = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method;

  const res = await fetch(api, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data = null;

  try {
    data = await res.json();
  } catch {
    data = { ok: false, description: "bad json" };
  }

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
  } catch (e) {
    console.error("deleteMessage exception", String(e));
    return false;
  }
}

async function deleteMessageList(env, chatId, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];

  for (const messageId of unique) {
    await deleteMessage(env, chatId, messageId);
  }
}

async function rememberMessage(env, chatId, messageId, direction) {
  if (!messageId) return;

  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO ui_messages(chat_id, message_id, direction, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(String(chatId), Number(messageId), direction, now()).run();
  } catch (e) {
    console.error("rememberMessage failed", String(e));
  }
}

async function knownMessageIds(env, chatId, limit = 80) {
  try {
    const result = await env.DB.prepare(`
      SELECT message_id
      FROM ui_messages
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
  } catch (e) {
    console.error("pruneKnownMessages failed", String(e));
  }
}

async function getUiState(env, chatId) {
  return await env.DB.prepare(`
    SELECT active_message_id
    FROM ui_state
    WHERE chat_id = ?
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

async function sendScreen(env, ctx, chatId, text, extraDeleteIds = []) {
  const state = await getUiState(env, chatId);
  const previousActive = state && state.active_message_id ? Number(state.active_message_id) : null;

  const sent = await tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: mainKeyboard()
  });

  if (sent.ok && sent.result && sent.result.message_id) {
    const newMessageId = Number(sent.result.message_id);

    await setActiveMessage(env, chatId, newMessageId);
    await rememberMessage(env, chatId, newMessageId, "bot");

    const deleteIds = extraDeleteIds.concat(previousActive || []);
    ctx.waitUntil(deleteMessageList(env, chatId, deleteIds));
    ctx.waitUntil(pruneKnownMessages(env, chatId, newMessageId));

    return;
  }

  console.error("sendScreen failed");
}

async function logEvent(env, chatId, type, payload) {
  try {
    await env.DB.prepare(`
      INSERT INTO events(chat_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(
      String(chatId),
      type,
      JSON.stringify(payload || {}),
      now()
    ).run();
  } catch (e) {
    console.error("event log failed", String(e));
  }
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

async function profile(env, chatId) {
  return await env.DB.prepare(`
    SELECT u.chat_id, u.username, u.first_name,
           p.city, p.base_lat, p.base_lon, p.base_label,
           p.radius_m, p.mood, p.updated_at
    FROM users u
    JOIN profiles p ON p.chat_id = u.chat_id
    WHERE u.chat_id = ?
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
    uuid(), String(chatId), kind,
    origin.lat, origin.lon,
    target.lat, target.lon,
    radius, title, omen,
    map, route, now()
  ).run();

  return { map, route };
}

async function history(env, chatId) {
  const result = await env.DB.prepare(`
    SELECT kind, target_lat, target_lon, title, omen, route_url, created_at
    FROM routes
    WHERE chat_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).bind(String(chatId)).all();

  return result.results || [];
}

async function stats(env, chatId) {
  return await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM routes
    WHERE chat_id = ?
  `).bind(String(chatId)).first();
}

function hasHome(p) {
  return p && typeof p.base_lat === "number" && typeof p.base_lon === "number";
}

function menuText() {
  return "<b>WanderOS</b>\n" +
    "<i>аномалия проявляется, когда маршрут выбран верно</i>\n\n" +
    "⌂ <b>Штаб</b> — база операций\n" +
    "◌ <b>Сигнал</b> — метка рядом со штабом\n" +
    "⟡ <b>Выход</b> — путь до сигнала\n" +
    "☾ <b>Досье</b> — профиль оператора\n" +
    "‡ <b>Архив</b> — последние выходы";
}

function needHomeText() {
  return "<b>Штаб не установлен.</b>\n\n" +
    "Открой ⌂ <b>Штаб</b> и прикрепи любую точку через геолокацию.";
}

function setHomeText() {
  return "<b>Установка штаба</b>\n\n" +
    "Прикрепи геолокацию через вложение Telegram. Подойдёт текущая позиция, выбранная точка на карте, дом, вуз или другая база операций.";
}

function homeSavedText(target, route) {
  return "<b>Штаб установлен.</b>\n\n" +
    "Операции будут рассчитываться от этой точки.\n\n" +
    "Первичный сигнал: <code>" + target.lat + ", " + target.lon + "</code>\n" +
    "<a href=\"" + urlHtml(route) + "\">Открыть путь</a>";
}

function profileText(p, count) {
  const name = p.username ? "@" + safeHtml(p.username) : safeHtml(p.first_name || "оператор");

  const base = hasHome(p)
    ? "<code>" + p.base_lat + ", " + p.base_lon + "</code>\n" + safeHtml(p.base_label || "штаб")
    : "не установлен";

  return "<b>☾ Досье оператора</b>\n\n" +
    "Позывной: " + name + "\n" +
    "Город: " + safeHtml(p.city || "Москва") + "\n" +
    "Радиус: <b>" + p.radius_m + " м</b>\n" +
    "Штаб: " + base + "\n" +
    "Следов: <b>" + count + "</b>";
}

function pointText(target, route, title, omen) {
  return "<b>◌ Сигнал: " + safeHtml(title) + "</b>\n\n" +
    "Метка: <code>" + target.lat + ", " + target.lon + "</code>\n" +
    "<a href=\"" + urlHtml(route) + "\">Открыть путь</a>\n\n" +
    "<i>" + safeHtml(omen) + "</i>";
}

function routeText(target, route, title, omen) {
  return "<b>⟡ Выход: " + safeHtml(title) + "</b>\n\n" +
    "Цель: <code>" + target.lat + ", " + target.lon + "</code>\n" +
    "<a href=\"" + urlHtml(route) + "\">Идти</a>\n\n" +
    "<i>" + safeHtml(omen) + "</i>";
}

function radiusHelpText() {
  return "<b>⛯ Радиус поиска</b>\n\n" +
    "Формат:\n" +
    "<code>/radius 800</code>\n\n" +
    "Предел: 200–5000 м.";
}

function parseRadius(text) {
  const m = text.match(/\/radius\s+(\d+)/i);
  if (!m) return null;

  const value = Number.parseInt(m[1], 10);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_RADIUS || value > MAX_RADIUS) return null;

  return value;
}

function historyText(rows) {
  if (!rows.length) {
    return "<b>‡ Архив пуст.</b>\n\nВыходов ещё не было.";
  }

  let out = "<b>‡ Архив выходов</b>\n\n";

  rows.forEach((r, i) => {
    out += "<b>" + (i + 1) + ". " + safeHtml(r.title || "сигнал") + "</b>\n";
    out += "<code>" + r.target_lat + ", " + r.target_lon + "</code>\n";
    out += "<a href=\"" + urlHtml(r.route_url) + "\">путь</a>\n\n";
  });

  return out.trim();
}

function reportText(p, count) {
  return "<b>Архив WanderOS</b>\n\n" +
    "Штаб: " + (hasHome(p) ? "установлен" : "нет") + "\n" +
    "Радиус: " + p.radius_m + " м\n" +
    "Следов в базе: " + count + "\n\n" +
    "<i>архив содержит рабочие следы</i>";
}

function demoText() {
  const target = randomPoint(DEFAULT_CENTER, DEFAULT_RADIUS);

  return "<b>Демо-сигнал</b>\n\n" +
    "<code>" + target.lat + ", " + target.lon + "</code>\n" +
    "<a href=\"" + urlHtml(pointUrl(target)) + "\">открыть карту</a>";
}

async function handleLocation(env, ctx, chatId, message, cleanupIds) {
  let label = "штаб";

  if (message.venue) {
    label = [message.venue.title, message.venue.address].filter(Boolean).join(" — ");
  }

  const loc = message.location || message.venue?.location;

  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
    await logEvent(env, chatId, "location_missing", {});
    await sendScreen(env, ctx, chatId, "<b>Штаб не принят.</b>\n\nПрикрепи точку через геолокацию Telegram.", cleanupIds);
    return;
  }

  const origin = await updateHome(env, chatId, loc.latitude, loc.longitude, label);

  const p = await profile(env, chatId);
  const radius = p.radius_m || DEFAULT_RADIUS;
  const target = randomPoint(origin, radius);
  const title = pick(TITLES);
  const omen = pick(OMENS);
  const saved = await addRoute(env, chatId, "home", origin, target, radius, title, omen);

  await logEvent(env, chatId, "home_saved", { origin, target });
  await sendScreen(env, ctx, chatId, homeSavedText(target, saved.route), cleanupIds);
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

  if (kind === "route") {
    await sendScreen(env, ctx, chatId, routeText(target, saved.route, title, omen), cleanupIds);
  } else {
    await sendScreen(env, ctx, chatId, pointText(target, saved.route, title, omen), cleanupIds);
  }
}

async function handleTelegram(request, env, ctx) {
  const update = await request.json();
  const message = update.message || update.edited_message;

  if (!message || !message.chat || !message.chat.id) {
    return new Response("ignored", { status: 200 });
  }

  const chatId = await upsertUser(env, message);
  const cmd = commandOf(message);
  const text = textOf(message);
  const incomingId = message.message_id ? Number(message.message_id) : null;

  if (incomingId) {
    await rememberMessage(env, chatId, incomingId, "user");
  }

  let cleanupIds = incomingId ? [incomingId] : [];

  if (cmd === "/wipe" || cmd === "/clean") {
    const known = await knownMessageIds(env, chatId, 80);
    cleanupIds = cleanupIds.concat(known);

    await clearActiveMessage(env, chatId);
    await sendScreen(env, ctx, chatId, menuText(), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (message.location || message.venue) {
    await handleLocation(env, ctx, chatId, message, cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/start" || cmd === "/menu" || cmd === "/help") {
    await sendScreen(env, ctx, chatId, menuText(), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/sethome" || cmd === "/home" || cmd === "/location") {
    await sendScreen(env, ctx, chatId, setHomeText(), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/profile") {
    const p = await profile(env, chatId);
    const s = await stats(env, chatId);
    await sendScreen(env, ctx, chatId, profileText(p, s.total || 0), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/radius") {
    const r = parseRadius(text);

    if (!r) {
      await sendScreen(env, ctx, chatId, radiusHelpText(), cleanupIds);
      return new Response("ok", { status: 200 });
    }

    await updateRadius(env, chatId, r);
    await logEvent(env, chatId, "radius_changed", { radius: r });
    await sendScreen(env, ctx, chatId, "<b>Радиус изменён.</b>\n\nКруг поиска: <b>" + r + " м</b>.", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/point") {
    await makePoint(env, ctx, chatId, "point", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/route") {
    await makePoint(env, ctx, chatId, "route", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/history") {
    const rows = await history(env, chatId);
    await sendScreen(env, ctx, chatId, historyText(rows), cleanupIds);
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

    await logEvent(env, chatId, "home_cleared", {});
    await sendScreen(env, ctx, chatId, "<b>Штаб сброшен.</b>\n\nПривязка удалена.", cleanupIds);
    return new Response("ok", { status: 200 });
  }

  if (cmd === "/demo") {
    await sendScreen(env, ctx, chatId, demoText(), cleanupIds);
    return new Response("ok", { status: 200 });
  }

  await sendScreen(env, ctx, chatId, menuText(), cleanupIds);
  return new Response("ok", { status: 200 });
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
        ui: "send-message-cleanup-fixed"
      });
    }

    if (url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    if (!env.TELEGRAM_BOT_TOKEN) {
      return new Response("missing token", { status: 500 });
    }

    if (!env.DB) {
      return new Response("missing D1 binding DB", { status: 500 });
    }

    return handleTelegram(request, env, ctx);
  }
};

