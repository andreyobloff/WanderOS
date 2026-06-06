import priorWorker from "./index_cardfile13f.js";

const DEFAULT_CENTER = { lat: 55.7558, lon: 37.6173 };
const DEFAULT_RADIUS = 1200;
const MIN_RADIUS = 200;
const MAX_RADIUS = 5000;

const TITLES = [
  "тихий карман города",
  "точка слабого шума",
  "двор с обратным эхом",
  "место, где карта моргает",
  "порог между маршрутами",
  "слепая зона квартала",
  "фонарь без свидетелей",
  "узел городского фона"
];
const OMENS = [
  "Остановитесь на минуту и посмотрите, что здесь выбивается из обычного порядка.",
  "Проверьте детали: вывески, окна, отражения, странные совпадения.",
  "Не спешите фотографировать. Сначала осмотритесь и поймите, что именно привлекло внимание.",
  "Найдите маленький знак места: звук, предмет, надпись, повторяющийся узор.",
  "Если точка кажется обычной, это нормально. След начинается с внимательного взгляда.",
  "Запомните первое ощущение от места. Потом его можно сохранить в сводке следа."
];

const CUSTOM_EMOJI = {
  SIGNAL: "5307807553189602508",
  OPERATORS: "5307824393756369963",
  HQ: "5305364734705427996",
  TERMINAL: "5307894586406889399",
  CARDFILE: "5307519167610515559",
  PROFILE: "5305488777655902347",
  ARCHIVE: "5307978312499360126",
  HELP: "5307931093628906539"
};
const FALLBACK_EMOJI = {
  SIGNAL: "🎯",
  OPERATORS: "👥",
  HQ: "🏠",
  TERMINAL: "🖥",
  CARDFILE: "🗂",
  PROFILE: "👤",
  ARCHIVE: "📚",
  HELP: "❔"
};

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const pick = a => a[Math.floor(Math.random() * a.length)];
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const urlEsc = v => String(v ?? "").replaceAll("&", "&amp;");
const trim = (v, n) => String(v || "").trim().slice(0, n);
const msgText = m => m?.text ? m.text.trim() : "";
const point = (lat, lon) => ({ lat: Number(Number(lat).toFixed(6)), lon: Number(Number(lon).toFixed(6)) });
const hasHome = p => p && typeof p.base_lat === "number" && typeof p.base_lon === "number";
const registered = p => Boolean(p && p.callsign);
const ce = key => `<tg-emoji emoji-id="${CUSTOM_EMOJI[key]}">${FALLBACK_EMOJI[key]}</tg-emoji>`;
const ik = rows => ({ inline_keyboard: rows });

