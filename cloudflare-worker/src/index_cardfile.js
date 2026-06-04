import oldWorker from "./index.js";

const PAGE = 10;
const now = () => new Date().toISOString();
const esc = v => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const trim = (v,n) => String(v || "").trim().slice(0,n);
const hasLink = t => /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.ru\b|\.com\b|\.net\b|\.org\b)/i.test(String(t || ""));
const point = (lat, lon) => ({ lat: Number(Number(lat).toFixed(6)), lon: Number(Number(lon).toFixed(6)) });
const hasHome = p => p && typeof p.base_lat === "number" && typeof p.base_lon === "number";
const dist = (a,b) => { const R=6371000,la=a.lat*Math.PI/180,lb=b.lat*Math.PI/180,dx=(b.lat-a.lat)*Math.PI/180,dy=(b.lon-a.lon)*Math.PI/180,h=Math.sin(dx/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin(dy/2)**2; return Math.round(R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))); };
const ik = rows => ({ inline_keyboard: rows });
const msgText = m => m?.text ? m.text.trim() : "";

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
  const r = await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  let j; try{ j = await r.json(); }catch{ j = {ok:false, description:"bad json"}; }
  if(!r.ok || j.ok !== true) console.error("Telegram API failed", method, r.status, JSON.stringify(j));
  return j;
}
async function delMsg(env,chatId,id){ if(!id)return; try{ await tg(env,"deleteMessage",{chat_id:chatId,message_id:Number(id)}); }catch{} }
async function getUi(env,chatId){ return await env.DB.prepare(`SELECT active_message_id FROM ui_state WHERE chat_id=?`).bind(String(chatId)).first(); }
async function setUi(env,chatId,id){ await env.DB.prepare(`INSERT INTO ui_state(chat_id,active_message_id,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET active_message_id=excluded.active_message_id,updated_at=excluded.updated_at`).bind(String(chatId),Number(id),now()).run(); }
async function remember(env,chatId,id,dir){ if(!id)return; try{ await env.DB.prepare(`INSERT OR IGNORE INTO ui_messages(chat_id,message_id,direction,created_at) VALUES(?,?,?,?)`).bind(String(chatId),Number(id),dir,now()).run(); }catch{} }
async function prune(env,chatId,keep){ try{ await env.DB.prepare(`DELETE FROM ui_messages WHERE chat_id=? AND message_id<>?`).bind(String(chatId),Number(keep||0)).run(); }catch{} }
async function sendScreen(env,ctx,chatId,text,cleanup=[],opt={}){
  const ui=await getUi(env,chatId), old=ui?.active_message_id?Number(ui.active_message_id):null;
  const sent = await tg(env,"sendMessage",{chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true,reply_markup:opt.inline||replyKeyboard()});
  if(sent.ok && sent.result?.message_id){
    const id=Number(sent.result.message_id); await setUi(env,chatId,id); await remember(env,chatId,id,"bot");
    ctx.waitUntil((async()=>{ for(const mid of [...new Set(cleanup.concat(old||[]).filter(Boolean).map(Number))]) await delMsg(env,chatId,mid); await prune(env,chatId,id); })());
  }
}

