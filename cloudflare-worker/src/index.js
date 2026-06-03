const MOSCOW_CENTER = { lat: 55.7558, lon: 37.6173 };
const DEFAULT_RADIUS_M = 1500;

function randomPointAround(center, radiusM = DEFAULT_RADIUS_M) {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radiusM;
  const earthRadiusM = 6371000;

  const deltaLat = (distance * Math.cos(angle)) / earthRadiusM;
  const deltaLon =
    (distance * Math.sin(angle)) /
    (earthRadiusM * Math.cos(center.lat * Math.PI / 180));

  const lat = center.lat + deltaLat * 180 / Math.PI;
  const lon = center.lon + deltaLon * 180 / Math.PI;

  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  };
}

function safetyDisclaimer() {
  return "Важно: WanderOS предлагает идею прогулки, а не гарантированно безопасный маршрут. Не заходите на частные, закрытые, промышленные и опасные территории.";
}

function getCommand(message) {
  let text = "";
  if (message && message.text) {
    text = message.text;
  }

  return text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
}

function buildStartText() {
  return "<b>WanderOS</b>\n\n" +
    "Serverless-версия Telegram-бота для безопасных городских мини-квестов.\n\n" +
    "Команды:\n" +
    "/help - справка\n" +
    "/profile - профиль\n" +
    "/point - случайная точка вокруг центра Москвы\n" +
    "/near - точка рядом с вашей геолокацией\n" +
    "/location - отправить геолокацию\n" +
    "/report - учебный отчёт\n\n" +
    safetyDisclaimer();
}

function buildHelpText() {
  return "<b>Справка WanderOS</b>\n\n" +
    "/start - запуск бота\n" +
    "/help - справка\n" +
    "/profile - профиль пользователя\n" +
    "/point - демо-точка вокруг центра Москвы\n" +
    "/near - запросить геолокацию и построить точку рядом\n" +
    "/location - то же самое, кнопка отправки геопозиции\n" +
    "/report - учебный отчёт\n\n" +
    "Чтобы построить точку рядом с вами, используйте /near и нажмите кнопку отправки геолокации.";
}

function buildProfileText() {
  return "<b>Профиль WanderOS</b>\n\n" +
    "Город по умолчанию: Москва\n" +
    "Радиус генерации: 1500 м\n" +
    "Режим: serverless / Cloudflare Workers\n" +
    "Геолокация: используется только после явного подтверждения пользователем\n" +
    "Тариф: учебный free\n\n" +
    "История маршрутов будет добавлена позже.";
}

function buildQuestText(point, sourceLabel) {
  const mapsUrl = "https://www.google.com/maps?q=" + point.lat + "," + point.lon;

  return "<b>Квест WanderOS</b>\n\n" +
    "<b>Источник:</b> " + sourceLabel + "\n" +
    "<b>Координаты:</b> " + point.lat + ", " + point.lon + "\n" +
    "<b>Карта:</b> " + mapsUrl + "\n\n" +
    "<b>Задание:</b>\n" +
    "1. Найдите рядом городской объект, который обычно остаётся незамеченным.\n" +
    "2. Опишите его одним предложением.\n" +
    "3. Сделайте фото только если это безопасно и уместно.\n\n" +
    safetyDisclaimer();
}

function buildMoscowPointText() {
  const point = randomPointAround(MOSCOW_CENTER);
  return buildQuestText(point, "центр Москвы");
}

function buildLocationQuestText(location) {
  const userCenter = {
    lat: Number(location.latitude),
    lon: Number(location.longitude),
  };

  const point = randomPointAround(userCenter);
  return buildQuestText(point, "ваша отправленная геолокация");
}

function buildReportText() {
  return "<b>Отчёт WanderOS</b>\n\n" +
    "Режим работы: Cloudflare Workers + Telegram Webhook.\n" +
    "Локальный компьютер: не требуется.\n" +
    "VPS: не используется.\n" +
    "Геолокация: поддерживается через встроенную отправку location в Telegram.\n" +
    "Назначение: учебная демонстрация serverless-архитектуры Telegram-бота.";
}

function buildUnknownText() {
  return "Я пока понимаю только команды.\n\n" +
    "Попробуйте: /start, /help, /profile, /point, /near, /report";
}

function buildLocationRequestText() {
  return "<b>Геолокация WanderOS</b>\n\n" +
    "Нажмите кнопку ниже, чтобы отправить текущую геолокацию. " +
    "После этого бот сгенерирует безопасную демо-точку рядом с вами.\n\n" +
    "Геолокация используется только для расчёта точки и не сохраняется в этой версии.";
}

function locationKeyboard() {
  return {
    keyboard: [
      [
        {
          text: "Отправить геолокацию",
          request_location: true,
        },
      ],
      [
        {
          text: "/point",
        },
        {
          text: "/help",
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function removeKeyboard() {
  return {
    remove_keyboard: true,
  };
}

async function sendMessage(env, chatId, text, replyMarkup = null) {
  const apiUrl = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage";

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Telegram sendMessage failed", response.status, errorText);
  }
}

async function handleTelegramUpdate(request, env) {
  const update = await request.json();
  const message = update.message || update.edited_message;

  if (!message || !message.chat || !message.chat.id) {
    return new Response("ignored", { status: 200 });
  }

  const chatId = message.chat.id;

  if (message.location) {
    const reply = buildLocationQuestText(message.location);
    await sendMessage(env, chatId, reply, removeKeyboard());
    return new Response("ok", { status: 200 });
  }

  const command = getCommand(message);

  if (command === "/start") {
    await sendMessage(env, chatId, buildStartText());
    return new Response("ok", { status: 200 });
  }

  if (command === "/help") {
    await sendMessage(env, chatId, buildHelpText());
    return new Response("ok", { status: 200 });
  }

  if (command === "/profile") {
    await sendMessage(env, chatId, buildProfileText());
    return new Response("ok", { status: 200 });
  }

  if (command === "/point") {
    await sendMessage(env, chatId, buildMoscowPointText());
    return new Response("ok", { status: 200 });
  }

  if (command === "/near" || command === "/location") {
    await sendMessage(env, chatId, buildLocationRequestText(), locationKeyboard());
    return new Response("ok", { status: 200 });
  }

  if (command === "/report") {
    await sendMessage(env, chatId, buildReportText());
    return new Response("ok", { status: 200 });
  }

  await sendMessage(env, chatId, buildUnknownText());
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
        features: ["telegram-webhook", "location-request", "random-point"],
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

    return handleTelegramUpdate(request, env);
  },
};