function label(key, text) {
  const prefix = FALLBACK_EMOJI[key] ? `${FALLBACK_EMOJI[key]} ` : "";
  const value = String(text || "");
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}
function btn(key, text, extra = {}) {
  return { text: label(key, text), icon_custom_emoji_id: CUSTOM_EMOJI[key], ...extra };
}
function ib(key, text, callback_data, extra = {}) {
  return { text: label(key, text), callback_data, icon_custom_emoji_id: CUSTOM_EMOJI[key], ...extra };
}
function urlButton(key, text, url, extra = {}) {
  return { text: label(key, text), url, icon_custom_emoji_id: CUSTOM_EMOJI[key], ...extra };
}
function terminalButton() {
  return ib("TERMINAL", "Терминал", "ux:terminal");
}
function helpButton() {
  return ib("HELP", "Помощь", "ux:help");
}
function replyKeyboard() {
  return {
    keyboard: [
      [btn("SIGNAL", "Поймать сигнал")],
      [btn("HQ", "Штаб"), btn("PROFILE", "Досье")],
      [btn("CARDFILE", "Картотека"), btn("ARCHIVE", "Архив")],
      [btn("OPERATORS", "Оперативники"), btn("HELP", "Помощь")],
      [btn("TERMINAL", "Терминал")]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "WanderOS terminal"
  };
}

function dist(a, b) {
  const R = 6371000;
  const la = a.lat * Math.PI / 180;
  const lb = b.lat * Math.PI / 180;
  const dx = (b.lat - a.lat) * Math.PI / 180;
  const dy = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dx / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dy / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}
function randomPoint(c, r) {
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r;
  const E = 6371000;
  return point(
    c.lat + (d * Math.cos(a) / E) * 180 / Math.PI,
    c.lon + (d * Math.sin(a) / (E * Math.cos(c.lat * Math.PI / 180))) * 180 / Math.PI
  );
}
const mapUrl = p => "https://www.google.com/maps?q=" + p.lat + "," + p.lon;
const routeUrl = (a, b) => "https://www.google.com/maps/dir/?api=1&origin=" + a.lat + "," + a.lon + "&destination=" + b.lat + "," + b.lon + "&travelmode=walking";

async function tg(env, method, payload) {
  const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  let data;
  try { data = await res.json(); } catch { data = { ok: false, description: "bad json" }; }
  if (!res.ok || data.ok !== true) console.error("Telegram API failed", method, res.status, JSON.stringify(data));
  return data;
}
async function delMsg(env, chatId, id) { if (!id) return; try { await tg(env, "deleteMessage", { chat_id: chatId, message_id: Number(id) }); } catch {} }
async function remember(env, chatId, id, dir) { if (!id) return; try { await env.DB.prepare(`INSERT OR IGNORE INTO ui_messages(chat_id,message_id,direction,created_at) VALUES(?,?,?,?)`).bind(String(chatId), Number(id), dir, now()).run(); } catch {} }
async function getUi(env, chatId) { return await env.DB.prepare(`SELECT active_message_id FROM ui_state WHERE chat_id=?`).bind(String(chatId)).first(); }
async function setUi(env, chatId, id) { await env.DB.prepare(`INSERT INTO ui_state(chat_id,active_message_id,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET active_message_id=excluded.active_message_id,updated_at=excluded.updated_at`).bind(String(chatId), Number(id), now()).run(); }
async function prune(env, chatId, keep) { try { await env.DB.prepare(`DELETE FROM ui_messages WHERE chat_id=? AND message_id<>?`).bind(String(chatId), Number(keep || 0)).run(); } catch {} }
async function sendScreen(env, ctx, chatId, text, cleanup = [], opt = {}) {
  const ui = await getUi(env, chatId);
  const old = ui?.active_message_id ? Number(ui.active_message_id) : null;
  const payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: opt.inline || replyKeyboard() };
  const sent = await tg(env, "sendMessage", payload);
  if (sent.ok && sent.result?.message_id) {
    const id = Number(sent.result.message_id);
    await setUi(env, chatId, id);
    await remember(env, chatId, id, "bot");
    ctx.waitUntil((async () => {
      for (const mid of [...new Set(cleanup.concat(old || []).filter(Boolean).map(Number))]) await delMsg(env, chatId, mid);
      await prune(env, chatId, id);
    })());
  }
}

