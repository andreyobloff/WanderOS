import priorWorker from "./index_cardfile13e.js";

const PAGE = 10;
const now = () => new Date().toISOString();
const esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const trim = (v, n) => String(v || "").trim().slice(0, n);
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
  const r=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
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
    const id=Number(sent.result.message_id); await setUi(env,chatId,id); await remember(env,chatId,id,"bot");
    ctx.waitUntil((async()=>{for(const mid of [...new Set(cleanup.concat(old||[]).filter(Boolean).map(Number))]) await delMsg(env,chatId,mid); await prune(env,chatId,id);})());
  }
}

async function ensureSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operator_reviews (reviewer_chat_id TEXT NOT NULL,target_chat_id TEXT NOT NULL,vote INTEGER NOT NULL CHECK(vote IN (-1,1)),created_at TEXT NOT NULL,PRIMARY KEY(reviewer_chat_id,target_chat_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomalies (id TEXT PRIMARY KEY,title TEXT NOT NULL COLLATE NOCASE UNIQUE,description TEXT,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_route_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS anomaly_findings (id TEXT PRIMARY KEY,anomaly_id TEXT NOT NULL,route_id TEXT NOT NULL,finder_chat_id TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,created_at TEXT NOT NULL,UNIQUE(anomaly_id,route_id,finder_chat_id))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS researches (id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,value_points INTEGER NOT NULL DEFAULT 0,created_by_chat_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS entity_reviews (entity_type TEXT NOT NULL CHECK(entity_type IN ('anomaly','research')),entity_id TEXT NOT NULL,reviewer_chat_id TEXT NOT NULL,vote INTEGER NOT NULL CHECK(vote IN (-1,1)),created_at TEXT NOT NULL,PRIMARY KEY(entity_type,entity_id,reviewer_chat_id))`).run();
}
async function flowClear(env, chatId){ await env.DB.prepare(`INSERT INTO flow_state(chat_id,mode,payload_json,updated_at) VALUES(?,NULL,NULL,?) ON CONFLICT(chat_id) DO UPDATE SET mode=NULL,payload_json=NULL,updated_at=excluded.updated_at`).bind(String(chatId),now()).run(); }
async function profile(env, chatId){ return await env.DB.prepare(`SELECT u.chat_id,u.username,u.first_name,p.base_lat,p.base_lon,p.radius_m,p.base_label,op.callsign,op.age,op.sex,op.bio,op.photo_file_id FROM users u JOIN profiles p ON p.chat_id=u.chat_id LEFT JOIN operator_profiles op ON op.chat_id=u.chat_id WHERE u.chat_id=?`).bind(String(chatId)).first(); }
async function countRows(env, sql, ...args){ const r=await env.DB.prepare(sql).bind(...args).first(); return Number(r?.c||0); }
async function countRoutes(env, chatId){ return await countRows(env,`SELECT COUNT(*) c FROM routes WHERE chat_id=?`,String(chatId)); }
async function countCoops(env, chatId){ return await countRows(env,`SELECT COUNT(*) c FROM cooperations WHERE status='accepted' AND (requester_chat_id=? OR target_chat_id=?)`,String(chatId),String(chatId)); }
async function operatorVoteStats(env, chatId){
  const r=await env.DB.prepare(`SELECT COALESCE(SUM(vote),0) score, COUNT(*) total, SUM(CASE WHEN vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN vote=-1 THEN 1 ELSE 0 END) minus FROM operator_reviews WHERE target_chat_id=?`).bind(String(chatId)).first();
  return {score:Number(r?.score||0),total:Number(r?.total||0),plus:Number(r?.plus||0),minus:Number(r?.minus||0)};
}
async function cardStats(env, chatId){
  const a=await env.DB.prepare(`SELECT COUNT(*) c, COALESCE(SUM(value_points),0) v FROM anomalies WHERE created_by_chat_id=?`).bind(String(chatId)).first();
  const f=await env.DB.prepare(`SELECT COUNT(*) c FROM anomaly_findings WHERE finder_chat_id=?`).bind(String(chatId)).first();
  const r=await env.DB.prepare(`SELECT COUNT(*) c, COALESCE(SUM(value_points),0) v FROM researches WHERE created_by_chat_id=?`).bind(String(chatId)).first();
  const ar=await env.DB.prepare(`SELECT COALESCE(SUM(er.vote),0) score, SUM(CASE WHEN er.vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN er.vote=-1 THEN 1 ELSE 0 END) minus FROM entity_reviews er JOIN anomalies a ON a.id=er.entity_id WHERE er.entity_type='anomaly' AND a.created_by_chat_id=?`).bind(String(chatId)).first();
  const rr=await env.DB.prepare(`SELECT COALESCE(SUM(er.vote),0) score, SUM(CASE WHEN er.vote=1 THEN 1 ELSE 0 END) plus, SUM(CASE WHEN er.vote=-1 THEN 1 ELSE 0 END) minus FROM entity_reviews er JOIN researches rs ON rs.id=er.entity_id WHERE er.entity_type='research' AND rs.created_by_chat_id=?`).bind(String(chatId)).first();
  return {
    anomalies:Number(a?.c||0), anomalyValue:Number(a?.v||0), findings:Number(f?.c||0),
    researches:Number(r?.c||0), researchValue:Number(r?.v||0),
    anomalyRating:Number(ar?.score||0), anomalyRatingPlus:Number(ar?.plus||0), anomalyRatingMinus:Number(ar?.minus||0),
    researchRating:Number(rr?.score||0), researchRatingPlus:Number(rr?.plus||0), researchRatingMinus:Number(rr?.minus||0)
  };
}
async function efficiency(env, chatId){
  const op=await operatorVoteStats(env,chatId), cs=await cardStats(env,chatId);
  const value=cs.anomalyValue+cs.researchValue;
  const entityRating=cs.anomalyRating+cs.researchRating;
  const score=value+op.score+entityRating;
  return {score,value,operatorScore:op.score,operatorPlus:op.plus,operatorMinus:op.minus,operatorVotes:op.total,entityRating, ...cs};
}
function effLine(e){ return `${e.score>=0?"+":""}${e.score}`; }
function baseDossier(p){
  const user=p?.username?"@"+esc(p.username):esc(p?.first_name||"нет");
  const base=typeof p?.base_lat==="number"?`<code>${p.base_lat}, ${p.base_lon}</code>\n${esc(p.base_label||"штаб")}`:"не установлен";
  return `Позывной: <b>${esc(p?.callsign||"—")}</b>\nПользователь: ${user}\nВозраст: ${p?.age||"—"}\nПол: ${esc(p?.sex||"—")}\nРадиус: <b>${p?.radius_m||"—"} м</b>\nШтаб: ${base}`;
}
function efficiencyBlock(e){
  return `<b>Эффективность</b>\nИтог: <b>${effLine(e)}</b>\n\nФормула: ценность картотеки + отзывы операторов + рейтинг ценности.\n\nЦенность аномалий: <b>${e.anomalyValue}</b> (${e.anomalies})\nЦенность исследований: <b>${e.researchValue}</b> (${e.researches})\nОтзывы операторов: <b>${e.operatorScore>=0?"+":""}${e.operatorScore}</b> (${e.operatorPlus}+/ ${e.operatorMinus}-)\nРейтинг аномалий: <b>${e.anomalyRating>=0?"+":""}${e.anomalyRating}</b> (${e.anomalyRatingPlus}+/ ${e.anomalyRatingMinus}-)\nРейтинг исследований: <b>${e.researchRating>=0?"+":""}${e.researchRating}</b> (${e.researchRatingPlus}+/ ${e.researchRatingMinus}-)\nОбнаружения аномалий: <b>${e.findings}</b>`;
}
async function showEfficiency(env, ctx, viewer, target, cleanup=[]){
  const p=await profile(env,target); if(!p?.callsign){await sendScreen(env,ctx,viewer,"<b>Оперативник не найден.</b>",cleanup);return;}
  const e=await efficiency(env,target), traces=await countRoutes(env,target), coops=await countCoops(env,target);
  const self=String(viewer)===String(target);
  const out=`<b>☾ ${self?"Досье оператора":"Профиль оперативника"}</b>\n\n${baseDossier(p)}\n\n${efficiencyBlock(e)}\n\n<b>Полевая активность</b>\nСледы: <b>${traces}</b>\nКооперации: <b>${coops}</b>\n\n${esc(p.bio||"")}`;
  const rows=self?[
    [{text:"▣ Детализация",callback_data:`eff:detail:${target}`},{text:"✎ Редактировать",callback_data:"edit:menu"}],
    [{text:"‡ Следы",callback_data:`cfe:archive:${target}:0`},{text:"△ Аномалии",callback_data:`cfe:anom:${target}:created:0`}],
    [{text:"⌬ Исследования",callback_data:`cfe:res:${target}:0`},{text:"≡ Заметки",callback_data:"cfe:notes:0"}],
    [{text:"⌂ Терминал",callback_data:"cf:main"}]
  ]:[
    [{text:"▣ Детализация",callback_data:`eff:detail:${target}`}],
    [{text:"‡ Следы",callback_data:`cfe:archive:${target}:0`},{text:"△ Выявил",callback_data:`cfe:anom:${target}:created:0`}],
    [{text:"△ Обнаружил",callback_data:`cfe:anom:${target}:found:0`},{text:"⌬ Исследования",callback_data:`cfe:res:${target}:0`}],
    [{text:"⚭ Кооперация",callback_data:`coop:${target}`},{text:"⊕ Оперативники",callback_data:"opsmenu"}]
  ];
  await sendScreen(env,ctx,viewer,out,cleanup,{photo:p.photo_file_id||null,inline:ik(rows)});
}
async function showEfficiencyDetail(env, ctx, viewer, target, cleanup=[]){
  const p=await profile(env,target); if(!p?.callsign){await sendScreen(env,ctx,viewer,"<b>Оперативник не найден.</b>",cleanup);return;}
  const e=await efficiency(env,target);
  const out=`<b>▣ Расчёт эффективности</b>\nОператор: <b>${esc(p.callsign)}</b>\n\n<b>Итог: ${effLine(e)}</b>\n\n1. Ценность аномалий: <b>${e.anomalyValue}</b>\n2. Ценность исследований: <b>${e.researchValue}</b>\n3. Отзывы операторов: <b>${e.operatorScore>=0?"+":""}${e.operatorScore}</b>\n4. Рейтинг ценности аномалий: <b>${e.anomalyRating>=0?"+":""}${e.anomalyRating}</b>\n5. Рейтинг ценности исследований: <b>${e.researchRating>=0?"+":""}${e.researchRating}</b>\n\nОбнаружения аномалий не дают очки напрямую, но фиксируют полевую активность и показываются отдельно: <b>${e.findings}</b>.`;
  await sendScreen(env,ctx,viewer,out,cleanup,{inline:ik([[{text:"☾ Досье",callback_data:String(viewer)===String(target)?"eff:me":`eff:op:${target}`}],[{text:"⊕ Рейтинг",callback_data:"eff:top:0"}]])});
}
async function allOperators(env, page=0){
  const r=await env.DB.prepare(`SELECT op.chat_id,op.callsign,op.age,u.username,u.first_name FROM operator_profiles op JOIN users u ON u.chat_id=op.chat_id WHERE op.is_visible=1 LIMIT 500`).all();
  const items=[];
  for(const x of r.results||[]) items.push({...x,eff:await efficiency(env,x.chat_id)});
  items.sort((a,b)=>(b.eff.score-a.eff.score)||(b.eff.value-a.eff.value)||String(a.callsign).localeCompare(String(b.callsign),"ru"));
  return {items:items.slice(page*PAGE,page*PAGE+PAGE),total:items.length};
}
async function showTop(env, ctx, chatId, page=0, cleanup=[]){
  const data=await allOperators(env,page); let out=`<b>⊕ Оперативники по эффективности</b>\nВсего в бюро: <b>${data.total}</b>\n\n`;
  data.items.forEach((x,i)=>{out+=`<b>${page*PAGE+i+1}.</b> ${esc(x.callsign)} · ${x.age||"—"} · <b>${effLine(x.eff)}</b>\nценность: ${x.eff.value}, отзывы: ${x.eff.operatorScore>=0?"+":""}${x.eff.operatorScore}\n`;});
  if(!data.items.length)out+="Оперативников нет.";
  const rows=[]; if(data.items.length)rows.push(data.items.slice(0,5).map((x,i)=>({text:String(i+1),callback_data:`eff:op:${x.chat_id}`}))); if(data.items.length>5)rows.push(data.items.slice(5,10).map((x,i)=>({text:String(i+6),callback_data:`eff:op:${x.chat_id}`})));
  const nav=[]; if(page>0)nav.push({text:"◀",callback_data:`eff:top:${page-1}`}); if((page+1)*PAGE<data.total)nav.push({text:"▶",callback_data:`eff:top:${page+1}`}); if(nav.length)rows.push(nav);
  rows.push([{text:"⊕ Меню оперативников",callback_data:"opsmenu"},{text:"⌂ Терминал",callback_data:"cf:main"}]);
  await sendScreen(env,ctx,chatId,out.trim(),cleanup,{inline:ik(rows)});
}

async function handleCallback(cb, env, ctx){
  const data=cb.data||"";
  if(data.startsWith("op:")){
    await ensureSchema(env); await tg(env,"answerCallbackQuery",{callback_query_id:cb.id}); const p=data.split(":"), viewer=String(cb.message.chat.id); await showEfficiency(env,ctx,viewer,p[1]); return true;
  }
  if(!data.startsWith("eff:"))return false;
  await ensureSchema(env); await tg(env,"answerCallbackQuery",{callback_query_id:cb.id}); const chatId=String(cb.message.chat.id), p=data.split(":"), act=p[1];
  if(act==="me"){await flowClear(env,chatId); await showEfficiency(env,ctx,chatId,chatId); return true;}
  if(act==="op"){await showEfficiency(env,ctx,chatId,p[2]); return true;}
  if(act==="detail"){await showEfficiencyDetail(env,ctx,chatId,p[2]); return true;}
  if(act==="top"){await showTop(env,ctx,chatId,Number(p[2]||0)); return true;}
  return false;
}
async function handleMessage(update, env, ctx){
  const m=update.message||update.edited_message; if(!m?.chat?.id)return false;
  await ensureSchema(env); const chatId=String(m.chat.id), incoming=m.message_id?Number(m.message_id):null; if(incoming)await remember(env,chatId,incoming,"user"); const cleanup=incoming?[incoming]:[];
  const low=msgText(m).toLowerCase();
  if(low.startsWith("/profile")||low.includes("досье")||low.includes("профиль")){await flowClear(env,chatId); await showEfficiency(env,ctx,chatId,chatId,cleanup); return true;}
  if(low.startsWith("/efficiency")||low.includes("эффективность")){await flowClear(env,chatId); await showEfficiencyDetail(env,ctx,chatId,chatId,cleanup); return true;}
  if(low.startsWith("/top")||low.includes("рейтинг оперативников")){await flowClear(env,chatId); await showTop(env,ctx,chatId,0,cleanup); return true;}
  return false;
}
async function handleUpdate(update, env, ctx){ if(update.callback_query)return await handleCallback(update.callback_query,env,ctx); return await handleMessage(update,env,ctx); }

export default {
  async fetch(request, env, ctx){
    const url=new URL(request.url);
    if(url.pathname==="/"){
      let database="missing"; try{if(env.DB){await ensureSchema(env);await env.DB.prepare("SELECT 1 AS ok").first();database="D1 ready";}}catch{database="D1 error";}
      return Response.json({service:"WanderOS",status:"ok",runtime:"Cloudflare Workers",database,modules:["expanded-operator-efficiency","cardfile-value-scoring","operator-top-by-efficiency","legacy-worker-delegation"]});
    }
    if(url.pathname!=="/webhook")return priorWorker.fetch(request,env,ctx);
    if(request.method!=="POST")return new Response("method not allowed",{status:405});
    const clone=request.clone(); let update; try{update=await clone.json();}catch{return priorWorker.fetch(request,env,ctx);}
    const handled=await handleUpdate(update,env,ctx);
    if(handled)return new Response("ok",{status:200});
    return priorWorker.fetch(request,env,ctx);
  }
};
