const PAGE = 10;
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const esc = v => String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const trim = (v,n) => String(v || "").trim().slice(0,n);
const hasLink = t => /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|\.ru\b|\.com\b|\.net\b|\.org\b)/i.test(String(t || ""));
const point = (lat, lon) => ({ lat: Number(Number(lat).toFixed(6)), lon: Number(Number(lon).toFixed(6)) });
const hasHome = p => p && typeof p.base_lat === "number" && typeof p.base_lon === "number";
const msgText = m => m?.text ? m.text.trim() : "";
const bestPhoto = m => Array.isArray(m?.photo) && m.photo.length ? m.photo[m.photo.length - 1].file_id : null;
const ik = rows => ({ inline_keyboard: rows });
const dist = (a,b) => { const R=6371000,la=a.lat*Math.PI/180,lb=b.lat*Math.PI/180,dx=(b.lat-a.lat)*Math.PI/180,dy=(b.lon-a.lon)*Math.PI/180,h=Math.sin(dx/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin(dy/2)**2; return Math.round(R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))); };

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
  let method = "sendMessage";
  let payload = {chat_id:chatId,text,parse_mode:"HTML",disable_web_page_preview:true,reply_markup:opt.inline||replyKeyboard()};
  if(opt.photo){ method="sendPhoto"; payload={chat_id:chatId,photo:opt.photo,caption:text,parse_mode:"HTML",reply_markup:opt.inline||replyKeyboard()}; }
  if(opt.video){ method="sendVideo"; payload={chat_id:chatId,video:opt.video,caption:text,parse_mode:"HTML",reply_markup:opt.inline||replyKeyboard()}; }
  const sent = await tg(env,method,payload);
  if(sent.ok && sent.result?.message_id){
    const id=Number(sent.result.message_id); await setUi(env,chatId,id); await remember(env,chatId,id,"bot");
    ctx.waitUntil((async()=>{ for(const mid of [...new Set(cleanup.concat(old||[]).filter(Boolean).map(Number))]) await delMsg(env,chatId,mid); await prune(env,chatId,id); })());
  }
}