async function ensureBaseSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (chat_id TEXT PRIMARY KEY, username TEXT, first_name TEXT, language_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS profiles (chat_id TEXT PRIMARY KEY, city TEXT, base_lat REAL, base_lon REAL, base_label TEXT, radius_m INTEGER, mood TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL, origin_lat REAL, origin_lon REAL, target_lat REAL, target_lon REAL, radius_m INTEGER, title TEXT, omen TEXT, map_url TEXT, route_url TEXT, created_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS trace_cards (route_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, summary TEXT, updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ui_state (chat_id TEXT PRIMARY KEY, active_message_id INTEGER, updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ui_messages (chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, direction TEXT, created_at TEXT NOT NULL, PRIMARY KEY(chat_id,message_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS flow_state (chat_id TEXT PRIMARY KEY, mode TEXT, payload_json TEXT, updated_at TEXT NOT NULL)`).run();
}
async function upsertUser(env, mOrCb) {
  const msg = mOrCb.message?.chat ? mOrCb.message : mOrCb;
  const chatId = String(msg.chat.id);
  const from = mOrCb.from || msg.from || {};
  const t = now();
  await env.DB.prepare(`INSERT INTO users(chat_id,username,first_name,language_code,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username,first_name=excluded.first_name,language_code=excluded.language_code,updated_at=excluded.updated_at`).bind(chatId, from.username || null, from.first_name || null, from.language_code || null, t, t).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO profiles(chat_id,city,radius_m,mood,created_at,updated_at) VALUES(?,'Москва',?,'liminal',?,?)`).bind(chatId, DEFAULT_RADIUS, t, t).run();
  return chatId;
}
async function flowSet(env, chatId, mode, payload = {}) { await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET mode=excluded.mode,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).bind(String(chatId), mode, JSON.stringify(payload), now()).run(); }
async function flowClear(env, chatId) { await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,NULL,NULL,?) ON CONFLICT(chat_id) DO UPDATE SET mode=NULL,payload_json=NULL,updated_at=excluded.updated_at`).bind(String(chatId), now()).run(); }
async function profile(env, chatId) {
  return await env.DB.prepare(`SELECT u.chat_id,u.username,u.first_name,p.base_lat,p.base_lon,p.base_label,p.radius_m,op.callsign FROM users u JOIN profiles p ON p.chat_id=u.chat_id LEFT JOIN operator_profiles op ON op.chat_id=u.chat_id WHERE u.chat_id=?`).bind(String(chatId)).first();
}
async function countRoutes(env, chatId) { const r = await env.DB.prepare(`SELECT COUNT(*) total FROM routes WHERE chat_id=?`).bind(String(chatId)).first(); return Number(r?.total || 0); }
async function latestRoute(env, chatId) { return await env.DB.prepare(`SELECT id,title,target_lat,target_lon,route_url,created_at FROM routes WHERE chat_id=? ORDER BY created_at DESC LIMIT 1`).bind(String(chatId)).first(); }
async function totalOperators(env) { try { const r = await env.DB.prepare(`SELECT COUNT(*) total FROM operator_profiles WHERE is_visible=1`).first(); return Number(r?.total || 0); } catch { return 0; } }
async function addRoute(env, chatId, origin, target, radius, title, omen) {
  const id = uid();
  const map = mapUrl(target);
  const route = routeUrl(origin, target);
  await env.DB.prepare(`INSERT INTO routes(id,chat_id,kind,origin_lat,origin_lon,target_lat,target_lon,radius_m,title,omen,map_url,route_url,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, String(chatId), "point", origin.lat, origin.lon, target.lat, target.lon, radius, title, omen, map, route, now()).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO trace_cards(route_id,chat_id,summary,updated_at) VALUES(?,?,NULL,?)`).bind(id, String(chatId), now()).run();
  return { id, map, route };
}

function terminalText(p, traceCount, last) {
  const title = `${ce("TERMINAL")} <b>WanderOS</b>`;
  if (!registered(p)) {
    return `${title}\n\nЭто городской терминал для поиска точек, прогулок и фиксации необычных находок.\n\nСначала создайте досье и укажите штаб — место, от которого WanderOS будет искать сигналы рядом с вами.\n\nПосле этого можно будет поймать сигнал, пройти к точке, сохранить след и добавить его в картотеку.\n\n<b>Состояние</b>\nДосье: не создано\nШтаб: ${hasHome(p) ? "установлен" : "не установлен"}\nАктивный сигнал: нет\n\nНачните с регистрации или пройдите короткое обучение.`;
  }
  if (!hasHome(p)) {
    return `${title}\n\nДосье создано. Осталось указать штаб.\n\nШтаб — это ваша стартовая точка. От неё WanderOS будет искать сигналы поблизости. Можно указать адрес, координаты, геопозицию или ссылку на карту.\n\n<b>Состояние</b>\nОператор: <b>${esc(p.callsign)}</b>\nШтаб: не установлен\nАктивный сигнал: нет\n\nУстановите штаб, чтобы начать ловить сигналы.`;
  }
  return `${title}\n\nТерминал готов.\n\nWanderOS может поймать для вас городскую точку рядом со штабом. Дойдите до неё, сохраните наблюдение в следе, а затем добавьте заметку, аномалию или исследование.\n\n<b>Состояние</b>\nОператор: <b>${esc(p.callsign)}</b>\nШтаб: установлен\nРадиус поиска: <b>${Number(p.radius_m || DEFAULT_RADIUS)} м</b>\nСледов в архиве: <b>${traceCount}</b>${last ? `\nПоследний сигнал: <code>${last.target_lat}, ${last.target_lon}</code>` : ""}\n\nМожно начинать.`;
}
async function showTerminal(env, ctx, chatId, cleanup = []) {
  await ensureBaseSchema(env);
  const p = await profile(env, chatId);
  const traces = await countRoutes(env, chatId);
  const last = await latestRoute(env, chatId);
  const rows = [];
  if (!registered(p)) {
    rows.push([ib("PROFILE", "Создать досье", "reg:start")]);
    rows.push([ib("HELP", "Как пройти регистрацию", "ux:help:registration"), ib("HELP", "Обучение", "ux:learn:0")]);
    if (!hasHome(p)) rows.push([ib("HQ", "Установить штаб", "ux:hq:set")]);
  } else if (!hasHome(p)) {
    rows.push([ib("HQ", "Установить штаб", "ux:hq:set")]);
    rows.push([ib("PROFILE", "Открыть досье", "eff:me"), helpButton()]);
  } else {
    rows.push([ib("SIGNAL", "Поймать сигнал", "ux:signal")]);
    rows.push([ib("HQ", "Штаб", "ux:hq"), ib("PROFILE", "Досье", "eff:me")]);
    rows.push([ib("CARDFILE", "Картотека", "ux:cardfile"), ib("ARCHIVE", "Архив", "ux:archive")]);
  }
  rows.push([ib("OPERATORS", "Оперативники", "ux:operators"), helpButton()]);
  await sendScreen(env, ctx, chatId, terminalText(p, traces, last), cleanup, { inline: ik(rows) });
}

async function showSignalIntro(env, ctx, chatId, cleanup = []) {
  const p = await profile(env, chatId);
  if (!registered(p)) {
    await sendScreen(env, ctx, chatId, `${ce("SIGNAL")} <b>Поймать сигнал</b>\n\nПеред первым сигналом нужно создать досье. Так WanderOS поймёт, кто сохраняет следы и материалы.`, cleanup, { inline: ik([[ib("PROFILE", "Создать досье", "reg:start")], [helpButton(), terminalButton()]]) });
    return;
  }
  if (!hasHome(p)) {
    await sendScreen(env, ctx, chatId, `${ce("SIGNAL")} <b>Поймать сигнал</b>\n\nСигнал ищется рядом со штабом, но штаб ещё не установлен.\n\nУкажите удобную стартовую точку: адрес, геопозицию, координаты или ссылку на карту.`, cleanup, { inline: ik([[ib("HQ", "Установить штаб", "ux:hq:set")], [helpButton(), terminalButton()]]) });
    return;
  }
  await sendScreen(env, ctx, chatId, `${ce("SIGNAL")} <b>Поймать сигнал</b>\n\nWanderOS выберет случайную точку рядом с вашим штабом.\n\nЭто может быть двор, улица, парк, перекрёсток или любое место в пределах выбранного радиуса. Дойдите до точки, осмотритесь и сохраните результат как след.\n\n<b>Текущий радиус:</b> ${Number(p.radius_m || DEFAULT_RADIUS)} м\n\nНажмите кнопку ниже, чтобы начать сканирование.`, cleanup, { inline: ik([[ib("SIGNAL", "Начать сканирование", "ux:signal:catch")], [ib("HQ", "Изменить радиус", "ux:radius"), ib("HQ", "Штаб", "ux:hq")], [terminalButton(), helpButton()]]) });
}
async function catchSignal(env, ctx, chatId, cleanup = []) {
  const p = await profile(env, chatId);
  if (!registered(p) || !hasHome(p)) { await showSignalIntro(env, ctx, chatId, cleanup); return; }
  const origin = point(p.base_lat, p.base_lon);
  const radius = Number(p.radius_m || DEFAULT_RADIUS);
  const target = randomPoint(origin, radius);
  const title = pick(TITLES);
  const omen = pick(OMENS);
  const route = await addRoute(env, chatId, origin, target, radius, title, omen);
  const d = dist(origin, target);
  const text = `${ce("SIGNAL")} <b>Сигнал пойман</b>\n\nWanderOS слушал город и нашёл точку рядом со штабом.\n\n<b>Сигнал:</b> ${esc(title)}\n<b>До точки:</b> примерно ${d} м\n<b>Координаты:</b> <code>${target.lat}, ${target.lon}</code>\n\n${esc(omen)}\n\nПосле прогулки откройте след и добавьте сводку: что увидели, что изменилось, что стоит проверить позже. След уже сохранён в архиве.`;
  await sendScreen(env, ctx, chatId, text, cleanup, { inline: ik([[urlButton("SIGNAL", "Открыть маршрут", route.route)], [ib("ARCHIVE", "Открыть след", `tr:${route.id}:0`), ib("ARCHIVE", "Добавить сводку", `tn:${route.id}`)], [ib("SIGNAL", "Поймать другой", "ux:signal:catch")], [terminalButton(), helpButton()]]) });
}

async function showHq(env, ctx, chatId, cleanup = []) {
  const p = await profile(env, chatId);
  const text = hasHome(p)
    ? `${ce("HQ")} <b>Штаб</b>\n\nШтаб — это ваша стартовая точка. От неё WanderOS ищет сигналы поблизости.\n\n<b>Текущий штаб:</b>\n<code>${p.base_lat}, ${p.base_lon}</code>\n${esc(p.base_label || "штаб")}\n\n<b>Радиус поиска:</b> ${Number(p.radius_m || DEFAULT_RADIUS)} м\n\nМожно изменить штаб или радиус.`
    : `${ce("HQ")} <b>Штаб</b>\n\nШтаб — это ваша стартовая точка. От неё WanderOS будет искать сигналы.\n\nНе обязательно указывать точный домашний адрес. Можно поставить штаб рядом: у станции метро, в районе, у парка или в любой удобной точке.\n\nЧтобы установить штаб, отправьте геопозицию, адрес, координаты или ссылку на карту.`;
  await sendScreen(env, ctx, chatId, text, cleanup, { inline: ik([[ib("HQ", hasHome(p) ? "Изменить штаб" : "Установить штаб", "ux:hq:set"), ib("HQ", "Изменить радиус", "ux:radius")], [helpButton(), terminalButton()]]) });
}
async function setHqPrompt(env, ctx, chatId, cleanup = []) {
  await flowSet(env, chatId, "await_home", {});
  await sendScreen(env, ctx, chatId, `${ce("HQ")} <b>Установка штаба</b>\n\nОтправьте одно из четырёх:\n\n1. Геопозицию Telegram.\n2. Адрес обычным текстом.\n3. Координаты, например <code>55.7558, 37.6173</code>.\n4. Ссылку на карту.\n\nПосле сохранения штаба WanderOS сможет ловить сигналы рядом с ним.`, cleanup, { inline: ik([[ib("HELP", "Что такое штаб?", "ux:help:hq")], [terminalButton()]]) });
}
async function radiusPrompt(env, ctx, chatId, cleanup = []) {
  await flowSet(env, chatId, "await_radius", {});
  await sendScreen(env, ctx, chatId, `${ce("HQ")} <b>Радиус поиска</b>\n\nРадиус определяет, насколько далеко от штаба WanderOS может поймать сигнал.\n\nНапишите число от ${MIN_RADIUS} до ${MAX_RADIUS}.\n\nПример: <code>800</code>`, cleanup, { inline: ik([[terminalButton(), helpButton()]]) });
}

async function showProfileIntro(env, ctx, chatId, cleanup = []) {
  const p = await profile(env, chatId);
  const text = registered(p)
    ? `${ce("PROFILE")} <b>Досье</b>\n\nДосье — это ваш профиль в WanderOS. В нём видны позывной, описание, следы, картотека и эффективность.\n\nОткройте досье, чтобы посмотреть профиль или изменить данные.`
    : `${ce("PROFILE")} <b>Досье</b>\n\nДосье — это ваш профиль в WanderOS. Оно нужно, чтобы сохранять следы, добавлять материалы и участвовать в рейтинге оперативников.\n\nРегистрация занимает несколько шагов: позывной, возраст, короткая запись о себе и фото по желанию.`;
  await sendScreen(env, ctx, chatId, text, cleanup, { inline: ik([[ib("PROFILE", registered(p) ? "Открыть досье" : "Создать досье", registered(p) ? "eff:me" : "reg:start")], [ib("HELP", "Как пройти регистрацию", "ux:help:registration"), terminalButton()]]) });
}
async function showCardfileIntro(env, ctx, chatId, cleanup = []) {
  await sendScreen(env, ctx, chatId, `${ce("CARDFILE")} <b>Картотека</b>\n\nКартотека — это место, где хранятся ваши материалы.\n\n<b>Аномалии</b> — отдельные находки с названием и ценностью.\n<b>Исследования</b> — большие записи, которые объединяют следы и аномалии.\n<b>Заметки</b> — личные текстовые записи.\n\nКартотека помогает превратить прогулки в понятную систему наблюдений.`, cleanup, { inline: ik([[{ text: "Аномалии", callback_data: "cf:anom:menu" }, { text: "Исследования", callback_data: "cf:res:menu" }], [{ text: "Заметки", callback_data: "cf:note:menu" }], [helpButton(), terminalButton()]]) });
}
async function showArchiveIntro(env, ctx, chatId, cleanup = []) {
  await sendScreen(env, ctx, chatId, `${ce("ARCHIVE")} <b>Архив</b>\n\nАрхив — это история ваших следов.\n\nСлед появляется после пойманного сигнала. В него можно добавить сводку, фото, видео, а затем привязать аномалию или исследование.\n\nОткройте архив, чтобы вернуться к старым точкам.`, cleanup, { inline: ik([[ib("ARCHIVE", "Открыть мои следы", `cfe:archive:${chatId}:0`)], [ib("SIGNAL", "Поймать сигнал", "ux:signal"), terminalButton()]]) });
}
async function showOperatorsIntro(env, ctx, chatId, cleanup = []) {
  const total = await totalOperators(env);
  await sendScreen(env, ctx, chatId, `${ce("OPERATORS")} <b>Оперативники</b>\n\nЗдесь можно найти других пользователей WanderOS.\n\nМожно смотреть оперативников рядом, открыть общий рейтинг, найти человека по позывному и предложить кооперацию.\n\nВсего зарегистрировано в бюро: <b>${total}</b>`, cleanup, { inline: ik([[ib("OPERATORS", "Оперативники рядом", "opsnear:0"), ib("OPERATORS", "Все по рейтингу", "eff:top:0")], [{ text: "Поиск по позывному", callback_data: "opssearch", icon_custom_emoji_id: CUSTOM_EMOJI.OPERATORS }], [helpButton(), terminalButton()]]) });
}

function helpText(topic = "menu") {
  if (topic === "registration") return `${ce("HELP")} <b>Как пройти регистрацию</b>\n\nРегистрация нужна, чтобы у вас появилось досье оператора.\n\nДосье — это ваш профиль внутри WanderOS. В нём хранятся позывной, описание, фото, следы, аномалии, исследования и эффективность.\n\nЧтобы зарегистрироваться:\n\n1. Нажмите <b>Досье</b>.\n2. Выберите <b>Создать досье</b>.\n3. Придумайте позывной.\n4. Укажите возраст.\n5. Укажите короткую запись о себе.\n6. Добавьте описание.\n7. При желании добавьте фото.\n\nПосле регистрации нужно установить штаб. Без штаба WanderOS не сможет искать сигналы рядом с вами.\n\nНе используйте в досье личные данные, которые не хотите показывать другим пользователям.`;
  if (topic === "hq") return `${ce("HELP")} <b>Что такое штаб</b>\n\nШтаб — это стартовая точка, от которой WanderOS ищет сигналы.\n\nЭто может быть дом, район, станция метро, парк или любое место, откуда вам удобно начинать прогулки.\n\nЕсли не хотите указывать точный адрес, поставьте штаб рядом.`;
  if (topic === "signal") return `${ce("HELP")} <b>Что такое сигнал и след</b>\n\nСигнал — это случайная точка рядом со штабом.\n\nКогда вы нажимаете <b>Поймать сигнал</b>, WanderOS выбирает место в пределах вашего радиуса и даёт маршрут.\n\nСлед — это сохранённый результат выхода к сигналу. В след можно добавить сводку, фото, видео, а затем связать его с аномалией или исследованием.`;
  if (topic === "cardfile") return `${ce("HELP")} <b>Что такое картотека</b>\n\nКартотека — это система ваших материалов.\n\nВ ней есть аномалии, исследования и заметки.\n\nАномалии фиксируют отдельные находки. Исследования объединяют несколько следов и аномалий. Заметки помогают сохранить личные мысли и наблюдения.`;
  if (topic === "operators") return `${ce("HELP")} <b>Оперативники и кооперация</b>\n\nОперативники — это другие пользователи WanderOS.\n\nМожно смотреть профили, искать по позывному, видеть рейтинг и предлагать кооперацию.\n\nКооперация нужна для совместных выходов и полевых наблюдений.`;
  if (topic === "privacy") return `${ce("HELP")} <b>Безопасность и приватность</b>\n\nНе указывайте точный домашний адрес, если не хотите раскрывать его. Штаб можно поставить рядом: у метро, парка или в любом удобном районе.\n\nНе добавляйте в досье личные данные, которые не хотите показывать другим пользователям.\n\nЕсли точка кажется небезопасной, не идите туда. Поймайте другой сигнал.`;
  return `${ce("HELP")} <b>Помощь</b>\n\nЗдесь собраны простые объяснения: как начать, зачем нужен штаб, что такое сигнал, как сохранять следы и как работает картотека.\n\nВыберите тему или запустите короткое обучение.`;
}
async function showHelp(env, ctx, chatId, topic = "menu", cleanup = []) {
  const rows = topic === "menu" ? [
    [ib("HELP", "Как начать", "ux:learn:0"), ib("PROFILE", "Регистрация", "ux:help:registration")],
    [ib("HQ", "Штаб", "ux:help:hq"), ib("SIGNAL", "Сигнал и след", "ux:help:signal")],
    [ib("CARDFILE", "Картотека", "ux:help:cardfile"), ib("OPERATORS", "Оперативники", "ux:help:operators")],
    [ib("HELP", "Безопасность", "ux:help:privacy")],
    [terminalButton()]
  ] : [
    [ib("HELP", "Пройти обучение", "ux:learn:0"), ib("HELP", "Все темы", "ux:help")],
    [terminalButton()]
  ];
  await sendScreen(env, ctx, chatId, helpText(topic), cleanup, { inline: ik(rows) });
}

const TUTORIAL = [
  { title: "Что такое WanderOS", body: "WanderOS — это бот для городских прогулок и фиксации находок.\n\nОн помогает выбрать случайную точку рядом с вами, построить маршрут, сохранить результат прогулки и вести личную картотеку.\n\nПроще говоря: WanderOS предлагает место, вы идёте туда, а потом сохраняете то, что нашли или заметили." },
  { title: "Досье", body: "Досье — это ваш профиль.\n\nВ нём хранится ваш позывной, описание, фото, следы, аномалии, исследования и эффективность.\n\nСначала создайте досье. Без него часть функций будет недоступна." },
  { title: "Штаб", body: "Штаб — это ваша стартовая точка.\n\nОт штаба WanderOS ищет сигналы поблизости. Это может быть дом, район, любимое место, станция метро или любая удобная точка.\n\nНе обязательно указывать точный домашний адрес. Можно поставить штаб рядом, если так спокойнее." },
  { title: "Поймать сигнал", body: "Сигнал — это случайная точка рядом со штабом.\n\nКогда вы нажимаете <b>Поймать сигнал</b>, WanderOS выбирает место в пределах вашего радиуса.\n\nПосле этого можно открыть маршрут и дойти до точки." },
  { title: "След", body: "След — это сохранённый результат выхода к сигналу.\n\nВ след можно добавить короткую сводку, фото или видео.\n\nСледы хранятся в архиве. Позже к ним можно привязать аномалию или исследование." },
  { title: "Архив", body: "Архив — это история ваших следов.\n\nЗдесь можно открыть старые точки, посмотреть сводки, медиа, связанные аномалии и исследования.\n\nАрхив помогает не потерять то, что вы уже нашли." },
  { title: "Картотека", body: "Картотека — это место, где хранятся ваши материалы.\n\n<b>Аномалии</b> — отдельные находки с названием и ценностью.\n<b>Исследования</b> — большие записи, которые объединяют следы и аномалии.\n<b>Заметки</b> — личные текстовые записи.\n\nКартотека помогает превратить прогулки в понятную систему наблюдений." },
  { title: "Оперативники", body: "Оперативники — это другие пользователи WanderOS.\n\nМожно смотреть операторов рядом, искать по позывному, открывать профили, смотреть следы и предлагать кооперацию.\n\nКооперация нужна для совместных выходов." },
  { title: "Что делать дальше", body: "Теперь у вас есть общий план:\n\n1. Создать досье.\n2. Установить штаб.\n3. Поймать сигнал.\n4. Дойти до точки.\n5. Сохранить след.\n6. Добавить заметку, аномалию или исследование.\n7. Смотреть архив и развивать картотеку.\n\nНачните с досье и штаба. После этого WanderOS будет готов к работе." }
];
async function showTutorial(env, ctx, chatId, index = 0, cleanup = []) {
  const i = Math.max(0, Math.min(Number(index || 0), TUTORIAL.length - 1));
  const step = TUTORIAL[i];
  const text = `${ce("HELP")} <b>Обучение: шаг ${i + 1} из ${TUTORIAL.length}</b>\n\n<b>${esc(step.title)}</b>\n\n${step.body}`;
  const nav = [];
  if (i > 0) nav.push({ text: "← Назад", callback_data: `ux:learn:${i - 1}` });
  if (i < TUTORIAL.length - 1) nav.push({ text: "Далее →", callback_data: `ux:learn:${i + 1}` });
  const rows = [];
  if (nav.length) rows.push(nav);
  if (i === TUTORIAL.length - 1) rows.push([ib("PROFILE", "Создать досье", "reg:start"), ib("HQ", "Установить штаб", "ux:hq:set")]);
  rows.push([ib("HELP", "Пропустить обучение", "ux:help"), terminalButton()]);
  await sendScreen(env, ctx, chatId, text, cleanup, { inline: ik(rows) });
}

async function handleCallback(cb, env, ctx) {
  const data = cb.data || "";
  if (!(data.startsWith("ux:") || data === "menu" || data === "cf:main")) return false;
  await ensureBaseSchema(env);
  await tg(env, "answerCallbackQuery", { callback_query_id: cb.id });
  const chatId = await upsertUser(env, cb);
  const p = data.split(":");
  if (data === "menu" || data === "cf:main" || data === "ux:terminal") { await flowClear(env, chatId); await showTerminal(env, ctx, chatId); return true; }
  if (data === "ux:signal") { await flowClear(env, chatId); await showSignalIntro(env, ctx, chatId); return true; }
  if (data === "ux:signal:catch") { await flowClear(env, chatId); await catchSignal(env, ctx, chatId); return true; }
  if (data === "ux:hq") { await flowClear(env, chatId); await showHq(env, ctx, chatId); return true; }
  if (data === "ux:hq:set") { await setHqPrompt(env, ctx, chatId); return true; }
  if (data === "ux:radius") { await radiusPrompt(env, ctx, chatId); return true; }
  if (data === "ux:profile") { await flowClear(env, chatId); await showProfileIntro(env, ctx, chatId); return true; }
  if (data === "ux:cardfile") { await flowClear(env, chatId); await showCardfileIntro(env, ctx, chatId); return true; }
  if (data === "ux:archive") { await flowClear(env, chatId); await showArchiveIntro(env, ctx, chatId); return true; }
  if (data === "ux:operators") { await flowClear(env, chatId); await showOperatorsIntro(env, ctx, chatId); return true; }
  if (p[1] === "help") { await flowClear(env, chatId); await showHelp(env, ctx, chatId, p[2] || "menu"); return true; }
  if (p[1] === "learn") { await flowClear(env, chatId); await showTutorial(env, ctx, chatId, Number(p[2] || 0)); return true; }
  return false;
}
async function handleMessage(update, env, ctx) {
  const m = update.message || update.edited_message;
  if (!m?.chat?.id) return false;
  await ensureBaseSchema(env);
  const chatId = await upsertUser(env, m);
  const incoming = m.message_id ? Number(m.message_id) : null;
  if (incoming) await remember(env, chatId, incoming, "user");
  const cleanup = incoming ? [incoming] : [];
  const text = msgText(m);
  const low = text.toLowerCase();
  if (low === "/start" || low === "/menu" || low.includes("терминал") || low === "меню") { await flowClear(env, chatId); await showTerminal(env, ctx, chatId, cleanup); return true; }
  if (low === "/help" || low.includes("помощь")) { await flowClear(env, chatId); await showHelp(env, ctx, chatId, "menu", cleanup); return true; }
  if (low.includes("поймать сигнал") || low === "сигнал" || low === "◌ сигнал" || low.includes("выход")) { await flowClear(env, chatId); await showSignalIntro(env, ctx, chatId, cleanup); return true; }
  if (low.includes("штаб")) { await flowClear(env, chatId); await showHq(env, ctx, chatId, cleanup); return true; }
  if (low.includes("досье") || low.includes("профиль")) { await flowClear(env, chatId); await showProfileIntro(env, ctx, chatId, cleanup); return true; }
  if (low.includes("картотека")) { await flowClear(env, chatId); await showCardfileIntro(env, ctx, chatId, cleanup); return true; }
  if (low.includes("архив") || low.includes("история")) { await flowClear(env, chatId); await showArchiveIntro(env, ctx, chatId, cleanup); return true; }
  if (low.includes("оперативники")) { await flowClear(env, chatId); await showOperatorsIntro(env, ctx, chatId, cleanup); return true; }
  if (low.startsWith("/tutorial") || low.includes("обучение")) { await flowClear(env, chatId); await showTutorial(env, ctx, chatId, 0, cleanup); return true; }
  return false;
}
async function handleUpdate(update, env, ctx) {
  if (update.callback_query) return await handleCallback(update.callback_query, env, ctx);
  return await handleMessage(update, env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      let database = "missing";
      try { if (env.DB) { await ensureBaseSchema(env); await env.DB.prepare("SELECT 1 AS ok").first(); database = "D1 ready"; } } catch { database = "D1 error"; }
      return Response.json({ service: "WanderOS", status: "ok", runtime: "Cloudflare Workers", database, modules: ["ux-menu-redesign", "custom-emoji-navigation", "help-center", "onboarding-tutorial", "signal-flow-redesign", "legacy-worker-delegation"] });
    }
    if (url.pathname !== "/webhook") return priorWorker.fetch(request, env, ctx);
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const clone = request.clone();
    let update;
    try { update = await clone.json(); } catch { return priorWorker.fetch(request, env, ctx); }
    const handled = await handleUpdate(update, env, ctx);
    if (handled) return new Response("ok", { status: 200 });
    return priorWorker.fetch(request, env, ctx);
  }
};