async function ensureCardfileSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomalies (id TEXT PRIMARY KEY,title TEXT NOT NULL COLLATE NOCASE UNIQUE,description TEXT,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_route_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomaly_findings (id TEXT PRIMARY KEY,anomaly_id TEXT NOT NULL,route_id TEXT NOT NULL,finder_chat_id TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,created_at TEXT NOT NULL,UNIQUE(anomaly_id,route_id,finder_chat_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomaly_media (id TEXT PRIMARY KEY,anomaly_id TEXT NOT NULL,media_type TEXT NOT NULL,file_id TEXT NOT NULL,duration INTEGER,position INTEGER NOT NULL,created_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS researches (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS research_links (id TEXT PRIMARY KEY,research_id TEXT NOT NULL,link_type TEXT NOT NULL CHECK(link_type IN ('trace','anomaly')),link_id TEXT NOT NULL,position INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(research_id,link_type,link_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS research_media (id TEXT PRIMARY KEY,research_id TEXT NOT NULL,media_type TEXT NOT NULL,file_id TEXT NOT NULL,duration INTEGER,position INTEGER NOT NULL,created_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS card_notes (id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_reviews (entity_type TEXT NOT NULL CHECK(entity_type IN ('anomaly','research')),entity_id TEXT NOT NULL,reviewer_chat_id TEXT NOT NULL,vote INTEGER NOT NULL CHECK(vote IN (-1,1)),created_at TEXT NOT NULL,PRIMARY KEY(entity_type,entity_id,reviewer_chat_id))`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_anomalies_title ON anomalies(title COLLATE NOCASE)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_anomaly_findings_geo ON anomaly_findings(lat,lon)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_researches_title ON researches(title COLLATE NOCASE)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_card_notes_chat ON card_notes(chat_id,created_at DESC)`).run();
}
async function flowSet(env,chatId,mode,payload={}){ await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET mode=excluded.mode,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).bind(String(chatId),mode,JSON.stringify(payload),now()).run(); }
async function flowGet(env,chatId){ const r=await env.DB.prepare(`SELECT mode,payload_json FROM flow_state WHERE chat_id=?`).bind(String(chatId)).first(); if(!r)return{mode:null,payload:{}}; let p={}; try{p=r.payload_json?JSON.parse(r.payload_json):{};}catch{} return{mode:r.mode,payload:p}; }
async function flowClear(env,chatId){ await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,NULL,NULL,?) ON CONFLICT(chat_id) DO UPDATE SET mode=NULL,payload_json=NULL,updated_at=excluded.updated_at`).bind(String(chatId),now()).run(); }
async function profile(env,chatId){ return await env.DB.prepare(`SELECT u.chat_id,u.username,u.first_name,p.base_lat,p.base_lon,p.radius_m,op.callsign FROM users u JOIN profiles p ON p.chat_id=u.chat_id LEFT JOIN operator_profiles op ON op.chat_id=u.chat_id WHERE u.chat_id=?`).bind(String(chatId)).first(); }
async function callsign(env,chatId){ const r=await env.DB.prepare(`SELECT callsign FROM operator_profiles WHERE chat_id=?`).bind(String(chatId)).first(); return r?.callsign || "оператор"; }
async function entityRating(env,type,id){ const r=await env.DB.prepare(`SELECT COALESCE(SUM(vote),0) rating, SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) minus FROM entity_reviews WHERE entity_type=? AND entity_id=?`).bind(type,id).first(); return {rating:Number(r?.rating||0),plus:Number(r?.plus||0),minus:Number(r?.minus||0)}; }
function ratingText(r){ return `${r.rating>=0?"+":""}${r.rating} (${r.plus}+/ ${r.minus}-)`; }

function mainMenuText(){ return `<b>WanderOS</b>\n<i>полевой терминал бюро</i>\n\n⌂ <b>Штаб</b> — база операций\n◌ <b>Сигнал</b> — метка рядом со штабом\n⟡ <b>Выход</b> — путь до сигнала\n⊕ <b>Оперативники</b> — каталог сотрудников\n▣ <b>Картотека</b> — аномалии, исследования, заметки\n⚭ <b>Кооперация</b> — совместные выходы\n☾ <b>Досье</b> — профиль оператора\n‡ <b>Архив</b> — следы`; }
function cardfileText(){ return `<b>▣ Картотека бюро</b>\n\nРазделы картотеки:\n\n△ <b>Аномалии</b> — выявленные и повторно обнаруженные объекты.\n⌬ <b>Исследования</b> — расширенные материалы по следам и аномалиям.\n≡ <b>Заметки</b> — личные записи оператора.`; }
function sectionMenuText(kind,total){ const title = kind==="anom"?"△ Аномалии":kind==="res"?"⌬ Исследования":"≡ Заметки"; return `<b>${title}</b>\n\nЗаписей в разделе: <b>${total}</b>\n\nВыбери вкладку.`; }

async function showMain(env,ctx,chatId,cleanup=[]){ await flowClear(env,chatId); await sendScreen(env,ctx,chatId,mainMenuText(),cleanup); }
async function showCardfile(env,ctx,chatId,cleanup=[]){ await flowClear(env,chatId); await sendScreen(env,ctx,chatId,cardfileText(),cleanup,{inline:ik([[{text:"△ Аномалии",callback_data:"cf:anom:menu"},{text:"⌬ Исследования",callback_data:"cf:res:menu"}],[{text:"≡ Заметки",callback_data:"cf:note:menu"}],[{text:"⌂ Терминал",callback_data:"cf:main"}]])}); }
async function countTable(env,table,where="",bind=[]){ const stmt=env.DB.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`); const r=bind.length?await stmt.bind(...bind).first():await stmt.first(); return Number(r?.total||0); }
async function showSectionMenu(env,ctx,chatId,kind,cleanup=[]){ const table=kind==="anom"?"anomalies":kind==="res"?"researches":"card_notes"; const total=kind==="note"?await countTable(env,table,"WHERE chat_id=?",[String(chatId)]):await countTable(env,table); const rows = kind==="note" ? [[{text:"Мои заметки",callback_data:"cf:note:list:0"},{text:"Создать",callback_data:"cf:note:new"}],[{text:"Поиск",callback_data:"cf:note:search"}],[{text:"◀ Картотека",callback_data:"cf:menu"}]] : [[{text:"В радиусе",callback_data:`cf:${kind}:near:0`},{text:"Все по ценности",callback_data:`cf:${kind}:all:0`}],[{text:"Поиск",callback_data:`cf:${kind}:search`}],[{text:"◀ Картотека",callback_data:"cf:menu"}]]; await sendScreen(env,ctx,chatId,sectionMenuText(kind,total),cleanup,{inline:ik(rows)}); }

async function showAnomaliesAll(env,ctx,chatId,page=0,cleanup=[]){
  const r=await env.DB.prepare(`SELECT a.*,op.callsign FROM anomalies a LEFT JOIN operator_profiles op ON op.chat_id=a.created_by_chat_id ORDER BY a.value_points DESC, a.title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(PAGE,page*PAGE).all();
  const total=await countTable(env,"anomalies"); let out=`<b>△ Аномалии по ценности</b>\nВсего: <b>${total}</b>\n\n`;
  const items=[]; for(const a of r.results||[]){ const rt=await entityRating(env,"anomaly",a.id); items.push(a); out+=`<b>${page*PAGE+items.length}.</b> ${esc(a.title)} · ценность ${a.value_points} · ${ratingText(rt)}\nВыявил: ${esc(a.callsign||"оператор")}\n`; }
  if(!items.length) out += "Записей нет.";
  const rows=[]; if(items.length) rows.push(items.slice(0,5).map((a,i)=>({text:String(i+1),callback_data:`cf:anom:card:${a.id}:all:${page}`}))); if(items.length>5) rows.push(items.slice(5,10).map((a,i)=>({text:String(i+6),callback_data:`cf:anom:card:${a.id}:all:${page}`}))); const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:anom:all:${page-1}`}); if((page+1)*PAGE<total)nav.push({text:"▶",callback_data:`cf:anom:all:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)});
}
async function showAnomaliesNear(env,ctx,chatId,page=0,cleanup=[]){
  const p=await profile(env,chatId); if(!hasHome(p)){ await sendScreen(env,ctx,chatId,"<b>Штаб не установлен.</b>\n\nДля радиуса аномалий нужен штаб.",cleanup,{inline:ik([[{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]])}); return; }
  const home=point(p.base_lat,p.base_lon), radius=Number(p.radius_m||1200);
  const q=await env.DB.prepare(`SELECT f.*,a.title,a.value_points,op.callsign FROM anomaly_findings f JOIN anomalies a ON a.id=f.anomaly_id LEFT JOIN operator_profiles op ON op.chat_id=f.finder_chat_id LIMIT 500`).all();
  const all=(q.results||[]).map(x=>({...x,distance_m:dist(home,point(x.lat,x.lon))})).filter(x=>x.distance_m<=radius).sort((a,b)=>a.distance_m-b.distance_m);
  const items=all.slice(page*PAGE,page*PAGE+PAGE); let out=`<b>△ Аномалии в радиусе</b>\nРадиус: <b>${radius} м</b>\nНайдено обнаружений: <b>${all.length}</b>\n\n`;
  items.forEach((x,i)=>{out+=`<b>${page*PAGE+i+1}.</b> ${esc(x.title)} · ${x.distance_m} м\nКоординаты: <code>${x.lat}, ${x.lon}</code>\nОбнаружил: ${esc(x.callsign||"оператор")}\n\n`;}); if(!items.length)out+="Обнаружений в радиусе нет.";
  const rows=[]; const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:anom:near:${page-1}`}); if((page+1)*PAGE<all.length)nav.push({text:"▶",callback_data:`cf:anom:near:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)});
}
async function showResearchAll(env,ctx,chatId,page=0,cleanup=[]){
  const r=await env.DB.prepare(`SELECT rs.*,op.callsign FROM researches rs LEFT JOIN operator_profiles op ON op.chat_id=rs.created_by_chat_id ORDER BY rs.value_points DESC, rs.created_at DESC LIMIT ? OFFSET ?`).bind(PAGE,page*PAGE).all();
  const total=await countTable(env,"researches"); let out=`<b>⌬ Исследования по ценности</b>\nВсего: <b>${total}</b>\n\n`;
  const items=[]; for(const it of r.results||[]){const rt=await entityRating(env,"research",it.id);items.push(it);out+=`<b>${page*PAGE+items.length}.</b> ${esc(it.title)} · ценность ${it.value_points} · ${ratingText(rt)}\nАвтор: ${esc(it.callsign||"оператор")}\n`;}
  if(!items.length)out+="Записей нет."; const rows=[]; if(items.length)rows.push(items.slice(0,5).map((x,i)=>({text:String(i+1),callback_data:`cf:res:card:${x.id}:all:${page}`}))); if(items.length>5)rows.push(items.slice(5,10).map((x,i)=>({text:String(i+6),callback_data:`cf:res:card:${x.id}:all:${page}`}))); const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:res:all:${page-1}`}); if((page+1)*PAGE<total)nav.push({text:"▶",callback_data:`cf:res:all:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"◀ Исследования",callback_data:"cf:res:menu"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)});
}
async function showNotes(env,ctx,chatId,page=0,cleanup=[]){ const r=await env.DB.prepare(`SELECT * FROM card_notes WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(String(chatId),PAGE,page*PAGE).all(); const total=await countTable(env,"card_notes","WHERE chat_id=?",[String(chatId)]); let out=`<b>≡ Мои заметки</b>\nВсего: <b>${total}</b>\n\n`; const items=r.results||[]; items.forEach((n,i)=>out+=`<b>${page*PAGE+i+1}.</b> ${esc(n.title)}\n${esc(trim(n.body,90))}${n.body.length>90?"…":""}\n\n`); if(!items.length)out+="Заметок нет."; const rows=[]; if(items.length)rows.push(items.slice(0,5).map((n,i)=>({text:String(i+1),callback_data:`cf:note:card:${n.id}:${page}`}))); if(items.length>5)rows.push(items.slice(5,10).map((n,i)=>({text:String(i+6),callback_data:`cf:note:card:${n.id}:${page}`}))); const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:note:list:${page-1}`}); if((page+1)*PAGE<total)nav.push({text:"▶",callback_data:`cf:note:list:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"Создать",callback_data:"cf:note:new"},{text:"◀ Заметки",callback_data:"cf:note:menu"}]); await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)}); }
async function showNoteCard(env,ctx,chatId,id,page=0,cleanup=[]){ const n=await env.DB.prepare(`SELECT * FROM card_notes WHERE id=? AND chat_id=?`).bind(id,String(chatId)).first(); if(!n){await showNotes(env,ctx,chatId,page,cleanup);return;} await sendScreen(env,ctx,chatId,`<b>≡ Заметка: ${esc(n.title)}</b>\n\n${esc(n.body)}`,cleanup,{inline:ik([[{text:"◀ Мои заметки",callback_data:`cf:note:list:${page}`}],[{text:"⌂ Терминал",callback_data:"cf:main"}]])}); }
async function searchPrompt(env,ctx,chatId,kind,cleanup=[]){ await flowSet(env,chatId,`cf_search_${kind}`,{}); const label=kind==="anom"?"аномалии":kind==="res"?"исследования":"заметки"; await sendScreen(env,ctx,chatId,`<b>Поиск ${label}</b>\n\nНапиши название или его часть.`,cleanup,{inline:ik([[{text:"◀ Картотека",callback_data:"cf:menu"}]])}); }
async function searchResults(env,ctx,chatId,kind,q,cleanup=[]){ const s=trim(q,64); if(!s){await searchPrompt(env,ctx,chatId,kind,cleanup);return;} let rows=[], out=""; if(kind==="anom"){const r=await env.DB.prepare(`SELECT * FROM anomalies WHERE title LIKE ? COLLATE NOCASE ORDER BY title LIMIT 10`).bind("%"+s+"%").all(); const items=r.results||[]; out=`<b>Поиск аномалии</b>\nЗапрос: <code>${esc(s)}</code>\n\n`; items.forEach((x,i)=>out+=`<b>${i+1}.</b> ${esc(x.title)} · ценность ${x.value_points}\n`); if(items.length)rows.push(items.map((x,i)=>({text:String(i+1),callback_data:`cf:anom:card:${x.id}:search:0`}))); if(!items.length)out+="Ничего не найдено.";} else if(kind==="res"){const r=await env.DB.prepare(`SELECT * FROM researches WHERE title LIKE ? COLLATE NOCASE ORDER BY title LIMIT 10`).bind("%"+s+"%").all(); const items=r.results||[]; out=`<b>Поиск исследования</b>\nЗапрос: <code>${esc(s)}</code>\n\n`; items.forEach((x,i)=>out+=`<b>${i+1}.</b> ${esc(x.title)} · ценность ${x.value_points}\n`); if(items.length)rows.push(items.map((x,i)=>({text:String(i+1),callback_data:`cf:res:card:${x.id}:search:0`}))); if(!items.length)out+="Ничего не найдено.";} else {const r=await env.DB.prepare(`SELECT * FROM card_notes WHERE chat_id=? AND title LIKE ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 10`).bind(String(chatId),"%"+s+"%").all(); const items=r.results||[]; out=`<b>Поиск заметки</b>\nЗапрос: <code>${esc(s)}</code>\n\n`; items.forEach((x,i)=>out+=`<b>${i+1}.</b> ${esc(x.title)}\n`); if(items.length)rows.push(items.map((x,i)=>({text:String(i+1),callback_data:`cf:note:card:${x.id}:0`}))); if(!items.length)out+="Ничего не найдено.";} rows.push([{text:"Новый поиск",callback_data:`cf:${kind}:search`},{text:"◀ Картотека",callback_data:"cf:menu"}]); await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)}); }