export async function ensureCardfileSchema(env){
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
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_anomaly_findings_anomaly ON anomaly_findings(anomaly_id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_researches_title ON researches(title COLLATE NOCASE)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_card_notes_chat ON card_notes(chat_id,created_at DESC)`).run();
}

async function flowSet(env,chatId,mode,payload={}){ await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET mode=excluded.mode,payload_json=excluded.payload_json,updated_at=excluded.updated_at`).bind(String(chatId),mode,JSON.stringify(payload),now()).run(); }
async function flowGet(env,chatId){ const r=await env.DB.prepare(`SELECT mode,payload_json FROM flow_state WHERE chat_id=?`).bind(String(chatId)).first(); if(!r)return{mode:null,payload:{}}; let p={}; try{p=r.payload_json?JSON.parse(r.payload_json):{};}catch{} return{mode:r.mode,payload:p}; }
async function flowClear(env,chatId){ await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,NULL,NULL,?) ON CONFLICT(chat_id) DO UPDATE SET mode=NULL,payload_json=NULL,updated_at=excluded.updated_at`).bind(String(chatId),now()).run(); }
async function profile(env,chatId){ return await env.DB.prepare(`SELECT u.chat_id,u.username,u.first_name,p.base_lat,p.base_lon,p.radius_m,op.callsign FROM users u JOIN profiles p ON p.chat_id=u.chat_id LEFT JOIN operator_profiles op ON op.chat_id=u.chat_id WHERE u.chat_id=?`).bind(String(chatId)).first(); }
async function routeById(env,id){ return await env.DB.prepare(`SELECT * FROM routes WHERE id=?`).bind(id).first(); }
async function countTable(env,table,where="",bind=[]){ const stmt=env.DB.prepare(`SELECT COUNT(*) total FROM ${table} ${where}`); const r=bind.length?await stmt.bind(...bind).first():await stmt.first(); return Number(r?.total||0); }
async function entityRating(env,type,id){ const r=await env.DB.prepare(`SELECT COALESCE(SUM(vote),0) rating, SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) minus FROM entity_reviews WHERE entity_type=? AND entity_id=?`).bind(type,id).first(); return {rating:Number(r?.rating||0),plus:Number(r?.plus||0),minus:Number(r?.minus||0)}; }
async function mediaForAnomaly(env,id){ const r=await env.DB.prepare(`SELECT * FROM anomaly_media WHERE anomaly_id=? ORDER BY position ASC`).bind(id).all(); return r.results || []; }
function ratingText(r){ return `${r.rating>=0?"+":""}${r.rating} (${r.plus}+/ ${r.minus}-)`; }

function mainMenuText(){ return `<b>WanderOS</b>\n<i>полевой терминал бюро</i>\n\n⌂ <b>Штаб</b> — база операций\n◌ <b>Сигнал</b> — метка рядом со штабом\n⟡ <b>Выход</b> — путь до сигнала\n⊕ <b>Оперативники</b> — каталог сотрудников\n▣ <b>Картотека</b> — аномалии, исследования, заметки\n⚭ <b>Кооперация</b> — совместные выходы\n☾ <b>Досье</b> — профиль оператора\n‡ <b>Архив</b> — следы`; }
function cardfileText(){ return `<b>▣ Картотека бюро</b>\n\n△ <b>Аномалии</b> — выявленные и повторно обнаруженные объекты.\n⌬ <b>Исследования</b> — расширенные материалы по следам и аномалиям.\n≡ <b>Заметки</b> — личные записи оператора.`; }
function sectionMenuText(kind,total){ const title = kind==="anom"?"△ Аномалии":kind==="res"?"⌬ Исследования":"≡ Заметки"; return `<b>${title}</b>\n\nЗаписей в разделе: <b>${total}</b>\n\nВыбери вкладку.`; }

async function showMain(env,ctx,chatId,cleanup=[]){ await flowClear(env,chatId); await sendScreen(env,ctx,chatId,mainMenuText(),cleanup); }
async function showCardfile(env,ctx,chatId,cleanup=[]){ await flowClear(env,chatId); await sendScreen(env,ctx,chatId,cardfileText(),cleanup,{inline:ik([[{text:"△ Аномалии",callback_data:"cf:anom:menu"},{text:"⌬ Исследования",callback_data:"cf:res:menu"}],[{text:"≡ Заметки",callback_data:"cf:note:menu"}],[{text:"⌂ Терминал",callback_data:"cf:main"}]])}); }
async function showSectionMenu(env,ctx,chatId,kind,cleanup=[]){
  const table=kind==="anom"?"anomalies":kind==="res"?"researches":"card_notes";
  const total=kind==="note"?await countTable(env,table,"WHERE chat_id=?",[String(chatId)]):await countTable(env,table);
  const rows = kind==="note" ? [[{text:"Мои заметки",callback_data:"cf:note:list:0"},{text:"Создать",callback_data:"cf:note:new"}],[{text:"Поиск",callback_data:"cf:note:search"}],[{text:"◀ Картотека",callback_data:"cf:menu"}]] : kind==="anom" ? [[{text:"В радиусе",callback_data:"cf:anom:near:0"},{text:"Все по ценности",callback_data:"cf:anom:all:0"}],[{text:"Поиск",callback_data:"cf:anom:search"},{text:"＋ Аномалия",callback_data:"cf:anom:new"}],[{text:"◀ Картотека",callback_data:"cf:menu"}]] : [[{text:"В радиусе",callback_data:`cf:${kind}:near:0`},{text:"Все по ценности",callback_data:`cf:${kind}:all:0`}],[{text:"Поиск",callback_data:`cf:${kind}:search`}],[{text:"◀ Картотека",callback_data:"cf:menu"}]];
  await sendScreen(env,ctx,chatId,sectionMenuText(kind,total),cleanup,{inline:ik(rows)});
}

async function ownRoutes(env,chatId){ const r=await env.DB.prepare(`SELECT id,title,target_lat,target_lon,created_at FROM routes WHERE chat_id=? ORDER BY created_at DESC LIMIT 10`).bind(String(chatId)).all(); return r.results || []; }
function routePickerText(routes,mode){ let out = mode==="attach" ? `<b>Выбор следа для обнаружения</b>\n\nВыбери след, в котором аномалия обнаружена повторно.\n\n` : `<b>Регистрация аномалии</b>\n\nСначала выбери след, в котором она обнаружена.\n\n`; routes.forEach((r,i)=>out+=`<b>${i+1}.</b> ${esc(r.title||"след")}\n<code>${r.target_lat}, ${r.target_lon}</code>\n\n`); return out.trim(); }
async function showRoutePicker(env,ctx,chatId,mode,anomalyId=null,cleanup=[]){ const routes=await ownRoutes(env,chatId); if(!routes.length){ await sendScreen(env,ctx,chatId,"<b>Следов нет.</b>\n\nСначала создай ◌ Сигнал или ⟡ Выход, потом регистрируй аномалию.",cleanup,{inline:ik([[{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]])}); return; } const rows=[]; const nums=routes.map((r,i)=>({text:String(i+1),callback_data: mode==="attach" ? `cf:anom:attachpick:${anomalyId}:${r.id}` : `cf:anom:picknew:${r.id}`})); for(let i=0;i<nums.length;i+=5)rows.push(nums.slice(i,i+5)); rows.push([{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]); await sendScreen(env,ctx,chatId,routePickerText(routes,mode),cleanup,{inline:ik(rows)}); }
async function createFinding(env,anomalyId,route,chatId){ const lat=Number(route.target_lat), lon=Number(route.target_lon); try{ await env.DB.prepare(`INSERT INTO anomaly_findings(id,anomaly_id,route_id,finder_chat_id,lat,lon,created_at) VALUES(?,?,?,?,?,?,?)`).bind(uid(),anomalyId,route.id,String(chatId),lat,lon,now()).run(); }catch{} }
async function anomalyByTitle(env,title){ return await env.DB.prepare(`SELECT * FROM anomalies WHERE title=? COLLATE NOCASE LIMIT 1`).bind(title).first(); }

async function showAnomaliesAll(env,ctx,chatId,page=0,cleanup=[]){
  const r=await env.DB.prepare(`SELECT a.*,op.callsign FROM anomalies a LEFT JOIN operator_profiles op ON op.chat_id=a.created_by_chat_id ORDER BY a.value_points DESC, a.title COLLATE NOCASE LIMIT ? OFFSET ?`).bind(PAGE,page*PAGE).all();
  const total=await countTable(env,"anomalies"); let out=`<b>△ Аномалии по ценности</b>\nВсего: <b>${total}</b>\n\n`;
  const items=[]; for(const a of r.results||[]){ const rt=await entityRating(env,"anomaly",a.id); items.push(a); out+=`<b>${page*PAGE+items.length}.</b> ${esc(a.title)} · ценность ${a.value_points} · ${ratingText(rt)}\nВыявил: ${esc(a.callsign||"оператор")}\n`; }
  if(!items.length) out += "Записей нет.";
  const rows=[]; if(items.length) rows.push(items.slice(0,5).map((a,i)=>({text:String(i+1),callback_data:`cf:anom:card:${a.id}:all:${page}:0`}))); if(items.length>5) rows.push(items.slice(5,10).map((a,i)=>({text:String(i+6),callback_data:`cf:anom:card:${a.id}:all:${page}:0`}))); const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:anom:all:${page-1}`}); if((page+1)*PAGE<total)nav.push({text:"▶",callback_data:`cf:anom:all:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"＋ Аномалия",callback_data:"cf:anom:new"},{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)});
}
async function showAnomaliesNear(env,ctx,chatId,page=0,cleanup=[]){
  const p=await profile(env,chatId); if(!hasHome(p)){ await sendScreen(env,ctx,chatId,"<b>Штаб не установлен.</b>\n\nДля радиуса аномалий нужен штаб.",cleanup,{inline:ik([[{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]])}); return; }
  const home=point(p.base_lat,p.base_lon), radius=Number(p.radius_m||1200);
  const q=await env.DB.prepare(`SELECT f.*,a.title,a.value_points,op.callsign FROM anomaly_findings f JOIN anomalies a ON a.id=f.anomaly_id LEFT JOIN operator_profiles op ON op.chat_id=f.finder_chat_id LIMIT 500`).all();
  const all=(q.results||[]).map(x=>({...x,distance_m:dist(home,point(x.lat,x.lon))})).filter(x=>x.distance_m<=radius).sort((a,b)=>a.distance_m-b.distance_m);
  const items=all.slice(page*PAGE,page*PAGE+PAGE); let out=`<b>△ Аномалии в радиусе</b>\nРадиус: <b>${radius} м</b>\nНайдено обнаружений: <b>${all.length}</b>\n\n`;
  items.forEach((x,i)=>{out+=`<b>${page*PAGE+i+1}.</b> ${esc(x.title)} · ${x.distance_m} м\nКоординаты: <code>${x.lat}, ${x.lon}</code>\nОбнаружил: ${esc(x.callsign||"оператор")}\n\n`;}); if(!items.length)out+="Обнаружений в радиусе нет.";
  const rows=[]; const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:anom:near:${page-1}`}); if((page+1)*PAGE<all.length)nav.push({text:"▶",callback_data:`cf:anom:near:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"＋ Аномалия",callback_data:"cf:anom:new"},{text:"◀ Аномалии",callback_data:"cf:anom:menu"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)});
}
async function showAnomalyCard(env,ctx,chatId,id,source="all",page=0,mediaIndex=0,cleanup=[]){
  const a=await env.DB.prepare(`SELECT a.*,op.callsign FROM anomalies a LEFT JOIN operator_profiles op ON op.chat_id=a.created_by_chat_id WHERE a.id=?`).bind(id).first(); if(!a){await showSectionMenu(env,ctx,chatId,"anom",cleanup);return;}
  const rt=await entityRating(env,"anomaly",id); const media=await mediaForAnomaly(env,id); const findings=await countTable(env,"anomaly_findings","WHERE anomaly_id=?",[id]); const res=await countTable(env,"research_links","WHERE link_type='anomaly' AND link_id=?",[id]); const idx=Math.max(0,Math.min(Number(mediaIndex||0),Math.max(0,media.length-1))); const cur=media[idx]||null;
  let out=`<b>△ Аномалия: ${esc(a.title)}</b>\n\nЦенность: <b>${a.value_points}</b>\nРейтинг: <b>${ratingText(rt)}</b>\nВыявил: <b>${esc(a.callsign||"оператор")}</b>\nОбнаружений: <b>${findings}</b>\nВ исследованиях: <b>${res}</b>\n\n${a.description?esc(a.description):"<i>Описание не заполнено.</i>"}`; if(media.length)out+=`\n\nМедиа: ${idx+1}/${media.length}`;
  let back="cf:anom:menu"; if(source==="all")back=`cf:anom:all:${page}`; if(source==="search")back=`cf:anom:search`; const rows=[]; if(media.length>1)rows.push([{text:"◀ Медиа",callback_data:`cf:anom:card:${id}:${source}:${page}:${idx>0?idx-1:media.length-1}`},{text:"▶ Медиа",callback_data:`cf:anom:card:${id}:${source}:${page}:${idx<media.length-1?idx+1:0}`}]); rows.push([{text:"＋ обнаружить в следе",callback_data:`cf:anom:attach:${id}`}]); if(String(a.created_by_chat_id)===String(chatId))rows.push([{text:"＋ Медиа",callback_data:`cf:anom:media:${id}`}]); rows.push([{text:"＋ ценность",callback_data:`cf:rate:anomaly:${id}:1`},{text:"− ценность",callback_data:`cf:rate:anomaly:${id}:-1`}]); rows.push([{text:"◀ Назад",callback_data:back},{text:"⌂ Терминал",callback_data:"cf:main"}]); const opt={inline:ik(rows)}; if(cur?.media_type==="photo")opt.photo=cur.file_id; if(cur?.media_type==="video")opt.video=cur.file_id; await sendScreen(env,ctx,chatId,out,cleanup,opt);
}
async function addAnomalyMedia(env,ctx,chatId,id,m,cleanup=[]){
  const a=await env.DB.prepare(`SELECT * FROM anomalies WHERE id=?`).bind(id).first(); if(!a||String(a.created_by_chat_id)!==String(chatId)){await sendScreen(env,ctx,chatId,"<b>Медиа не принято.</b>\n\nДобавлять медиа может только выявивший оператор.",cleanup);return;}
  const media=await mediaForAnomaly(env,id); const hasVideo=media.some(x=>x.media_type==="video"); const photo=bestPhoto(m); const video=m.video||null;
  if(photo){ if(hasVideo||media.length>=3){await sendScreen(env,ctx,chatId,"<b>Лимит медиа.</b>\n\nДо 3 фото или одно видео.",cleanup);return;} await env.DB.prepare(`INSERT INTO anomaly_media(id,anomaly_id,media_type,file_id,duration,position,created_at) VALUES(?,?,'photo',?,NULL,?,?)`).bind(uid(),id,photo,media.length+1,now()).run(); await flowClear(env,chatId); await showAnomalyCard(env,ctx,chatId,id,"all",0,media.length,cleanup); return; }
  if(video){ if(media.length>0||Number(video.duration||0)>180){await sendScreen(env,ctx,chatId,"<b>Видео не принято.</b>\n\nОдно видео до 3 минут.",cleanup);return;} await env.DB.prepare(`INSERT INTO anomaly_media(id,anomaly_id,media_type,file_id,duration,position,created_at) VALUES(?,?,'video',?,?,1,?)`).bind(uid(),id,video.file_id,Number(video.duration||0),now()).run(); await flowClear(env,chatId); await showAnomalyCard(env,ctx,chatId,id,"all",0,0,cleanup); return; }
  await sendScreen(env,ctx,chatId,"<b>Жду медиа.</b>\n\nФото до 3 штук или одно видео до 3 минут. /skip — завершить.",cleanup);
}
async function rateEntity(env,ctx,chatId,type,id,vote){
  try{ await env.DB.prepare(`INSERT INTO entity_reviews(entity_type,entity_id,reviewer_chat_id,vote,created_at) VALUES(?,?,?,?,?)`).bind(type,id,String(chatId),Number(vote)>0?1:-1,now()).run(); }catch{ await sendScreen(env,ctx,chatId,"<b>Оценка уже учтена.</b>\n\nОдин оператор может оценить карточку только один раз."); return; }
  if(type==="anomaly") await showAnomalyCard(env,ctx,chatId,id,"all",0,0); else await sendScreen(env,ctx,chatId,"<b>Оценка исследования учтена.</b>");
}

async function showResearchAll(env,ctx,chatId,page=0,cleanup=[]){
  const r=await env.DB.prepare(`SELECT rs.*,op.callsign FROM researches rs LEFT JOIN operator_profiles op ON op.chat_id=rs.created_by_chat_id ORDER BY rs.value_points DESC, rs.created_at DESC LIMIT ? OFFSET ?`).bind(PAGE,page*PAGE).all();
  const total=await countTable(env,"researches"); let out=`<b>⌬ Исследования по ценности</b>\nВсего: <b>${total}</b>\n\n`;
  const items=[]; for(const it of r.results||[]){const rt=await entityRating(env,"research",it.id);items.push(it);out+=`<b>${page*PAGE+items.length}.</b> ${esc(it.title)} · ценность ${it.value_points} · ${ratingText(rt)}\nАвтор: ${esc(it.callsign||"оператор")}\n`;}
  if(!items.length)out+="Записей нет."; const rows=[]; const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:res:all:${page-1}`}); if((page+1)*PAGE<total)nav.push({text:"▶",callback_data:`cf:res:all:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"◀ Исследования",callback_data:"cf:res:menu"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)});
}
async function showNotes(env,ctx,chatId,page=0,cleanup=[]){ const r=await env.DB.prepare(`SELECT * FROM card_notes WHERE chat_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(String(chatId),PAGE,page*PAGE).all(); const total=await countTable(env,"card_notes","WHERE chat_id=?",[String(chatId)]); let out=`<b>≡ Мои заметки</b>\nВсего: <b>${total}</b>\n\n`; const items=r.results||[]; items.forEach((n,i)=>out+=`<b>${page*PAGE+i+1}.</b> ${esc(n.title)}\n${esc(trim(n.body,90))}${n.body.length>90?"…":""}\n\n`); if(!items.length)out+="Заметок нет."; const rows=[]; if(items.length)rows.push(items.slice(0,5).map((n,i)=>({text:String(i+1),callback_data:`cf:note:card:${n.id}:${page}`}))); if(items.length>5)rows.push(items.slice(5,10).map((n,i)=>({text:String(i+6),callback_data:`cf:note:card:${n.id}:${page}`}))); const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`cf:note:list:${page-1}`}); if((page+1)*PAGE<total)nav.push({text:"▶",callback_data:`cf:note:list:${page+1}`}); if(nav.length)rows.push(nav); rows.push([{text:"Создать",callback_data:"cf:note:new"},{text:"◀ Заметки",callback_data:"cf:note:menu"}]); await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)}); }
async function showNoteCard(env,ctx,chatId,id,page=0,cleanup=[]){ const n=await env.DB.prepare(`SELECT * FROM card_notes WHERE id=? AND chat_id=?`).bind(id,String(chatId)).first(); if(!n){await showNotes(env,ctx,chatId,page,cleanup);return;} await sendScreen(env,ctx,chatId,`<b>≡ Заметка: ${esc(n.title)}</b>\n\n${esc(n.body)}`,cleanup,{inline:ik([[{text:"◀ Мои заметки",callback_data:`cf:note:list:${page}`}],[{text:"⌂ Терминал",callback_data:"cf:main"}]])}); }
async function searchPrompt(env,ctx,chatId,kind,cleanup=[]){ await flowSet(env,chatId,`cf_search_${kind}`,{}); const label=kind==="anom"?"аномалии":kind==="res"?"исследования":"заметки"; await sendScreen(env,ctx,chatId,`<b>Поиск ${label}</b>\n\nНапиши название или его часть.`,cleanup,{inline:ik([[{text:"◀ Картотека",callback_data:"cf:menu"}]])}); }
async function searchResults(env,ctx,chatId,kind,q,cleanup=[]){ const s=trim(q,64); if(!s){await searchPrompt(env,ctx,chatId,kind,cleanup);return;} let rows=[], out=""; if(kind==="anom"){const r=await env.DB.prepare(`SELECT * FROM anomalies WHERE title LIKE ? COLLATE NOCASE ORDER BY title LIMIT 10`).bind("%"+s+"%").all(); const items=r.results||[]; out=`<b>Поиск аномалии</b>\nЗапрос: <code>${esc(s)}</code>\n\n`; items.forEach((x,i)=>out+=`<b>${i+1}.</b> ${esc(x.title)} · ценность ${x.value_points}\n`); if(items.length)rows.push(items.map((x,i)=>({text:String(i+1),callback_data:`cf:anom:card:${x.id}:search:0:0`}))); if(!items.length)out+="Ничего не найдено.";} else if(kind==="res"){const r=await env.DB.prepare(`SELECT * FROM researches WHERE title LIKE ? COLLATE NOCASE ORDER BY title LIMIT 10`).bind("%"+s+"%").all(); const items=r.results||[]; out=`<b>Поиск исследования</b>\nЗапрос: <code>${esc(s)}</code>\n\n`; items.forEach((x,i)=>out+=`<b>${i+1}.</b> ${esc(x.title)} · ценность ${x.value_points}\n`); if(!items.length)out+="Ничего не найдено.";} else {const r=await env.DB.prepare(`SELECT * FROM card_notes WHERE chat_id=? AND title LIKE ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 10`).bind(String(chatId),"%"+s+"%").all(); const items=r.results||[]; out=`<b>Поиск заметки</b>\nЗапрос: <code>${esc(s)}</code>\n\n`; items.forEach((x,i)=>out+=`<b>${i+1}.</b> ${esc(x.title)}\n`); if(items.length)rows.push(items.map((x,i)=>({text:String(i+1),callback_data:`cf:note:card:${x.id}:0`}))); if(!items.length)out+="Ничего не найдено.";} rows.push([{text:"Новый поиск",callback_data:`cf:${kind}:search`},{text:"◀ Картотека",callback_data:"cf:menu"}]); await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)}); }

