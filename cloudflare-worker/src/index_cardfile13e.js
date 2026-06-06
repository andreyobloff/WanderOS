import priorWorker from "./index_cardfile13d.js";

const PAGE = 10;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const trim = (v, n) => String(v || "").trim().slice(0, n);
const hasLink = t => /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.ru\b|\.com\b|\.net\b|\.org\b)/i.test(String(t || ""));
const msgText = m => m?.text ? m.text.trim() : "";
const ik = rows => ({ inline_keyboard: rows });

function replyKeyboard(){
  return { keyboard:[
    [{text:"⌂ Штаб"}],
    [{text:"◌ Сигнал"},{text:"⟡ Выход"}],
    [{text:"⊕ Оперативники"},{text:"▣ Картотека"}],
    [{text:"⚭ Кооперация"},{text:"☾ Досье"}],
    [{text:"‡ Архив"},{text:"⛯ Радиус"}],
    [{text:"? Терминал"}]
  ], resize_keyboard:true, is_persistent:true, input_field_placeholder:"WanderOS terminal" };
}
async function tg(env, method, payload){
  const r = await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  let j; try{j=await r.json();}catch{j={ok:false,description:"bad json"};}
  if(!r.ok||j.ok!==true) console.error("Telegram API failed",method,r.status,JSON.stringify(j));
  return j;
}
async function delMsg(env, chatId, id){ if(!id)return; try{await tg(env,"deleteMessage",{chat_id:chatId,message_id:Number(id)});}catch{} }
async function getUi(env, chatId){ return await env.DB.prepare(`SELECT active_message_id FROM ui_state WHERE chat_id=?`).bind(String(chatId)).first(); }
async function setUi(env, chatId, id){ await env.DB.prepare(`INSERT INTO ui_state(chat_id,active_message_id,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET active_message_id=excluded.active_message_id,updated_at=excluded.updated_at`).bind(String(chatId),Number(id),now()).run(); }
async function remember(env, chatId, id, dir){ if(!id)return; try{await env.DB.prepare(`INSERT OR IGNORE INTO ui_messages(chat_id,message_id,direction,created_at) VALUES(?,?,?,?)`).bind(String(chatId),Number(id),dir,now()).run();}catch{} }
async function prune(env, chatId, keep){ try{await env.DB.prepare(`DELETE FROM ui_messages WHERE chat_id=? AND message_id<>?`).bind(String(chatId),Number(keep||0)).run();}catch{} }
async function sendScreen(env, ctx, chatId, text, cleanup=[], opt={}){
  const ui=await getUi(env,chatId), old=ui?.active_message_id?Number(ui.active_message_id):null;
  let method="sendMessage";
  let payload={chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true,reply_markup:opt.inline||replyKeyboard()};
  if(opt.photo){method="sendPhoto";payload={chat_id:chatId,photo:opt.photo,caption:text,parse_mode:"HTML",reply_markup:opt.inline||replyKeyboard()};}
  const sent=await tg(env,method,payload);
  if(sent.ok&&sent.result?.message_id){
    const id=Number(sent.result.message_id);
    await setUi(env,chatId,id); await remember(env,chatId,id,"bot");
    ctx.waitUntil((async()=>{for(const mid of [...new Set(cleanup.concat(old||[]).filter(Boolean).map(Number))]) await delMsg(env,chatId,mid); await prune(env,chatId,id);})());
  }
}

