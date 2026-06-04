import priorWorker from "./index_cardfile13c.js";

const PAGE = 10;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const trim = (v, n) => String(v || "").trim().slice(0, n);
const hasLink = t => /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.ru\b|\.com\b|\.net\b|\.org\b)/i.test(String(t || ""));
const msgText = m => m?.text ? m.text.trim() : "";
const bestPhoto = m => Array.isArray(m?.photo) && m.photo.length ? m.photo[m.photo.length - 1].file_id : null;
const ik = rows => ({ inline_keyboard: rows });

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
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS researches (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS research_links (id TEXT PRIMARY KEY,research_id TEXT NOT NULL,link_type TEXT NOT NULL CHECK(link_type IN ('trace','anomaly')),link_id TEXT NOT NULL,position INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(research_id,link_type,link_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS research_media (id TEXT PRIMARY KEY,research_id TEXT NOT NULL,media_type TEXT NOT NULL,file_id TEXT NOT NULL,duration INTEGER,position INTEGER NOT NULL,created_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_reviews (entity_type TEXT NOT NULL CHECK(entity_type IN ('anomaly','research')),entity_id TEXT NOT NULL,reviewer_chat_id TEXT NOT NULL,vote INTEGER NOT NULL CHECK(vote IN (-1,1)),created_at TEXT NOT NULL,PRIMARY KEY(entity_type,entity_id,reviewer_chat_id))`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_researches_title ON researches(title COLLATE NOCASE)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_research_links_research ON research_links(research_id,position)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_entity_reviews_entity ON entity_reviews(entity_type,entity_id)`).run();
}
async function flowSet(env, chatId, mode, payload = {}) { await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET mode=excluded.mode,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).bind(String(chatId), mode, JSON.stringify(payload), now()).run(); }
async function flowGet(env, chatId) { const r = await env.DB.prepare(`SELECT mode,payload_json FROM flow_state WHERE chat_id=?`).bind(String(chatId)).first(); if (!r) return { mode: null, payload: {} }; let p = {}; try { p = r.payload_json ? JSON.parse(r.payload_json) : {}; } catch {} return { mode: r.mode, payload: p }; }
async function flowClear(env, chatId) { await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,NULL,NULL,?) ON CONFLICT(chat_id) DO UPDATE SET mode=NULL,payload_json=NULL,updated_at=excluded.updated_at`).bind(String(chatId), now()).run(); }
async function countAll(env, table, where = "", bind = []) { const stmt = env.DB.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`); const r = bind.length ? await stmt.bind(...bind).first() : await stmt.first(); return Number(r?.total || 0); }
async function researchById(env, id) { return await env.DB.prepare(`SELECT r.*,op.callsign FROM researches r LEFT JOIN operator_profiles op ON op.chat_id=r.created_by_chat_id WHERE r.id=?`).bind(id).first(); }
async function links(env, id) { const r = await env.DB.prepare(`SELECT * FROM research_links WHERE research_id=? ORDER BY position ASC`).bind(id).all(); return r.results || []; }
async function media(env, id) { const r = await env.DB.prepare(`SELECT * FROM research_media WHERE research_id=? ORDER BY position ASC`).bind(id).all(); return r.results || []; }
async function entityRating(env, type, id) { const r = await env.DB.prepare(`SELECT COALESCE(SUM(vote),0) rating, SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) minus FROM entity_reviews WHERE entity_type=? AND entity_id=?`).bind(type, id).first(); return { rating: Number(r?.rating || 0), plus: Number(r?.plus || 0), minus: Number(r?.minus || 0) }; }
async function myVote(env, chatId, type, id) { return await env.DB.prepare(`SELECT vote FROM entity_reviews WHERE entity_type=? AND entity_id=? AND reviewer_chat_id=?`).bind(type, id, String(chatId)).first(); }
function ratingText(r) { return `${r.rating >= 0 ? "+" : ""}${r.rating} (${r.plus}+/ ${r.minus}-)`; }
function parseValue(text) { const m = String(text || "").match(/-?\d+/); if (!m) return null; const n = Number.parseInt(m[0], 10); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; }
function mediaCapacity(linkCount) { return Math.max(0, Math.min(9, 10 - Number(linkCount || 0))); }