async function handleCardfileFlow(env,ctx,chatId,m,flow,cleanup){
  const text=msgText(m);
  if(flow.mode==="cf_anom_title"){
    const title=trim(text,80); if(!title||hasLink(title)){await sendScreen(env,ctx,chatId,"<b>Название не принято.</b>\n\nДо 80 символов, без ссылок.",cleanup);return true;}
    const existing=await anomalyByTitle(env,title); const route=await routeById(env,flow.payload.route_id); if(!route){await flowClear(env,chatId);await sendScreen(env,ctx,chatId,"<b>След не найден.</b>",cleanup);return true;}
    if(existing){ await createFinding(env,existing.id,route,chatId); await flowClear(env,chatId); await sendScreen(env,ctx,chatId,`<b>Аномалия уже есть в картотеке.</b>\n\nНазвание: <b>${esc(existing.title)}</b>\nВ текущем следе добавлено новое обнаружение.`,cleanup,{inline:ik([[{text:"Открыть карточку",callback_data:`cf:anom:card:${existing.id}:all:0:0`}],[{text:"△ Аномалии",callback_data:"cf:anom:menu"}]])}); return true; }
    await flowSet(env,chatId,"cf_anom_value",{...flow.payload,title}); await sendScreen(env,ctx,chatId,"<b>Ценность аномалии</b>\n\nУкажи число от 0 до 999. Эти очки позже войдут в расширенную эффективность оператора.",cleanup); return true;
  }
  if(flow.mode==="cf_anom_value"){
    const value=Number.parseInt(text,10); if(!Number.isFinite(value)||value<0||value>999){await sendScreen(env,ctx,chatId,"<b>Ценность не принята.</b>\n\nЧисло от 0 до 999.",cleanup);return true;}
    await flowSet(env,chatId,"cf_anom_desc",{...flow.payload,value}); await sendScreen(env,ctx,chatId,"<b>Описание аномалии</b>\n\nДо 2048 символов, без ссылок.",cleanup); return true;
  }
  if(flow.mode==="cf_anom_desc"){
    const desc=trim(text,2048); if(!desc||hasLink(desc)){await sendScreen(env,ctx,chatId,"<b>Описание не принято.</b>\n\nДо 2048 символов, без ссылок.",cleanup);return true;}
    const route=await routeById(env,flow.payload.route_id); if(!route){await flowClear(env,chatId);await sendScreen(env,ctx,chatId,"<b>След не найден.</b>",cleanup);return true;}
    const id=uid(); await env.DB.prepare(`INSERT INTO anomalies(id,title,description,value_points,created_by_chat_id,created_route_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).bind(id,flow.payload.title,desc,Number(flow.payload.value),String(chatId),route.id,now(),now()).run(); await createFinding(env,id,route,chatId); await flowSet(env,chatId,"cf_anom_media",{anomaly_id:id}); await sendScreen(env,ctx,chatId,"<b>Аномалия зарегистрирована.</b>\n\nОтправь до 3 фото или одно видео до 3 минут.\n<code>/skip</code> — завершить без медиа.",cleanup,{inline:ik([[{text:"Пропустить",callback_data:`cf:anom:card:${id}:all:0:0`}],[{text:"△ Аномалии",callback_data:"cf:anom:menu"}]])}); return true;
  }
  if(flow.mode==="cf_anom_media"){
    if(text==="/skip"||text.toLowerCase()==="пропустить"||text==="/done"){await flowClear(env,chatId); await showAnomalyCard(env,ctx,chatId,flow.payload.anomaly_id,"all",0,0,cleanup); return true;}
    await addAnomalyMedia(env,ctx,chatId,flow.payload.anomaly_id,m,cleanup); return true;
  }
  if(flow.mode==="cf_note_title"){const title=trim(text,80); if(!title||hasLink(title)){await sendScreen(env,ctx,chatId,"<b>Заголовок не принят.</b>\n\nКоротко, без ссылок.",cleanup);return true;} await flowSet(env,chatId,"cf_note_body",{title}); await sendScreen(env,ctx,chatId,"<b>Текст заметки</b>\n\nДо 2048 символов, без ссылок.",cleanup); return true;}
  if(flow.mode==="cf_note_body"){const body=trim(text,2048); if(!body||hasLink(body)){await sendScreen(env,ctx,chatId,"<b>Заметка не принята.</b>\n\nДо 2048 символов, без ссылок.",cleanup);return true;} const id=uid(); await env.DB.prepare(`INSERT INTO card_notes(id,chat_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?)`).bind(id,String(chatId),flow.payload.title,body,now(),now()).run(); await flowClear(env,chatId); await showNoteCard(env,ctx,chatId,id,0,cleanup); return true;}
  if(flow.mode==="cf_search_anom"||flow.mode==="cf_search_res"||flow.mode==="cf_search_note"){const kind=flow.mode.replace("cf_search_",""); await flowClear(env,chatId); await searchResults(env,ctx,chatId,kind,text,cleanup); return true;}
  return false;
}

function isCardfileCommand(text){ const low=text.toLowerCase(); return low.startsWith("/cardfile")||low.startsWith("/kartoteka")||low.includes("картотека")||low.includes("аномалии")||low.includes("исследования")||low.includes("заметки"); }

export async function handleCardfileRequest(request,env,ctx){
  await ensureCardfileSchema(env);
  let update; try{ update = await request.json(); }catch{return null;}
  if(update.callback_query){
    const cb=update.callback_query; await tg(env,"answerCallbackQuery",{callback_query_id:cb.id}); const chatId=String(cb.message.chat.id), data=cb.data||"";
    if(!data.startsWith("cf:")) return null;
    if(data==="cf:main"){await showMain(env,ctx,chatId);return new Response("ok",{status:200});}
    if(data==="cf:menu"){await showCardfile(env,ctx,chatId);return new Response("ok",{status:200});}
    const p=data.split(":"); const kind=p[1], act=p[2];
    if(act==="menu"){await showSectionMenu(env,ctx,chatId,kind);return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="new"){await showRoutePicker(env,ctx,chatId,"new");return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="picknew"){await flowSet(env,chatId,"cf_anom_title",{route_id:p[3]});await sendScreen(env,ctx,chatId,"<b>Название аномалии</b>\n\nУкажи уникальное название. Если такая аномалия уже есть, она будет добавлена как обнаружение в выбранный след.");return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="attach"){await showRoutePicker(env,ctx,chatId,"attach",p[3]);return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="attachpick"){const anomalyId=p[3], routeId=p[4]; const route=await routeById(env,routeId); if(route)await createFinding(env,anomalyId,route,chatId); await showAnomalyCard(env,ctx,chatId,anomalyId,"all",0,0);return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="media"){await flowSet(env,chatId,"cf_anom_media",{anomaly_id:p[3]});await sendScreen(env,ctx,chatId,"<b>Медиа аномалии</b>\n\nФото до 3 штук или одно видео до 3 минут.\n<code>/skip</code> — завершить.");return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="all"){await showAnomaliesAll(env,ctx,chatId,Number(p[3]||0));return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="near"){await showAnomaliesNear(env,ctx,chatId,Number(p[3]||0));return new Response("ok",{status:200});}
    if(kind==="anom"&&act==="card"){await showAnomalyCard(env,ctx,chatId,p[3],p[4]||"all",Number(p[5]||0),Number(p[6]||0));return new Response("ok",{status:200});}
    if(kind==="res"&&act==="all"){await showResearchAll(env,ctx,chatId,Number(p[3]||0));return new Response("ok",{status:200});}
    if(kind==="res"&&act==="near"){await sendScreen(env,ctx,chatId,"<b>⌬ Исследования в радиусе</b>\n\nГео-вывод исследований будет включён на следующем этапе через связанные следы и аномалии.",[],{inline:ik([[{text:"◀ Исследования",callback_data:"cf:res:menu"}]])});return new Response("ok",{status:200});}
    if(act==="search"){await searchPrompt(env,ctx,chatId,kind);return new Response("ok",{status:200});}
    if(kind==="note"&&act==="list"){await showNotes(env,ctx,chatId,Number(p[3]||0));return new Response("ok",{status:200});}
    if(kind==="note"&&act==="new"){await flowSet(env,chatId,"cf_note_title",{});await sendScreen(env,ctx,chatId,"<b>Новая заметка</b>\n\nОтправь заголовок.");return new Response("ok",{status:200});}
    if(kind==="note"&&act==="card"){await showNoteCard(env,ctx,chatId,p[3],Number(p[4]||0));return new Response("ok",{status:200});}
    if(kind==="rate"){await rateEntity(env,ctx,chatId,p[2],p[3],Number(p[4]||0));return new Response("ok",{status:200});}
    await showCardfile(env,ctx,chatId); return new Response("ok",{status:200});
  }
  const m=update.message||update.edited_message; if(!m?.chat?.id)return null; const chatId=String(m.chat.id), incoming=m.message_id?Number(m.message_id):null; if(incoming)await remember(env,chatId,incoming,"user"); const cleanup=incoming?[incoming]:[]; const text=msgText(m);
  const flow=await flowGet(env,chatId); if(flow.mode?.startsWith("cf_")){const ok=await handleCardfileFlow(env,ctx,chatId,m,flow,cleanup); if(ok)return new Response("ok",{status:200});}
  const low=text.toLowerCase(); if(low.startsWith("/start")||low.startsWith("/menu")||low.startsWith("/help")||low.includes("терминал")){await showMain(env,ctx,chatId,cleanup);return new Response("ok",{status:200});}
  if(isCardfileCommand(text)){await showCardfile(env,ctx,chatId,cleanup);return new Response("ok",{status:200});}
  return null;
}