async function ensureSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomalies (id TEXT PRIMARY KEY,title TEXT NOT NULL COLLATE NOCASE UNIQUE,description TEXT,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_route_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomaly_findings (id TEXT PRIMARY KEY,anomaly_id TEXT NOT NULL,route_id TEXT NOT NULL,finder_chat_id TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,created_at TEXT NOT NULL,UNIQUE(anomaly_id,route_id,finder_chat_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS researches (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS research_links (id TEXT PRIMARY KEY,research_id TEXT NOT NULL,link_type TEXT NOT NULL CHECK(link_type IN ('trace','anomaly')),link_id TEXT NOT NULL,position INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(research_id,link_type,link_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS card_notes (id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_reviews (entity_type TEXT NOT NULL CHECK(entity_type IN ('anomaly','research')),entity_id TEXT NOT NULL,reviewer_chat_id TEXT NOT NULL,vote INTEGER NOT NULL CHECK(vote IN (-1,1)),created_at TEXT NOT NULL,PRIMARY KEY(entity_type,entity_id,reviewer_chat_id))`).run();
}
async function flowSet(env, chatId, mode, payload={}){ await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET mode=excluded.mode,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).bind(String(chatId),mode,JSON.stringify(payload),now()).run(); }
async function flowGet(env, chatId){ const r=await env.DB.prepare(`SELECT mode,payload_json FROM flow_state WHERE chat_id=?`).bind(String(chatId)).first(); if(!r)return{mode:null,payload:{}}; let p={}; try{p=r.payload_json?JSON.parse(r.payload_json):{};}catch{} return{mode:r.mode,payload:p}; }
async function flowClear(env, chatId){ await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,NULL,NULL,?) ON CONFLICT(chat_id) DO UPDATE SET mode=NULL,payload_json=NULL,updated_at=excluded.updated_at`).bind(String(chatId),now()).run(); }
async function profile(env, chatId){ return await env.DB.prepare(`SELECT u.chat_id,u.username,u.first_name,p.base_lat,p.base_lon,p.radius_m,p.base_label,op.callsign,op.age,op.sex,op.bio,op.photo_file_id FROM users u JOIN profiles p ON p.chat_id=u.chat_id LEFT JOIN operator_profiles op ON op.chat_id=u.chat_id WHERE u.chat_id=?`).bind(String(chatId)).first(); }
async function cardStats(env, chatId){
  const a=await env.DB.prepare(`SELECT COUNT(*) c, COALESCE(SUM(value_points),0) v FROM anomalies WHERE created_by_chat_id=?`).bind(String(chatId)).first();
  const f=await env.DB.prepare(`SELECT COUNT(*) c FROM anomaly_findings WHERE finder_chat_id=?`).bind(String(chatId)).first();
  const r=await env.DB.prepare(`SELECT COUNT(*) c, COALESCE(SUM(value_points),0) v FROM researches WHERE created_by_chat_id=?`).bind(String(chatId)).first();
  const n=await env.DB.prepare(`SELECT COUNT(*) c FROM card_notes WHERE chat_id=?`).bind(String(chatId)).first();
  return {anomalies:Number(a?.c||0),anomalyValue:Number(a?.v||0),findings:Number(f?.c||0),researches:Number(r?.c||0),researchValue:Number(r?.v||0),notes:Number(n?.c||0),value:Number(a?.v||0)+Number(r?.v||0)};
}
async function countRoutes(env, chatId){ const r=await env.DB.prepare(`SELECT COUNT(*) c FROM routes WHERE chat_id=?`).bind(String(chatId)).first(); return Number(r?.c||0); }
async function countCoops(env, chatId){ const r=await env.DB.prepare(`SELECT COUNT(*) c FROM cooperations WHERE status='accepted' AND (requester_chat_id=? OR target_chat_id=?)`).bind(String(chatId),String(chatId)).first(); return Number(r?.c||0); }
async function entityRating(env,type,id){ const r=await env.DB.prepare(`SELECT COALESCE(SUM(vote),0) rating, SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) minus FROM entity_reviews WHERE entity_type=? AND entity_id=?`).bind(type,id).first(); return {rating:Number(r?.rating||0),plus:Number(r?.plus||0),minus:Number(r?.minus||0)}; }
function ratingText(r){ return `${r.rating>=0?"+":""}${r.rating} (${r.plus}+/ ${r.minus}-)`; }
function parseValue(text){ const m=String(text||"").match(/-?\d+/); if(!m)return null; const n=Number.parseInt(m[0],10); return Number.isFinite(n)&&n>=0&&n<=100?n:null; }

function dossierText(p, stats, traces, coops, self=true){
  if(!p?.callsign) return `<b>☾ Досье оператора</b>\n\nСтатус: не оформлено.\n\nКоманда: <code>/register</code>`;
  const user=p.username?"@"+esc(p.username):esc(p.first_name||"нет");
  const base=typeof p.base_lat==="number"?`<code>${p.base_lat}, ${p.base_lon}</code>\n${esc(p.base_label||"штаб")}`:"не установлен";
  return `<b>☾ ${self?"Досье оператора":"Профиль оперативника"}</b>\n\nПозывной: <b>${esc(p.callsign)}</b>\nПользователь: ${user}\nВозраст: ${p.age||"—"}\nПол: ${esc(p.sex||"—")}\nРадиус: <b>${p.radius_m||"—"} м</b>\nШтаб: ${base}\n\n<b>Полевая активность</b>\nСледы: <b>${traces}</b>\nКооперации: <b>${coops}</b>\n\n<b>Картотека</b>\nВыявленные аномалии: <b>${stats.anomalies}</b>\nОбнаружения аномалий: <b>${stats.findings}</b>\nИсследования: <b>${stats.researches}</b>\n${self?`Заметки: <b>${stats.notes}</b>\n`:""}Ценность картотеки: <b>${stats.value}</b>\n\n${esc(p.bio||"")}`;
}
async function showSelfDossier(env, ctx, chatId, cleanup=[]){
  const p=await profile(env,chatId), stats=await cardStats(env,chatId), traces=await countRoutes(env,chatId), coops=await countCoops(env,chatId);
  const rows=p?.callsign?[
    [{text:"✎ Редактировать",callback_data:"edit:menu"}],
    [{text:"‡ Следы",callback_data:`cfe:archive:${chatId}:0`},{text:"△ Аномалии",callback_data:`cfe:anom:${chatId}:created:0`}],
    [{text:"⌬ Исследования",callback_data:`cfe:res:${chatId}:0`},{text:"≡ Заметки",callback_data:"cfe:notes:0"}],
    [{text:"▣ Картотека",callback_data:"cf:menu"},{text:"⌂ Терминал",callback_data:"cf:main"}]
  ]:[[{text:"Оформить досье",callback_data:"reg:start"}],[{text:"⌂ Терминал",callback_data:"cf:main"}]];
  await sendScreen(env,ctx,chatId,dossierText(p,stats,traces,coops,true),cleanup,{photo:p?.photo_file_id||null,inline:ik(rows)});
}
async function showOperatorDossier(env, ctx, viewer, target, cleanup=[]){
  const p=await profile(env,target); if(!p?.callsign){await sendScreen(env,ctx,viewer,"<b>Оперативник не найден.</b>",cleanup);return;}
  const stats=await cardStats(env,target), traces=await countRoutes(env,target), coops=await countCoops(env,target);
  await sendScreen(env,ctx,viewer,dossierText(p,stats,traces,coops,false),cleanup,{photo:p.photo_file_id||null,inline:ik([
    [{text:"‡ Следы",callback_data:`cfe:archive:${target}:0`},{text:"△ Выявил",callback_data:`cfe:anom:${target}:created:0`}],
    [{text:"△ Обнаружил",callback_data:`cfe:anom:${target}:found:0`},{text:"⌬ Исследования",callback_data:`cfe:res:${target}:0`}],
    [{text:"⚭ Кооперация",callback_data:`coop:${target}`},{text:"⊕ Оперативники",callback_data:"opsmenu"}]
  ])});
}
async function showArchive(env, ctx, viewer, owner, page=0, cleanup=[]){
  const p=await profile(env,owner), r=await env.DB.prepare(`SELECT id,kind,title,target_lat,target_lon,created_at FROM routes WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(String(owner),PAGE,page*PAGE).all();
  const total=await countRoutes(env,owner), rows=r.results||[];
  let out=`<b>‡ Архив следов</b>\n${p?.callsign?`<i>${esc(p.callsign)}</i>\n`:""}Всего: <b>${total}</b>\n\n`;
  rows.forEach((x,i)=>out+=`<b>${page*PAGE+i+1}.</b> ${esc(x.title||x.kind||"след")}\n<code>${x.target_lat}, ${x.target_lon}</code>\n\n`);
  if(!rows.length)out+="Следов нет.";
  const buttons=[]; if(rows.length)buttons.push(rows.slice(0,5).map((x,i)=>({text:String(i+1),callback_data:`cfe:trace:${x.id}:${page}`}))); if(rows.length>5)buttons.push(rows.slice(5,10).map((x,i)=>({text:String(i+6),callback_data:`cfe:trace:${x.id}:${page}`})));
  const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cfe:archive:${owner}:${page-1}`}); if((page+1)*PAGE<total)nav.push({text:"▶",callback_data:`cfe:archive:${owner}:${page+1}`}); if(nav.length)buttons.push(nav);
  buttons.push([{text:"☾ Досье",callback_data:String(owner)===String(viewer)?"cfe:me":`cfe:op:${owner}`},{text:"⌂ Терминал",callback_data:"cf:main"}]);
  await sendScreen(env,ctx,viewer,out.trim(),cleanup,{inline:ik(buttons)});
}
async function showTrace(env, ctx, viewer, routeId, page=0, cleanup=[]){
  const r=await env.DB.prepare(`SELECT rt.*,op.callsign FROM routes rt LEFT JOIN operator_profiles op ON op.chat_id=rt.chat_id WHERE rt.id=?`).bind(routeId).first();
  if(!r){await sendScreen(env,ctx,viewer,"<b>След не найден.</b>",cleanup);return;}
  const card=await env.DB.prepare(`SELECT summary FROM trace_cards WHERE route_id=?`).bind(routeId).first();
  const anomalies=await env.DB.prepare(`SELECT a.id,a.title,a.value_points,op.callsign FROM anomaly_findings f JOIN anomalies a ON a.id=f.anomaly_id LEFT JOIN operator_profiles op ON op.chat_id=f.finder_chat_id WHERE f.route_id=? ORDER BY f.created_at DESC`).bind(routeId).all();
  const researches=await env.DB.prepare(`SELECT rs.id,rs.title,rs.value_points,op.callsign FROM research_links l JOIN researches rs ON rs.id=l.research_id LEFT JOIN operator_profiles op ON op.chat_id=rs.created_by_chat_id WHERE l.link_type='trace' AND l.link_id=? ORDER BY rs.created_at DESC`).bind(routeId).all();
  let out=`<b>‡ След: ${esc(r.title||r.kind||"сигнал")}</b>\n\nОператор: <b>${esc(r.callsign||"оператор")}</b>\nЦель: <code>${r.target_lat}, ${r.target_lon}</code>\n<a href="${esc(r.route_url||"")}">путь</a>\n\n`;
  out+=card?.summary?`<b>Сводка:</b>\n${esc(card.summary)}\n\n`:`<i>Сводка не заполнена.</i>\n\n`;
  out+=`<b>Аномалии следа:</b>\n`; const ar=anomalies.results||[]; if(ar.length) ar.forEach(a=>out+=`• ${esc(a.title)} · ценность ${a.value_points} · обнаружил ${esc(a.callsign||"оператор")}\n`); else out+="нет\n";
  out+=`\n<b>Исследования со следом:</b>\n`; const rr=researches.results||[]; if(rr.length) rr.forEach(x=>out+=`• ${esc(x.title)} · ценность ${x.value_points}\n`); else out+="нет\n";
  const rows=[];
  rows.push([{text:"＋ Аномалия",callback_data:`cf:anom:trace:${routeId}`},{text:"＋ Исследование",callback_data:`cfe:resfromtrace:${routeId}`}]);
  if(ar.length)rows.push(ar.slice(0,2).map(a=>({text:`△ ${trim(a.title,14)}`,callback_data:`cf:anom:card:${a.id}`})));
  if(rr.length)rows.push(rr.slice(0,2).map(x=>({text:`⌬ ${trim(x.title,14)}`,callback_data:`cf:res:card:${x.id}:all:0`})));
  rows.push([{text:"◀ Архив",callback_data:`cfe:archive:${r.chat_id}:${page}`},{text:"▣ Картотека",callback_data:"cf:menu"}]);
  await sendScreen(env,ctx,viewer,out.trim(),cleanup,{inline:ik(rows)});
}
async function listAnomalies(env, ctx, viewer, owner, mode="created", page=0, cleanup=[]){
  const p=await profile(env,owner); let r,total,out;
  if(mode==="found"){
    r=await env.DB.prepare(`SELECT f.created_at,a.id,a.title,a.value_points,f.lat,f.lon FROM anomaly_findings f JOIN anomalies a ON a.id=f.anomaly_id WHERE f.finder_chat_id=? ORDER BY f.created_at DESC LIMIT ? OFFSET ?`).bind(String(owner),PAGE,page*PAGE).all();
    total=await env.DB.prepare(`SELECT COUNT(*) c FROM anomaly_findings WHERE finder_chat_id=?`).bind(String(owner)).first();
    out=`<b>△ Обнаруженные аномалии</b>\n${p?.callsign?`<i>${esc(p.callsign)}</i>\n`:""}Всего обнаружений: <b>${Number(total?.c||0)}</b>\n\n`;
  } else {
    r=await env.DB.prepare(`SELECT id,title,value_points FROM anomalies WHERE created_by_chat_id=? ORDER BY value_points DESC,title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(String(owner),PAGE,page*PAGE).all();
    total=await env.DB.prepare(`SELECT COUNT(*) c FROM anomalies WHERE created_by_chat_id=?`).bind(String(owner)).first();
    out=`<b>△ Выявленные аномалии</b>\n${p?.callsign?`<i>${esc(p.callsign)}</i>\n`:""}Всего: <b>${Number(total?.c||0)}</b>\n\n`;
  }
  const rows=r.results||[]; rows.forEach((x,i)=>out+=`<b>${page*PAGE+i+1}.</b> ${esc(x.title)} · ценность ${x.value_points}${mode==="found"?`\n<code>${x.lat}, ${x.lon}</code>`:""}\n`); if(!rows.length)out+="Записей нет.";
  const buttons=[]; if(rows.length)buttons.push(rows.slice(0,5).map((x,i)=>({text:String(i+1),callback_data:`cf:anom:card:${x.id}`}))); if(rows.length>5)buttons.push(rows.slice(5,10).map((x,i)=>({text:String(i+6),callback_data:`cf:anom:card:${x.id}`})));
  const nav=[]; const c=Number(total?.c||0); if(page>0)nav.push({text:"◀",callback_data:`cfe:anom:${owner}:${mode}:${page-1}`}); if((page+1)*PAGE<c)nav.push({text:"▶",callback_data:`cfe:anom:${owner}:${mode}:${page+1}`}); if(nav.length)buttons.push(nav);
  buttons.push([{text:"☾ Досье",callback_data:String(owner)===String(viewer)?"cfe:me":`cfe:op:${owner}`}]);
  await sendScreen(env,ctx,viewer,out.trim(),cleanup,{inline:ik(buttons)});
}
async function listResearches(env, ctx, viewer, owner, page=0, cleanup=[]){
  const p=await profile(env,owner), r=await env.DB.prepare(`SELECT id,title,value_points FROM researches WHERE created_by_chat_id=? ORDER BY value_points DESC,created_at DESC LIMIT ? OFFSET ?`).bind(String(owner),PAGE,page*PAGE).all(), total=await env.DB.prepare(`SELECT COUNT(*) c FROM researches WHERE created_by_chat_id=?`).bind(String(owner)).first();
  let out=`<b>⌬ Исследования оператора</b>\n${p?.callsign?`<i>${esc(p.callsign)}</i>\n`:""}Всего: <b>${Number(total?.c||0)}</b>\n\n`; const rows=r.results||[]; rows.forEach((x,i)=>out+=`<b>${page*PAGE+i+1}.</b> ${esc(x.title)} · ценность ${x.value_points}\n`); if(!rows.length)out+="Записей нет.";
  const buttons=[]; if(rows.length)buttons.push(rows.slice(0,5).map((x,i)=>({text:String(i+1),callback_data:`cf:res:card:${x.id}:all:0`}))); if(rows.length>5)buttons.push(rows.slice(5,10).map((x,i)=>({text:String(i+6),callback_data:`cf:res:card:${x.id}:all:0`})));
  const nav=[]; const c=Number(total?.c||0); if(page>0)nav.push({text:"◀",callback_data:`cfe:res:${owner}:${page-1}`}); if((page+1)*PAGE<c)nav.push({text:"▶",callback_data:`cfe:res:${owner}:${page+1}`}); if(nav.length)buttons.push(nav);
  buttons.push([{text:"☾ Досье",callback_data:String(owner)===String(viewer)?"cfe:me":`cfe:op:${owner}`}]);
  await sendScreen(env,ctx,viewer,out.trim(),cleanup,{inline:ik(buttons)});
}
async function listNotes(env, ctx, chatId, page=0, cleanup=[]){
  const r=await env.DB.prepare(`SELECT * FROM card_notes WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(String(chatId),PAGE,page*PAGE).all(), total=await env.DB.prepare(`SELECT COUNT(*) c FROM card_notes WHERE chat_id=?`).bind(String(chatId)).first();
  let out=`<b>≡ Заметки досье</b>\nВсего: <b>${Number(total?.c||0)}</b>\n\n`; const rows=r.results||[]; rows.forEach((x,i)=>out+=`<b>${page*PAGE+i+1}.</b> ${esc(x.title)}\n${esc(trim(x.body,90))}${x.body.length>90?"…":""}\n\n`); if(!rows.length)out+="Заметок нет.";
  const buttons=[]; const nav=[]; const c=Number(total?.c||0); if(page>0)nav.push({text:"◀",callback_data:`cfe:notes:${page-1}`}); if((page+1)*PAGE<c)nav.push({text:"▶",callback_data:`cfe:notes:${page+1}`}); if(nav.length)buttons.push(nav); buttons.push([{text:"＋ Заметка",callback_data:"cf:note:new"},{text:"☾ Досье",callback_data:"cfe:me"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(buttons)});
}

async function startResearchFromTrace(env, ctx, chatId, routeId){
  await flowSet(env,chatId,"cfe_res_title",{route_id:routeId});
  await sendScreen(env,ctx,chatId,"<b>Новое исследование по следу</b>\n\nУкажи название исследования.",[],{inline:ik([[{text:"◀ След",callback_data:`cfe:trace:${routeId}:0`}]])});
}
async function handleResearchFromTraceFlow(env, ctx, chatId, m, flow, cleanup){
  const text=msgText(m);
  if(flow.mode==="cfe_res_title"){
    const title=trim(text,120); if(!title||hasLink(title)){await sendScreen(env,ctx,chatId,"<b>Название не принято.</b>\n\nДо 120 символов, без ссылок.",cleanup);return true;}
    await flowSet(env,chatId,"cfe_res_body",{...flow.payload,title}); await sendScreen(env,ctx,chatId,"<b>Текст исследования</b>\n\nДо 2048 символов, без ссылок.",cleanup); return true;
  }
  if(flow.mode==="cfe_res_body"){
    const body=trim(text,2048); if(!body||hasLink(body)){await sendScreen(env,ctx,chatId,"<b>Текст не принят.</b>\n\nДо 2048 символов, без ссылок.",cleanup);return true;}
    await flowSet(env,chatId,"cfe_res_value",{...flow.payload,body}); await sendScreen(env,ctx,chatId,"<b>Ценность исследования</b>\n\nУкажи число от 0 до 100.",cleanup); return true;
  }
  if(flow.mode==="cfe_res_value"){
    const value=parseValue(text); if(value===null){await sendScreen(env,ctx,chatId,"<b>Ценность не принята.</b>\n\nНужно число от 0 до 100.",cleanup);return true;}
    const id=uid(); await env.DB.prepare(`INSERT INTO researches(id,title,body,value_points,created_by_chat_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(id,flow.payload.title,flow.payload.body,value,String(chatId),now(),now()).run();
    await env.DB.prepare(`INSERT INTO research_links(id,research_id,link_type,link_id,position,created_at) VALUES(?,?,'trace',?,1,?)`).bind(uid(),id,flow.payload.route_id,now()).run();
    await flowClear(env,chatId); await sendScreen(env,ctx,chatId,"<b>Исследование создано.</b>\n\nСлед автоматически добавлен как приложение.",cleanup,{inline:ik([[{text:"⌬ Карточка",callback_data:`cf:res:card:${id}:all:0`}],[{text:"‡ След",callback_data:`cfe:trace:${flow.payload.route_id}:0`}]])}); return true;
  }
  return false;
}

async function handleCallback(cb, env, ctx){
  const data=cb.data||"";
  if(data.startsWith("op:")){
    await ensureSchema(env); await tg(env,"answerCallbackQuery",{callback_query_id:cb.id}); const p=data.split(":"), viewer=String(cb.message.chat.id); await showOperatorDossier(env,ctx,viewer,p[1]); return true;
  }
  if(data.startsWith("tr:")){
    await ensureSchema(env); await tg(env,"answerCallbackQuery",{callback_query_id:cb.id}); const p=data.split(":"), viewer=String(cb.message.chat.id); await showTrace(env,ctx,viewer,p[1],Number(p[2]||0)); return true;
  }
  if(!data.startsWith("cfe:"))return false;
  await ensureSchema(env); await tg(env,"answerCallbackQuery",{callback_query_id:cb.id}); const chatId=String(cb.message.chat.id), p=data.split(":"), act=p[1];
  if(act==="me"){await showSelfDossier(env,ctx,chatId);return true;}
  if(act==="op"){await showOperatorDossier(env,ctx,chatId,p[2]);return true;}
  if(act==="archive"){await showArchive(env,ctx,chatId,p[2],Number(p[3]||0));return true;}
  if(act==="trace"){await showTrace(env,ctx,chatId,p[2],Number(p[3]||0));return true;}
  if(act==="anom"){await listAnomalies(env,ctx,chatId,p[2],p[3]||"created",Number(p[4]||0));return true;}
  if(act==="res"){await listResearches(env,ctx,chatId,p[2],Number(p[3]||0));return true;}
  if(act==="notes"){await listNotes(env,ctx,chatId,Number(p[2]||0));return true;}
  if(act==="resfromtrace"){await startResearchFromTrace(env,ctx,chatId,p[2]);return true;}
  return false;
}
async function handleMessage(update, env, ctx){
  const m=update.message||update.edited_message; if(!m?.chat?.id)return false;
  await ensureSchema(env); const chatId=String(m.chat.id), incoming=m.message_id?Number(m.message_id):null; if(incoming)await remember(env,chatId,incoming,"user"); const cleanup=incoming?[incoming]:[];
  const flow=await flowGet(env,chatId); if(flow.mode?.startsWith("cfe_res_"))return await handleResearchFromTraceFlow(env,ctx,chatId,m,flow,cleanup);
  const low=msgText(m).toLowerCase();
  if(low.startsWith("/profile")||low.includes("досье")||low.includes("профиль")){await flowClear(env,chatId);await showSelfDossier(env,ctx,chatId,cleanup);return true;}
  if(low.startsWith("/history")||low.includes("архив")||low.includes("история")){await flowClear(env,chatId);await showArchive(env,ctx,chatId,chatId,0,cleanup);return true;}
  return false;
}
async function handleUpdate(update, env, ctx){ if(update.callback_query)return await handleCallback(update.callback_query,env,ctx); return await handleMessage(update,env,ctx); }

export default {
  async fetch(request, env, ctx){
    const url=new URL(request.url);
    if(url.pathname==="/"){
      let database="missing"; try{if(env.DB){await ensureSchema(env);await env.DB.prepare("SELECT 1 AS ok").first();database="D1 ready";}}catch{database="D1 error";}
      return Response.json({service:"WanderOS",status:"ok",runtime:"Cloudflare Workers",database,modules:["cardfile-dossier-integration","operator-cardfile-profile","archive-trace-actions","research-from-trace","legacy-worker-delegation"]});
    }
    if(url.pathname!=="/webhook")return priorWorker.fetch(request,env,ctx);
    if(request.method!=="POST")return new Response("method not allowed",{status:405});
    const clone=request.clone(); let update; try{update=await clone.json();}catch{return priorWorker.fetch(request,env,ctx);}
    const handled=await handleUpdate(update,env,ctx);
    if(handled)return new Response("ok",{status:200});
    return priorWorker.fetch(request,env,ctx);
  }
};

