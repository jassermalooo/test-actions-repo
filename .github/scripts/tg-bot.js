const { execSync, exec } = require('child_process');
const https = require('https');
const fs = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = '5653032481';
const GEMINI_KEY = process.env.GEMINI_API_KEY;
let offset = 0;

// ── helpers ────────────────────────────────────────────────────────────────

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMsg(text) {
  return tgRequest('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
}

function sendPhoto(photoPath) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now();
    const fileData = fs.readFileSync(photoPath);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screen.png"\r\nContent-Type: image/png\r\n\r\n`),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendPhoto`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function adb(cmd) {
  try {
    return execSync(`adb ${cmd}`, { timeout: 15000 }).toString().trim();
  } catch (e) {
    return `خطأ: ${e.message.slice(0, 100)}`;
  }
}

function screenshot() {
  adb('shell screencap -p /sdcard/screen.png');
  adb('pull /sdcard/screen.png /tmp/screen.png');
  return '/tmp/screen.png';
}

// ── Gemini ─────────────────────────────────────────────────────────────────

async function askGemini(userMessage) {
  const prompt = `أنت مساعد يتحكم في هاتف Android عبر ADB.
المستخدم يعطيك أوامر بالعربية، وأنت تترجمها لأوامر ADB فقط.

قواعد مهمة:
- رد بـ JSON فقط بهذا الشكل: {"cmds": ["adb shell ...", "adb shell ..."], "reply": "رسالة قصيرة للمستخدم"}
- لتثبيت تطبيق من Play Store: {"cmds": ["adb shell am start -a android.intent.action.VIEW -d 'market://details?id=APP_PACKAGE'"], "reply": "..."}
- لفتح تطبيق: {"cmds": ["adb shell monkey -p APP_PACKAGE -c android.intent.category.LAUNCHER 1"], "reply": "..."}
- للضغط على نقطة: {"cmds": ["adb shell input tap X Y"], "reply": "..."}
- للكتابة: {"cmds": ["adb shell input text 'النص'"], "reply": "..."}
- للتمرير: {"cmds": ["adb shell input swipe X1 Y1 X2 Y2"], "reply": "..."}
- للرجوع: {"cmds": ["adb shell input keyevent KEYCODE_BACK"], "reply": "..."}
- للهوم: {"cmds": ["adb shell input keyevent KEYCODE_HOME"], "reply": "..."}
- إذا أراد screenshot قل: {"cmds": ["__screenshot__"], "reply": "..."}
- إذا لم تفهم: {"cmds": [], "reply": "لم أفهم الأمر، وضّح أكثر"}

أمر المستخدم: "${userMessage}"`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const text = data.candidates[0].content.parts[0].text;
          const cleaned = text.replace(/```json|```/g, '').trim();
          resolve(JSON.parse(cleaned));
        } catch (e) {
          resolve({ cmds: [], reply: 'حدث خطأ في معالجة الأمر' });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── polling loop ───────────────────────────────────────────────────────────

async function processUpdate(update) {
  if (!update.message) return;
  const msg = update.message;
  if (String(msg.chat.id) !== CHAT_ID) {
    return; // تجاهل أي شخص آخر
  }
  const text = msg.text || '';
  console.log(`[MSG] ${text}`);

  if (text === '/start') {
    await sendMsg(`🤖 *بوت التحكم بـ Android جاهز!*\n\nأرسل أي أمر بالعربية مثل:\n• نزّل يوتيوب\n• افتح المتصفح\n• اكتب مرحبا\n• خذ screenshot\n• ارجع للرئيسية`);
    return;
  }

  if (text === '/screenshot' || text === 'screenshot' || text === 'صورة') {
    await sendMsg('📸 جاري التقاط الشاشة...');
    const path = screenshot();
    await sendPhoto(path);
    return;
  }

  await sendMsg('⏳ جاري معالجة الأمر...');

  try {
    const result = await askGemini(text);
    console.log('[GEMINI]', JSON.stringify(result));

    for (const cmd of result.cmds || []) {
      if (cmd === '__screenshot__') {
        const path = screenshot();
        await sendPhoto(path);
      } else {
        const rawCmd = cmd.replace(/^adb /, '');
        const out = adb(rawCmd);
        console.log(`[ADB] ${rawCmd} → ${out}`);
      }
      await new Promise(r => setTimeout(r, 800));
    }

    await sendMsg(`✅ ${result.reply}`);
  } catch (e) {
    console.error('[ERROR]', e);
    await sendMsg(`❌ خطأ: ${e.message}`);
  }
}

async function poll() {
  const res = await tgRequest('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
  if (res.ok && res.result.length) {
    for (const upd of res.result) {
      offset = upd.update_id + 1;
      await processUpdate(upd);
    }
  }
}

// ── start ──────────────────────────────────────────────────────────────────

(async () => {
  console.log('🤖 Telegram bot started, chat_id:', CHAT_ID);
  await sendMsg('🚀 *Android Cloud جاهز!*\n\nأرسل /start لبدء التحكم.');
  while (true) {
    try { await poll(); } catch (e) { console.error('[POLL ERROR]', e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
})();