async function handleCardfileFlow(env,ctx,chatId,m,flow,cleanup){ const text=msgText(m); if(flow.mode==="cf_note_title"){const title=trim(text,80); if(!title||hasLink(title)){await sendScreen(env,ctx,chatId,"<b>Заголовок не принят.</b>\n\nКоротко, без ссылок.",cleanup);return true;} await flowSet(env,chatId,"cf_note_body",{title}); await sendScreen(env,ctx,chatId,"<b>Текст заметки</b>\n\nДо 2048 символов, без ссылок.",cleanup); return true;} if(flow.mode==="cf_note_body"){const body=trim(text,2048); if(!body||hasLink(body)){await sendScreen(env,ctx,chatId,"<b>Заметка не принята.</b>\n\nДо 2048 символов, без ссылок.",cleanup);return true;} const id=crypto.randomUUID(); await env.DB.prepare(`INSERT INTO card_notes(id,chat_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(id,String(chatId),flow.payload.title,body,now(),now()).run(); await flowClear(env,chatId); await showNoteCard(env,ctx,chatId,id,0,cleanup); return true;} if(flow.mode==="cf_search_anom"||flow.mode==="cf_search_res"||flow.mode==="cf_search_note"){const kind=flow.mode.replace("cf_search_",""); await flowClear(env,chatId); await searchResults(env,ctx,chatId,kind,text,cleanup); return true;} return false; }

function isCardfileCommand(text){ const low=text.toLowerCase(); return low.startsWith("/cardfile")||low.startsWith("/kartoteka")||low.includes("картотека")||low.includes("аномалии")||low.includes("исследования")||low.includes("заметки"); }
async function handleUpdate(update,env,ctx,cleanup=[]){
  await ensureCardfileSchema(env);
  if(update.callback_query){ const cb=update.callback_query; await tg(env,"answerCallbackQuery",{callback_query_id:cb.id}); const chatId=String(cb.message.chat.id), data=cb.data||""; if(!data.startsWith("cf:")) return false; if(data==="cf:main"){await showMain(env,ctx,chatId);return true;} if(data==="cf:menu"){await showCardfile(env,ctx,chatId);return true;} const p=data.split(":"); const kind=p[1], act=p[2]; if(act==="menu"){await showSectionMenu(env,ctx,chatId,kind);return true;} if(kind==="anom"&&act==="all"){await showAnomaliesAll(env,ctx,chatId,Number(p[3]||0));return true;} if(kind==="anom"&&act==="near"){await showAnomaliesNear(env,ctx,chatId,Number(p[3]||0));return true;} if(kind==="res"&&act==="all"){await showResearchAll(env,ctx,chatId,Number(p[3]||0));return true;} if(kind==="res"&&act==="near"){await sendScreen(env,ctx,chatId,"<b>⌬ Исследования в радиусе</b>\n\nГео-вывод исследований будет включён на следующем этапе: через связанные следы и аномалии.",[],{inline:ik([[{text:"◀ Исследования",callback_data:"cf:res:menu"}]])});return true;} if(act==="search"){await searchPrompt(env,ctx,chatId,kind);return true;} if(kind==="note"&&act==="list"){await showNotes(env,ctx,chatId,Number(p[3]||0));return true;} if(kind==="note"&&act==="new"){await flowSet(env,chatId,"cf_note_title",{});await sendScreen(env,ctx,chatId,"<b>Новая заметка</b>\n\nОтправь заголовок.");return true;} if(kind==="note"&&act==="card"){await showNoteCard(env,ctx,chatId,p[3],Number(p[4]||0));return true;} await showCardfile(env,ctx,chatId); return true; }
  const m=update.message||update.edited_message; if(!m?.chat?.id)return false; const chatId=String(m.chat.id), incoming=m.message_id?Number(m.message_id):null; if(incoming)await remember(env,chatId,incoming,"user"); const localCleanup=incoming?[incoming]:[]; const text=msgText(m);
  const flow=await flowGet(env,chatId); if(flow.mode?.startsWith("cf_")){return await handleCardfileFlow(env,ctx,chatId,m,flow,localCleanup);}
  const low=text.toLowerCase(); if(low.startsWith("/start")||low.startsWith("/menu")||low.startsWith("/help")||low.includes("терминал")){await showMain(env,ctx,chatId,localCleanup);return true;}
  if(isCardfileCommand(text)){await showCardfile(env,ctx,chatId,localCleanup);return true;}
  return false;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if(url.pathname === "/"){
      let database="missing"; try{ if(env.DB){ await ensureCardfileSchema(env); await env.DB.prepare("SELECT 1 AS ok").first(); database="D1 ready"; } }catch{ database="D1 error"; }
      return Response.json({service:"WanderOS",status:"ok",runtime:"Cloudflare Workers",database,modules:["cardfile-wrapper","anomalies-menu","research-menu","notes-basic", "legacy-worker-delegation"]});
    }
    if(url.pathname !== "/webhook") return oldWorker.fetch(request,env,ctx);
    if(request.method !== "POST") return new Response("method not allowed",{status:405});
    const clone = request.clone();
    let update; try{ update = await clone.json(); }catch{ return oldWorker.fetch(request,env,ctx); }
    const handled = await handleUpdate(update,env,ctx);
    if(handled) return new Response("ok",{status:200});
    return oldWorker.fetch(request,env,ctx);
  }
};