async function showResearchMenu(env, ctx, chatId, cleanup = []) {
  const total = await countAll(env, "researches");
  await sendScreen(env, ctx, chatId, `<b>⌬ Исследования</b>\n\nЗаписей в разделе: <b>${total}</b>\n\nИсследование может объединять до 4 приложений: следы и аномалии. Текст — до 2048 символов, медиа — до 9 фото или одно видео до 3 минут, общий лимит вложений — 10.`, cleanup, {
    inline: ik([
      [{ text: "＋ Создать", callback_data: "cf:res:new" }],
      [{ text: "Все по ценности", callback_data: "cf:res:all:0" }, { text: "Поиск", callback_data: "cf:res:search" }],
      [{ text: "◀ Картотека", callback_data: "cf:menu" }]
    ])
  });
}
async function showResearchAll(env, ctx, chatId, page = 0, cleanup = []) {
  const r = await env.DB.prepare(`SELECT rs.*,op.callsign FROM researches rs LEFT JOIN operator_profiles op ON op.chat_id=rs.created_by_chat_id ORDER BY rs.value_points DESC, rs.created_at DESC LIMIT ? OFFSET ?`).bind(PAGE, page * PAGE).all();
  const total = await countAll(env, "researches");
  const rows = r.results || [];
  let out = `<b>⌬ Исследования по ценности</b>\nВсего: <b>${total}</b>\n\n`;
  for (let i = 0; i < rows.length; i++) {
    const rt = await entityRating(env, "research", rows[i].id);
    out += `<b>${page * PAGE + i + 1}.</b> ${esc(rows[i].title)} · ценность ${rows[i].value_points} · ${ratingText(rt)}\nАвтор: ${esc(rows[i].callsign || "оператор")}\n`;
  }
  if (!rows.length) out += "Записей нет.";
  const buttons = [];
  if (rows.length) buttons.push(rows.slice(0, 5).map((x, i) => ({ text: String(i + 1), callback_data: `cf:res:card:${x.id}:all:${page}` })));
  if (rows.length > 5) buttons.push(rows.slice(5, 10).map((x, i) => ({ text: String(i + 6), callback_data: `cf:res:card:${x.id}:all:${page}` })));
  const nav = [];
  if (page > 0) nav.push({ text: "◀", callback_data: `cf:res:all:${page - 1}` });
  if ((page + 1) * PAGE < total) nav.push({ text: "▶", callback_data: `cf:res:all:${page + 1}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "◀ Исследования", callback_data: "cf:res:menu" }]);
  await sendScreen(env, ctx, chatId, out.trim(), cleanup, { inline: ik(buttons) });
}
async function showSearchPrompt(env, ctx, chatId, cleanup = []) {
  await flowSet(env, chatId, "cf_res_search", {});
  await sendScreen(env, ctx, chatId, "<b>Поиск исследования</b>\n\nНапиши название или его часть.", cleanup, { inline: ik([[{ text: "◀ Исследования", callback_data: "cf:res:menu" }]]) });
}
async function showSearchResults(env, ctx, chatId, q, cleanup = []) {
  const s = trim(q, 64);
  if (!s) { await showSearchPrompt(env, ctx, chatId, cleanup); return; }
  const r = await env.DB.prepare(`SELECT * FROM researches WHERE title LIKE ? COLLATE NOCASE ORDER BY value_points DESC,title COLLATE NOCASE LIMIT 10`).bind("%" + s + "%").all();
  const rows = r.results || [];
  let out = `<b>Поиск исследования</b>\nЗапрос: <code>${esc(s)}</code>\n\n`;
  rows.forEach((x, i) => out += `<b>${i + 1}.</b> ${esc(x.title)} · ценность ${x.value_points}\n`);
  if (!rows.length) out += "Ничего не найдено.";
  const buttons = [];
  if (rows.length) buttons.push(rows.map((x, i) => ({ text: String(i + 1), callback_data: `cf:res:card:${x.id}:search:0` })));
  buttons.push([{ text: "Новый поиск", callback_data: "cf:res:search" }, { text: "◀ Исследования", callback_data: "cf:res:menu" }]);
  await sendScreen(env, ctx, chatId, out.trim(), cleanup, { inline: ik(buttons) });
}
async function showResearchCard(env, ctx, chatId, id, source = "all", page = 0, cleanup = []) {
  const r = await researchById(env, id);
  if (!r) { await showResearchMenu(env, ctx, chatId, cleanup); return; }
  const linkRows = await links(env, id);
  const mediaRows = await media(env, id);
  const rt = await entityRating(env, "research", id);
  const mv = await myVote(env, chatId, "research", id);
  let out = `<b>⌬ Исследование: ${esc(r.title)}</b>\n\n`;
  out += `Автор: <b>${esc(r.callsign || "оператор")}</b>\n`;
  out += `Ценность: <b>${Number(r.value_points || 0)}</b>\n`;
  out += `Рейтинг: <b>${ratingText(rt)}</b>${mv ? `\nТвой знак: <b>${mv.vote > 0 ? "+" : "-"}</b>` : ""}\n`;
  out += `Приложения: <b>${linkRows.length}/4</b>\n`;
  out += `Медиа: <b>${mediaRows.length}/${mediaCapacity(linkRows.length)}</b>\n`;
  out += `Общий лимит вложений: <b>${linkRows.length + mediaRows.length}/10</b>\n\n`;
  out += `${esc(r.body)}\n`;
  if (linkRows.length) {
    out += `\n<b>Приложения:</b>\n`;
    for (const l of linkRows) out += `• ${l.link_type === "trace" ? "след" : "аномалия"}: <code>${esc(l.link_id).slice(0, 12)}</code>\n`;
  }
  const back = source === "search" ? "cf:res:search" : `cf:res:all:${page}`;
  const buttons = [
    [{ text: "＋ ценность", callback_data: `cf:res:vote:${id}:1` }, { text: "− ценность", callback_data: `cf:res:vote:${id}:-1` }],
    [{ text: "＋ След", callback_data: `cf:res:addtrace:${id}:0` }, { text: "＋ Аномалия", callback_data: `cf:res:addanom:${id}:0` }],
    [{ text: "＋ Медиа", callback_data: `cf:res:media:${id}` }],
    [{ text: "◀ Назад", callback_data: back }, { text: "⌬ Исследования", callback_data: "cf:res:menu" }]
  ];
  const opt = { inline: ik(buttons) };
  if (mediaRows[0]?.media_type === "photo") opt.photo = mediaRows[0].file_id;
  if (mediaRows[0]?.media_type === "video") opt.video = mediaRows[0].file_id;
  await sendScreen(env, ctx, chatId, out.trim(), cleanup, opt);
}
async function voteResearch(env, ctx, chatId, id, vote) {
  const r = await researchById(env, id);
  if (!r) { await showResearchMenu(env, ctx, chatId); return; }
  if (String(r.created_by_chat_id) === String(chatId)) {
    await sendScreen(env, ctx, chatId, "<b>Оценка отклонена.</b>\n\nНельзя оценивать ценность собственного исследования.", [], { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]]) });
    return;
  }
  const existing = await myVote(env, chatId, "research", id);
  if (existing) {
    await sendScreen(env, ctx, chatId, `<b>Оценка уже учтена.</b>\n\nОдин оператор может оценить исследование только один раз.\nТвой знак: <b>${existing.vote > 0 ? "+" : "-"}</b>`, [], { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]]) });
    return;
  }
  await env.DB.prepare(`INSERT INTO entity_reviews(entity_type,entity_id,reviewer_chat_id,vote,created_at) VALUES('research',?,?,?,?)`).bind(id, String(chatId), Number(vote) > 0 ? 1 : -1, now()).run();
  await showResearchCard(env, ctx, chatId, id);
}

async function pickTrace(env, ctx, chatId, id, page = 0, cleanup = []) {
  const linkRows = await links(env, id);
  if (linkRows.length >= 4) { await sendScreen(env, ctx, chatId, "<b>Лимит приложений достигнут.</b>\n\nВ исследовании может быть до 4 следов/аномалий.", cleanup, { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]]) }); return; }
  const r = await env.DB.prepare(`SELECT id,title,kind,target_lat,target_lon FROM routes WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(String(chatId), PAGE, page * PAGE).all();
  const rows = r.results || [];
  let out = `<b>Добавить след в исследование</b>\n\nВыбери след.\n\n`;
  rows.forEach((x, i) => out += `<b>${i + 1}.</b> ${esc(x.title || x.kind || "след")}\n<code>${x.target_lat}, ${x.target_lon}</code>\n\n`);
  if (!rows.length) out += "Следов нет.";
  const buttons = [];
  if (rows.length) buttons.push(rows.slice(0, 5).map((x, i) => ({ text: String(i + 1), callback_data: `cf:res:linktrace:${id}:${x.id}` })));
  if (rows.length > 5) buttons.push(rows.slice(5, 10).map((x, i) => ({ text: String(i + 6), callback_data: `cf:res:linktrace:${id}:${x.id}` })));
  const nav = [];
  if (page > 0) nav.push({ text: "◀", callback_data: `cf:res:addtrace:${id}:${page - 1}` });
  if (rows.length === PAGE) nav.push({ text: "▶", callback_data: `cf:res:addtrace:${id}:${page + 1}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]);
  await sendScreen(env, ctx, chatId, out.trim(), cleanup, { inline: ik(buttons) });
}
async function pickAnomaly(env, ctx, chatId, id, page = 0, cleanup = []) {
  const linkRows = await links(env, id);
  if (linkRows.length >= 4) { await sendScreen(env, ctx, chatId, "<b>Лимит приложений достигнут.</b>\n\nВ исследовании может быть до 4 следов/аномалий.", cleanup, { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]]) }); return; }
  const r = await env.DB.prepare(`SELECT id,title,value_points FROM anomalies ORDER BY value_points DESC,title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(PAGE, page * PAGE).all();
  const total = await countAll(env, "anomalies");
  const rows = r.results || [];
  let out = `<b>Добавить аномалию в исследование</b>\n\nВыбери карточку.\n\n`;
  rows.forEach((x, i) => out += `<b>${i + 1}.</b> ${esc(x.title)} · ценность ${x.value_points}\n`);
  if (!rows.length) out += "Аномалий нет.";
  const buttons = [];
  if (rows.length) buttons.push(rows.slice(0, 5).map((x, i) => ({ text: String(i + 1), callback_data: `cf:res:linkanom:${id}:${x.id}` })));
  if (rows.length > 5) buttons.push(rows.slice(5, 10).map((x, i) => ({ text: String(i + 6), callback_data: `cf:res:linkanom:${id}:${x.id}` })));
  const nav = [];
  if (page > 0) nav.push({ text: "◀", callback_data: `cf:res:addanom:${id}:${page - 1}` });
  if ((page + 1) * PAGE < total) nav.push({ text: "▶", callback_data: `cf:res:addanom:${id}:${page + 1}` });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]);
  await sendScreen(env, ctx, chatId, out.trim(), cleanup, { inline: ik(buttons) });
}
async function addLink(env, ctx, chatId, id, type, linkId) {
  const linkRows = await links(env, id);
  if (linkRows.length >= 4) { await sendScreen(env, ctx, chatId, "<b>Лимит приложений достигнут.</b>"); return; }
  try {
    await env.DB.prepare(`INSERT INTO research_links(id,research_id,link_type,link_id,position,created_at) VALUES(?,?,?,?,?,?)`).bind(uid(), id, type, linkId, linkRows.length + 1, now()).run();
    await showResearchCard(env, ctx, chatId, id);
  } catch {
    await sendScreen(env, ctx, chatId, "<b>Приложение уже есть в исследовании.</b>", [], { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]]) });
  }
}
async function startMedia(env, ctx, chatId, id) {
  await flowSet(env, chatId, "cf_res_media", { research_id: id });
  const linkRows = await links(env, id), mediaRows = await media(env, id);
  await sendScreen(env, ctx, chatId, `<b>Медиа исследования</b>\n\nДоступно фото: <b>${Math.max(0, mediaCapacity(linkRows.length) - mediaRows.length)}</b>.\nМожно прикрепить до 9 фото или одно видео до 3 минут. Общий лимит вложений вместе с приложениями — 10.\n\nДля завершения напиши <code>/done</code>.`, [], { inline: ik([[{ text: "◀ Карточка", callback_data: `cf:res:card:${id}:all:0` }]]) });
}
async function handleMedia(env, ctx, chatId, m, flow, cleanup) {
  const id = flow.payload.research_id;
  const text = msgText(m).toLowerCase();
  if (text === "/done" || text === "готово") { await flowClear(env, chatId); await showResearchCard(env, ctx, chatId, id, "all", 0, cleanup); return true; }
  const linkRows = await links(env, id), mediaRows = await media(env, id), photo = bestPhoto(m), video = m.video || null;
  const capacity = mediaCapacity(linkRows.length);
  const hasVideo = mediaRows.some(x => x.media_type === "video");
  if (photo) {
    if (hasVideo || mediaRows.length >= capacity) { await sendScreen(env, ctx, chatId, "<b>Медиа не принято.</b>\n\nДостигнут лимит: до 9 фото и общий лимит 10 вложений вместе с приложениями.", cleanup); return true; }
    await env.DB.prepare(`INSERT INTO research_media(id,research_id,media_type,file_id,duration,position,created_at) VALUES(?,?,'photo',?,NULL,?,?)`).bind(uid(), id, photo, mediaRows.length + 1, now()).run();
    await sendScreen(env, ctx, chatId, "<b>Фото принято.</b>\n\nМожно отправить ещё фото или написать <code>/done</code>.", cleanup);
    return true;
  }
  if (video) {
    if (mediaRows.length > 0 || Number(video.duration || 0) > 180 || linkRows.length + 1 > 10) { await sendScreen(env, ctx, chatId, "<b>Видео не принято.</b>\n\nДопустимо одно видео до 3 минут и общий лимит 10 вложений.", cleanup); return true; }
    await env.DB.prepare(`INSERT INTO research_media(id,research_id,media_type,file_id,duration,position,created_at) VALUES(?,?,'video',?,?,1,?)`).bind(uid(), id, video.file_id, Number(video.duration || 0), now()).run();
    await flowClear(env, chatId); await showResearchCard(env, ctx, chatId, id, "all", 0, cleanup);
    return true;
  }
  await sendScreen(env, ctx, chatId, "<b>Жду медиа.</b>\n\nФото, видео до 3 минут или <code>/done</code>.", cleanup);
  return true;
}

