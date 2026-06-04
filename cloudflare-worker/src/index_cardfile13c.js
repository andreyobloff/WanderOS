import priorWorker from "./index_cardfile.js";

const PAGE = 10;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const trim = (v, n) => String(v || "").trim().slice(0, n);
const hasLink = t => /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.ru\b|\.com\b|\.net\b|\.org\b)/i.test(String(t || ""));
const msgText = m => m?.text ? m.text.trim() : "";
const bestPhoto = m => Array.isArray(m?.photo) && m.photo.length ? m.photo[m.photo.length - 1].file_id : null;

function replyKeyboard() {
  return {
    keyboard: [
      [{ text: "⌂ Штаб" }],
      [{ text: "◌ Сигнал" }, { text: "⟡ Выход" }],
      [{ text: "⊕ Оперативники" }, { text: "▣ Картотека" }],
      [{ text: "⚭ Кооперация" }, { text: "☾ Досье" }],
      [{ text: "‡ Архив" }, { text: "⛯ Радиус" }],
      [{ text: "? Терминал" }]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: "WanderOS terminal"
  };
}
const ik = rows => ({ inline_keyboard: rows });

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
async function getUi(env, chatId) { return await env.DB.prepare(`SELECT active_message_id FROM ui_state WHERE chat_id=?`).bind(String(chatId)).first(); }
async function setUi(env, chatId, id) { await env.DB.prepare(`INSERT INTO ui_state(chat_id,active_message_id,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET active_message_id=excluded.active_message_id,updated_at=excluded.updated_at`).bind(String(chatId), Number(id), now()).run(); }
async function remember(env, chatId, id, dir) { if (!id) return; try { await env.DB.prepare(`INSERT OR IGNORE INTO ui_messages(chat_id,message_id,direction,created_at) VALUES(?,?,?,?)`).bind(String(chatId), Number(id), dir, now()).run(); } catch {} }
async function prune(env, chatId, keep) { try { await env.DB.prepare(`DELETE FROM ui_messages WHERE chat_id=? AND message_id<>?`).bind(String(chatId), Number(keep || 0)).run(); } catch {} }
async function sendScreen(env, ctx, chatId, text, cleanup = [], opt = {}) {
  const ui = await getUi(env, chatId);
  const old = ui?.active_message_id ? Number(ui.active_message_id) : null;
  let method = "sendMessage";
  let payload = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: opt.inline || replyKeyboard() };
  if (opt.photo) { method = "sendPhoto"; payload = { chat_id: chatId, photo: opt.photo, caption: text, parse_mode: "HTML", reply_markup: opt.inline || replyKeyboard() }; }
  if (opt.video) { method = "sendVideo"; payload = { chat_id: chatId, video: opt.video, caption: text, parse_mode: "HTML", reply_markup: opt.inline || replyKeyboard() }; }
  const sent = await tg(env, method, payload);
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

async function ensureSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomalies (id TEXT PRIMARY KEY,title TEXT NOT NULL COLLATE NOCASE UNIQUE,description TEXT,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_route_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomaly_findings (id TEXT PRIMARY KEY,anomaly_id TEXT NOT NULL,route_id TEXT NOT NULL,finder_chat_id TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,created_at TEXT NOT NULL,UNIQUE(anomaly_id,route_id,finder_chat_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomaly_media (id TEXT PRIMARY KEY,anomaly_id TEXT NOT NULL,media_type TEXT NOT NULL,file_id TEXT NOT NULL,duration INTEGER,position INTEGER NOT NULL,created_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_reviews (entity_type TEXT NOT NULL CHECK(entity_type IN ('anomaly','research')),entity_id TEXT NOT NULL,reviewer_chat_id TEXT NOT NULL,vote INTEGER NOT NULL CHECK(vote IN (-1,1)),created_at TEXT NOT NULL,PRIMARY KEY(entity_type,entity_id,reviewer_chat_id))`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_anomalies_title ON anomalies(title COLLATE NOCASE)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_anomaly_findings_anomaly ON anomaly_findings(anomaly_id)`).run();
}
async function flowSet(env, chatId, mode, payload = {}) { await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET mode=excluded.mode,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).bind(String(chatId), mode, JSON.stringify(payload), now()).run(); }
async function flowGet(env, chatId) { const r = await env.DB.prepare(`SELECT mode,payload_json FROM flow_state WHERE chat_id=?`).bind(String(chatId)).first(); if (!r) return { mode: null, payload: {} }; let p = {}; try { p = r.payload_json ? JSON.parse(r.payload_json) : {}; } catch {} return { mode: r.mode, payload: p }; }
async function flowClear(env, chatId) { await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,NULL,NULL,?) ON CONFLICT(chat_id) DO UPDATE SET mode=NULL,payload_json=NULL,updated_at=excluded.updated_at`).bind(String(chatId), now()).run(); }
async function callsign(env, chatId) { const r = await env.DB.prepare(`SELECT callsign FROM operator_profiles WHERE chat_id=?`).bind(String(chatId)).first(); return r?.callsign || "оператор"; }
async function routeById(env, routeId) { return await env.DB.prepare(`SELECT * FROM routes WHERE id=?`).bind(routeId).first(); }
async function anomalyById(env, id) { return await env.DB.prepare(`SELECT a.*,op.callsign FROM anomalies a LEFT JOIN operator_profiles op ON op.chat_id=a.created_by_chat_id WHERE a.id=?`).bind(id).first(); }
async function anomalyByTitle(env, title) { return await env.DB.prepare(`SELECT * FROM anomalies WHERE title=? COLLATE NOCASE LIMIT 1`).bind(title).first(); }
async function mediaList(env, anomalyId) { const r = await env.DB.prepare(`SELECT * FROM anomaly_media WHERE anomaly_id=? ORDER BY position ASC`).bind(anomalyId).all(); return r.results || []; }
async function findingCount(env, anomalyId) { const r = await env.DB.prepare(`SELECT COUNT(*) total FROM anomaly_findings WHERE anomaly_id=?`).bind(anomalyId).first(); return Number(r?.total || 0); }
async function researchCount(env, anomalyId) { try { const r = await env.DB.prepare(`SELECT COUNT(*) total FROM research_links WHERE link_type='anomaly' AND link_id=?`).bind(anomalyId).first(); return Number(r?.total || 0); } catch { return 0; } }
async function entityRating(env, type, id) { const r = await env.DB.prepare(`SELECT COALESCE(SUM(vote),0) rating, SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) minus FROM entity_reviews WHERE entity_type=? AND entity_id=?`).bind(type, id).first(); return { rating: Number(r?.rating || 0), plus: Number(r?.plus || 0), minus: Number(r?.minus || 0) }; }
async function myVote(env, chatId, type, id) { return await env.DB.prepare(`SELECT vote FROM entity_reviews WHERE entity_type=? AND entity_id=? AND reviewer_chat_id=?`).bind(type, id, String(chatId)).first(); }
function ratingText(r) { return `${r.rating >= 0 ? "+" : ""}${r.rating} (${r.plus}+/ ${r.minus}-)`; }
function normalizeTitle(text) { return String(text || "").trim().replace(/\s+/g, " ").slice(0, 80); }
function parseValue(text) { const m = String(text || "").match(/-?\d+/); if (!m) return null; const n = Number.parseInt(m[0], 10); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; }

async function showAnomalyMenu(env, ctx, chatId, cleanup = []) {
  const total = await env.DB.prepare(`SELECT COUNT(*) total FROM anomalies`).first();
  const findings = await env.DB.prepare(`SELECT COUNT(*) total FROM anomaly_findings`).first();
  await sendScreen(env, ctx, chatId, `<b>△ Аномалии</b>\n\nУникальных карточек: <b>${Number(total?.total || 0)}</b>\nОбнаружений в следах: <b>${Number(findings?.total || 0)}</b>\n\nАномалия выявляется один раз, но может быть обнаружена в разных следах разными операторами.`, cleanup, {
    inline: ik([
      [{ text: "＋ Зарегистрировать", callback_data: "cf:anom:new" }],
      [{ text: "В радиусе", callback_data: "cf:anom:near:0" }, { text: "Все по ценности", callback_data: "cf:anom:all:0" }],
      [{ text: "Поиск", callback_data: "cf:anom:search" }],
      [{ text: "◀ Картотека", callback_data: "cf:menu" }]
    ])
  });
}
async function showTracePicker(env, ctx, chatId, page = 0, anomalyId = null, cleanup = []) {
  const r = await env.DB.prepare(`SELECT id,kind,title,target_lat,target_lon,created_at FROM routes WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(String(chatId), PAGE, page * PAGE).all();
  const rows = r.results || [];
  let out = anomalyId ? `<b>Привязка аномалии к следу</b>\n\nВыбери след, где она обнаружена.\n\n` : `<b>Новая аномалия</b>\n\nВыбери след, в ходе которого она обнаружена.\n\n`;
  rows.forEach((x, i) => out += `<b>${i + 1}.</b> ${esc(x.title || x.kind || "след")}\n<code>${x.target_lat}, ${x.target_lon}</code>\n\n`);
  if (!rows.length) out += "Следов пока нет. Сначала создай ◌ Сигнал или ⟡ Выход.";
  const buttons = [];
  if (rows.length) buttons.push(rows.slice(0, 5).map((x, i) => ({ text: String(i + 1), callback_data: anomalyId ? `cf:anom:attachtrace:${anomalyId}:${x.id}` : `cf:anom:trace:${x.id}` })));
  if (rows.length > 5) buttons.push(rows.slice(5, 10).map((x, i) => ({ text: String(i + 6), callback_data: anomalyId ? `cf:anom:attachtrace:${anomalyId}:${x.id}` : `cf:anom:trace:${x.id}` })));
  const nav = [];
  if (page > 0) nav.push({ text: "◀", callback_data: anomalyId ? `cf:anom:attach:${anomalyId}:${page - 1}` : `cf:anom:new:${page - 1}` });
  if (rows.length === PAGE) nav.push({ text: "▶", callback_data: anomalyId ? `cf:anom:attach:${anomalyId}:${page + 1}` : `cf:anom:new:${page + 1}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "◀ Аномалии", callback_data: "cf:anom:menu" }]);
  await sendScreen(env, ctx, chatId, out.trim(), cleanup, { inline: ik(buttons) });
}
async function addFinding(env, anomalyId, routeId, chatId) {
  const r = await routeById(env, routeId);
  if (!r) return { ok: false, reason: "trace_missing" };
  try {
    await env.DB.prepare(`INSERT INTO anomaly_findings(id,anomaly_id,route_id,finder_chat_id,lat,lon,created_at) VALUES(?,?,?,?,?,?,?)`).bind(uid(), anomalyId, routeId, String(chatId), Number(r.target_lat), Number(r.target_lon), now()).run();
    return { ok: true, route: r, duplicate: false };
  } catch {
    return { ok: true, route: r, duplicate: true };
  }
}
async function showAnomalyCard(env, ctx, chatId, id, cleanup = []) {
  const a = await anomalyById(env, id);
  if (!a) { await showAnomalyMenu(env, ctx, chatId, cleanup); return; }
  const rt = await entityRating(env, "anomaly", id);
  const mv = await myVote(env, chatId, "anomaly", id);
  const fc = await findingCount(env, id);
  const rc = await researchCount(env, id);
  const media = await mediaList(env, id);
  const route = a.created_route_id ? await routeById(env, a.created_route_id) : null;
  let out = `<b>△ Аномалия: ${esc(a.title)}</b>\n\n`;
  out += `Выявил: <b>${esc(a.callsign || "оператор")}</b>\n`;
  out += `Ценность: <b>${Number(a.value_points || 0)}</b>\n`;
  out += `Рейтинг: <b>${ratingText(rt)}</b>${mv ? `\nТвой знак: <b>${mv.vote > 0 ? "+" : "-"}</b>` : ""}\n`;
  out += `Обнаружений: <b>${fc}</b>\nУчастие в исследованиях: <b>${rc}</b>\nМедиа: <b>${media.length}</b>\n`;
  if (route) out += `Первичный след: <code>${route.target_lat}, ${route.target_lon}</code>\n`;
  if (a.description) out += `\n${esc(a.description)}\n`;
  const opt = { inline: ik([
    [{ text: "＋ ценность", callback_data: `cf:anom:vote:${id}:1` }, { text: "− ценность", callback_data: `cf:anom:vote:${id}:-1` }],
    [{ text: "＋ Обнаружено в следе", callback_data: `cf:anom:attach:${id}:0` }, { text: "＋ Медиа", callback_data: `cf:anom:media:${id}` }],
    [{ text: "◀ Аномалии", callback_data: "cf:anom:menu" }]
  ]) };
  if (media[0]?.media_type === "photo") opt.photo = media[0].file_id;
  if (media[0]?.media_type === "video") opt.video = media[0].file_id;
  await sendScreen(env, ctx, chatId, out.trim(), cleanup, opt);
}
async function voteAnomaly(env, ctx, chatId, id, vote) {
  const a = await anomalyById(env, id);
  if (!a) { await showAnomalyMenu(env, ctx, chatId); return; }
  if (String(a.created_by_chat_id) === String(chatId)) {
    await sendScreen(env, ctx, chatId, "<b>Оценка отклонена.</b>\n\nНельзя оценивать ценность собственной аномалии.", [], { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:anom:card:${id}` }]]) });
    return;
  }
  const existing = await myVote(env, chatId, "anomaly", id);
  if (existing) {
    await sendScreen(env, ctx, chatId, `<b>Оценка уже учтена.</b>\n\nОдин оператор может оценить аномалию только один раз.\nТвой знак: <b>${existing.vote > 0 ? "+" : "-"}</b>`, [], { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:anom:card:${id}` }]]) });
    return;
  }
  await env.DB.prepare(`INSERT INTO entity_reviews(entity_type,entity_id,reviewer_chat_id,vote,created_at) VALUES('anomaly',?,?,?,?)`).bind(id, String(chatId), Number(vote) > 0 ? 1 : -1, now()).run();
  await showAnomalyCard(env, ctx, chatId, id);
}
async function startMediaFlow(env, ctx, chatId, id) {
  await flowSet(env, chatId, "cf_anom_media", { anomaly_id: id });
  await sendScreen(env, ctx, chatId, "<b>Медиа аномалии</b>\n\nОтправь до 3 фото или одно видео до 3 минут.\nДля завершения напиши <code>/done</code>.", [], { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:anom:card:${id}` }]]) });
}
async function handleMedia(env, ctx, chatId, m, flow, cleanup) {
  const id = flow.payload.anomaly_id;
  const text = msgText(m).toLowerCase();
  if (text === "/done" || text === "готово") { await flowClear(env, chatId); await showAnomalyCard(env, ctx, chatId, id, cleanup); return true; }
  const media = await mediaList(env, id);
  const photo = bestPhoto(m), video = m.video || null;
  const hasVideo = media.some(x => x.media_type === "video");
  if (photo) {
    if (hasVideo || media.length >= 3) { await sendScreen(env, ctx, chatId, "<b>Медиа не принято.</b>\n\nДопустимо до 3 фото или одно видео.", cleanup); return true; }
    await env.DB.prepare(`INSERT INTO anomaly_media(id,anomaly_id,media_type,file_id,duration,position,created_at) VALUES(?,?,'photo',?,NULL,?,?)`).bind(uid(), id, photo, media.length + 1, now()).run();
    await sendScreen(env, ctx, chatId, "<b>Фото принято.</b>\n\nМожно отправить ещё фото или написать <code>/done</code>.", cleanup);
    return true;
  }
  if (video) {
    if (media.length > 0 || Number(video.duration || 0) > 180) { await sendScreen(env, ctx, chatId, "<b>Видео не принято.</b>\n\nДопустимо одно видео до 3 минут и без других медиа.", cleanup); return true; }
    await env.DB.prepare(`INSERT INTO anomaly_media(id,anomaly_id,media_type,file_id,duration,position,created_at) VALUES(?,?,'video',?,?,1,?)`).bind(uid(), id, video.file_id, Number(video.duration || 0), now()).run();
    await flowClear(env, chatId); await showAnomalyCard(env, ctx, chatId, id, cleanup);
    return true;
  }
  await sendScreen(env, ctx, chatId, "<b>Жду медиа.</b>\n\nФото, видео до 3 минут или <code>/done</code>.", cleanup);
  return true;
}
async function handleAnomalyFlow(env, ctx, chatId, m, flow, cleanup) {
  const text = msgText(m);
  if (flow.mode === "cf_anom_title") {
    const title = normalizeTitle(text);
    if (!title || hasLink(title)) { await sendScreen(env, ctx, chatId, "<b>Название не принято.</b>\n\nДо 80 символов, без ссылок.", cleanup); return true; }
    const exists = await anomalyByTitle(env, title);
    if (exists) {
      const f = await addFinding(env, exists.id, flow.payload.route_id, chatId);
      await flowClear(env, chatId);
      await sendScreen(env, ctx, chatId, `<b>Аномалия уже есть в картотеке.</b>\n\n${f.duplicate ? "Повторная привязка к этому следу уже была." : "Обнаружение добавлено к выбранному следу."}`, cleanup, { inline: ik([[{ text: "△ Открыть карточку", callback_data: `cf:anom:card:${exists.id}` }], [{ text: "◀ Аномалии", callback_data: "cf:anom:menu" }]]) });
      return true;
    }
    await flowSet(env, chatId, "cf_anom_value", { route_id: flow.payload.route_id, title });
    await sendScreen(env, ctx, chatId, "<b>Ценность аномалии</b>\n\nУкажи число от 0 до 100. Эти очки будут учитываться в эффективности оператора.", cleanup);
    return true;
  }
  if (flow.mode === "cf_anom_value") {
    const value = parseValue(text);
    if (value === null) { await sendScreen(env, ctx, chatId, "<b>Ценность не принята.</b>\n\nНужно число от 0 до 100.", cleanup); return true; }
    await flowSet(env, chatId, "cf_anom_desc", { ...flow.payload, value });
    await sendScreen(env, ctx, chatId, "<b>Описание аномалии</b>\n\nДо 1024 символов. Можно написать <code>/skip</code>.", cleanup);
    return true;
  }
  if (flow.mode === "cf_anom_desc") {
    const description = text === "/skip" ? "" : trim(text, 1024);
    if (description && hasLink(description)) { await sendScreen(env, ctx, chatId, "<b>Описание не принято.</b>\n\nСсылки запрещены.", cleanup); return true; }
    const id = uid();
    try {
      await env.DB.prepare(`INSERT INTO anomalies(id,title,description,value_points,created_by_chat_id,created_route_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id, flow.payload.title, description || null, Number(flow.payload.value || 0), String(chatId), flow.payload.route_id, now(), now()).run();
    } catch {
      const exists = await anomalyByTitle(env, flow.payload.title);
      if (exists) { await addFinding(env, exists.id, flow.payload.route_id, chatId); await flowClear(env, chatId); await showAnomalyCard(env, ctx, chatId, exists.id, cleanup); return true; }
      throw new Error("anomaly insert failed");
    }
    await addFinding(env, id, flow.payload.route_id, chatId);
    await flowSet(env, chatId, "cf_anom_media", { anomaly_id: id });
    await sendScreen(env, ctx, chatId, `<b>Аномалия зарегистрирована.</b>\n\nНазвание: <b>${esc(flow.payload.title)}</b>\nЦенность: <b>${Number(flow.payload.value || 0)}</b>\n\nТеперь можно добавить медиа: до 3 фото или одно видео до 3 минут. Для пропуска напиши <code>/done</code>.`, cleanup);
    return true;
  }
  if (flow.mode === "cf_anom_media") return await handleMedia(env, ctx, chatId, m, flow, cleanup);
  return false;
}

async function handleCallback(cb, env, ctx) {
  const data = cb.data || "";
  if (!data.startsWith("cf:anom")) return false;
  await ensureSchema(env);
  await tg(env, "answerCallbackQuery", { callback_query_id: cb.id });
  const chatId = String(cb.message.chat.id);
  const p = data.split(":");
  const act = p[2];
  if (act === "menu") { await flowClear(env, chatId); await showAnomalyMenu(env, ctx, chatId); return true; }
  if (act === "new") { await flowClear(env, chatId); await showTracePicker(env, ctx, chatId, Number(p[3] || 0)); return true; }
  if (act === "trace") { await flowSet(env, chatId, "cf_anom_title", { route_id: p[3] }); await sendScreen(env, ctx, chatId, "<b>Название аномалии</b>\n\nУкажи уникальное название. Если такая аномалия уже есть, она будет привязана к выбранному следу как новое обнаружение."); return true; }
  if (act === "card") { await flowClear(env, chatId); await showAnomalyCard(env, ctx, chatId, p[3]); return true; }
  if (act === "vote") { await voteAnomaly(env, ctx, chatId, p[3], Number(p[4] || 0)); return true; }
  if (act === "media") { await startMediaFlow(env, ctx, chatId, p[3]); return true; }
  if (act === "attach") { await showTracePicker(env, ctx, chatId, Number(p[4] || 0), p[3]); return true; }
  if (act === "attachtrace") {
    const id = p[3], routeId = p[4];
    const f = await addFinding(env, id, routeId, chatId);
    await sendScreen(env, ctx, chatId, f.duplicate ? "<b>Обнаружение уже было привязано к этому следу.</b>" : "<b>Обнаружение добавлено.</b>\n\nАномалия привязана к выбранному следу.", [], { inline: ik([[{ text: "△ Карточка", callback_data: `cf:anom:card:${id}` }], [{ text: "◀ Аномалии", callback_data: "cf:anom:menu" }]]) });
    return true;
  }
  return false;
}
async function handleMessage(update, env, ctx) {
  const m = update.message || update.edited_message;
  if (!m?.chat?.id) return false;
  await ensureSchema(env);
  const chatId = String(m.chat.id);
  const incoming = m.message_id ? Number(m.message_id) : null;
  if (incoming) await remember(env, chatId, incoming, "user");
  const cleanup = incoming ? [incoming] : [];
  const flow = await flowGet(env, chatId);
  if (flow.mode?.startsWith("cf_anom_")) return await handleAnomalyFlow(env, ctx, chatId, m, flow, cleanup);
  const text = msgText(m).toLowerCase();
  if (text === "/anomaly" || text === "/anom" || text.includes("новая аномалия") || text.includes("зарегистрировать аномалию")) {
    await showTracePicker(env, ctx, chatId, 0, null, cleanup);
    return true;
  }
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
      try { if (env.DB) { await ensureSchema(env); await env.DB.prepare("SELECT 1 AS ok").first(); database = "D1 ready"; } } catch { database = "D1 error"; }
      return Response.json({ service: "WanderOS", status: "ok", runtime: "Cloudflare Workers", database, modules: ["cardfile-wrapper", "anomaly-registration", "anomaly-findings", "anomaly-media", "legacy-worker-delegation"] });
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