async function handleResearchFlow(env, ctx, chatId, m, flow, cleanup) {
  const text = msgText(m);
  if (flow.mode === "cf_res_title") {
    const title = trim(text, 120);
    if (!title || hasLink(title)) { await sendScreen(env, ctx, chatId, "<b>Название не принято.</b>\n\nДо 120 символов, без ссылок.", cleanup); return true; }
    await flowSet(env, chatId, "cf_res_body", { title });
    await sendScreen(env, ctx, chatId, "<b>Текст исследования</b>\n\nДо 2048 символов. Ссылки запрещены.", cleanup);
    return true;
  }
  if (flow.mode === "cf_res_body") {
    const body = trim(text, 2048);
    if (!body || hasLink(body)) { await sendScreen(env, ctx, chatId, "<b>Текст не принят.</b>\n\nДо 2048 символов, без ссылок.", cleanup); return true; }
    await flowSet(env, chatId, "cf_res_value", { ...flow.payload, body });
    await sendScreen(env, ctx, chatId, "<b>Ценность исследования</b>\n\nУкажи число от 0 до 100.", cleanup);
    return true;
  }
  if (flow.mode === "cf_res_value") {
    const value = parseValue(text);
    if (value === null) { await sendScreen(env, ctx, chatId, "<b>Ценность не принята.</b>\n\nНужно число от 0 до 100.", cleanup); return true; }
    const id = uid();
    await env.DB.prepare(`INSERT INTO researches(id,title,body,value_points,created_by_chat_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(id, flow.payload.title, flow.payload.body, value, String(chatId), now(), now()).run();
    await flowClear(env, chatId);
    await sendScreen(env, ctx, chatId, `<b>Исследование зарегистрировано.</b>\n\nНазвание: <b>${esc(flow.payload.title)}</b>\nЦенность: <b>${value}</b>\n\nТеперь можно добавить приложения: следы, аномалии и медиа.`, cleanup, { inline: ik([[{ text: "⌬ Карточка", callback_data: `cf:res:card:${id}:all:0` }], [{ text: "＋ След", callback_data: `cf:res:addtrace:${id}:0` }, { text: "＋ Аномалия", callback_data: `cf:res:addanom:${id}:0` }], [{ text: "＋ Медиа", callback_data: `cf:res:media:${id}` }]]) });
    return true;
  }
  if (flow.mode === "cf_res_search") { await flowClear(env, chatId); await showSearchResults(env, ctx, chatId, text, cleanup); return true; }
  if (flow.mode === "cf_res_media") return await handleMedia(env, ctx, chatId, m, flow, cleanup);
  return false;
}
async function handleCallback(cb, env, ctx) {
  const data = cb.data || "";
  if (!data.startsWith("cf:res")) return false;
  await ensureSchema(env);
  await tg(env, "answerCallbackQuery", { callback_query_id: cb.id });
  const chatId = String(cb.message.chat.id);
  const p = data.split(":");
  const act = p[2];
  if (act === "menu") { await flowClear(env, chatId); await showResearchMenu(env, ctx, chatId); return true; }
  if (act === "new") { await flowSet(env, chatId, "cf_res_title", {}); await sendScreen(env, ctx, chatId, "<b>Новое исследование</b>\n\nУкажи название."); return true; }
  if (act === "all") { await flowClear(env, chatId); await showResearchAll(env, ctx, chatId, Number(p[3] || 0)); return true; }
  if (act === "search") { await showSearchPrompt(env, ctx, chatId); return true; }
  if (act === "card") { await flowClear(env, chatId); await showResearchCard(env, ctx, chatId, p[3], p[4] || "all", Number(p[5] || 0)); return true; }
  if (act === "vote") { await voteResearch(env, ctx, chatId, p[3], Number(p[4] || 0)); return true; }
  if (act === "addtrace") { await pickTrace(env, ctx, chatId, p[3], Number(p[4] || 0)); return true; }
  if (act === "addanom") { await pickAnomaly(env, ctx, chatId, p[3], Number(p[4] || 0)); return true; }
  if (act === "linktrace") { await addLink(env, ctx, chatId, p[3], "trace", p[4]); return true; }
  if (act === "linkanom") { await addLink(env, ctx, chatId, p[3], "anomaly", p[4]); return true; }
  if (act === "media") { await startMedia(env, ctx, chatId, p[3]); return true; }
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
  if (flow.mode?.startsWith("cf_res_")) return await handleResearchFlow(env, ctx, chatId, m, flow, cleanup);
  const text = msgText(m).toLowerCase();
  if (text === "/research" || text === "/res" || text.includes("новое исследование") || text.includes("создать исследование")) {
    await flowSet(env, chatId, "cf_res_title", {});
    await sendScreen(env, ctx, chatId, "<b>Новое исследование</b>\n\nУкажи название.", cleanup);
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
      return Response.json({ service: "WanderOS", status: "ok", runtime: "Cloudflare Workers", database, modules: ["research-workflow", "research-links", "research-media", "research-rating", "legacy-worker-delegation"] });
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
