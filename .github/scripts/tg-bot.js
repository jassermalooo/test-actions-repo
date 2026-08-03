const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = '5653032481';
const GH_TOKEN = process.env.GITHUB_TOKEN; // GitHub Models (مجاني)
let offset = 0;

// ── Telegram helpers ────────────────────────────────────────────────────────

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
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMsg(text) {
  return tgRequest('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'Markdown' });
}

function sendPhoto(photoPath, caption) {
  return new Promise((resolve, reject) => {
    const boundary = 'FormBoundary' + Date.now();
    const fileData = fs.readFileSync(photoPath);
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n`,
      caption ? `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` : '',
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="screen.png"\r\nContent-Type: image/png\r\n\r\n`,
    ];
    const body = Buffer.concat([
      Buffer.from(parts.join('')),
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

// ── ADB helpers ─────────────────────────────────────────────────────────────

function adb(cmd) {
  try { return execSync(`adb ${cmd}`, { timeout: 15000 }).toString().trim(); }
  catch (e) { return `خطأ: ${e.message.slice(0, 100)}`; }
}

function screenshot() {
  adb('shell screencap -p /sdcard/screen.png');
  adb('pull /sdcard/screen.png /tmp/screen.png');
  return '/tmp/screen.png';
}

function screenToBase64() {
  const p = screenshot();
  return fs.readFileSync(p).toString('base64');
}

// ── Web Search (DuckDuckGo - مجاني بدون API) ────────────────────────────────

function webSearch(query) {
  return new Promise(resolve => {
    const q = encodeURIComponent(query);
    const req = https.request({
      hostname: 'api.duckduckgo.com',
      path: `/?q=${q}&format=json&no_html=1&skip_disambig=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const results = [];
          if (data.AbstractText) results.push(data.AbstractText);
          if (data.Answer) results.push(data.Answer);
          (data.RelatedTopics || []).slice(0, 3).forEach(t => {
            if (t.Text) results.push(t.Text);
          });
          resolve(results.join('\n') || 'لا توجد نتائج');
        } catch(e) { resolve('فشل البحث'); }
      });
    });
    req.on('error', () => resolve('فشل البحث'));
    req.end();
  });
}

// ── GitHub Models - Llama 3.2 Vision (مجاني) ────────────────────────────────

function askLlama(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'meta-llama-3.2-90b-vision-instruct',
      messages,
      temperature: 0.1,
      max_tokens: 800
    });
    const req = https.request({
      hostname: 'models.inference.ai.azure.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.choices) resolve(data.choices[0].message.content);
          else reject(new Error(JSON.stringify(data).slice(0, 200)));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function processCommand(userText) {
  // 1) التقط الشاشة
  const screenB64 = screenToBase64();

  // 2) هل يحتاج بحث ويب؟
  let searchContext = '';
  const needsSearch = /ابحث|بحث|وش هو|كيف|معلومات|اخبرني عن/i.test(userText);
  if (needsSearch) {
    searchContext = await webSearch(userText);
  }

  // 3) أرسل للنموذج مع الشاشة
  const systemPrompt = `أنت مساعد ذكي يتحكم في هاتف Android عبر ADB.
لديك قدرة على:
- رؤية شاشة الهاتف الحالية (مُرفقة معك)
- تنفيذ أوامر ADB
- البحث في الويب

قواعد الرد:
رد بـ JSON فقط بهذا الشكل بدون أي نص خارجه:
{
  "think": "ماذا أرى في الشاشة وماذا يريد المستخدم",
  "cmds": ["adb shell ..."],
  "reply": "رسالة قصيرة للمستخدم"
}

أوامر مفيدة:
- فتح تطبيق: adb shell monkey -p com.package.name -c android.intent.category.LAUNCHER 1
- Play Store: adb shell am start -a android.intent.action.VIEW -d 'market://details?id=com.package.name'
- ضغط: adb shell input tap X Y
- سحب: adb shell input swipe X1 Y1 X2 Y2 DURATION_MS
- كتابة: adb shell input text 'text'
- رجوع: adb shell input keyevent KEYCODE_BACK
- هوم: adb shell input keyevent KEYCODE_HOME
- فتح إعدادات: adb shell am start -a android.settings.SETTINGS
- فتح كروم برابط: adb shell am start -a android.intent.action.VIEW -d 'https://URL'
- screenshot فقط: ["__screenshot__"]
- بحث ويب فقط: ["__search__"]`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${screenB64}` }
        },
        {
          type: 'text',
          text: `أمر المستخدم: "${userText}"${searchContext ? `\n\nنتائج البحث:\n${searchContext}` : ''}`
        }
      ]
    }
  ];

  const raw = await askLlama(messages);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(cleaned.slice(start, end + 1));
}

// ── Main handler ─────────────────────────────────────────────────────────────

async function handleMessage(text) {
  if (text === '/start') {
    await sendMsg(`🤖 *أنا بوت Android الذكي!*\n\nأستطيع:\n👁 رؤية شاشة هاتفك\n📱 التحكم الكامل بالهاتف\n🔍 البحث في الويب\n\nأمثلة:\n• نزّل يوتيوب\n• افتح كروم وروح لـ google.com\n• ابحث عن سعر الذهب اليوم\n• خذ screenshot\n• ارجع للرئيسية\n• وش تشوف في الشاشة الحين؟`);
    return;
  }

  if (/^(screenshot|صورة|شاشة|وش تشوف|وش فالشاشة)/i.test(text)) {
    await sendMsg('📸 جاري التقاط الشاشة...');
    const path = screenshot();
    // أرسل للنموذج ليوصف ما يرى
    const screenB64 = fs.readFileSync(path).toString('base64');
    const desc = await askLlama([
      { role: 'system', content: 'أنت مساعد. صف ما تراه في شاشة الهاتف بالعربية باختصار.' },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenB64}` } },
        { type: 'text', text: 'وش تشوف في الشاشة؟' }
      ]}
    ]);
    await sendPhoto(path, desc.slice(0, 200));
    return;
  }

  await sendMsg('🧠 أشوف الشاشة وأفكر...');

  try {
    const result = await processCommand(text);
    console.log('[AI]', JSON.stringify(result));

    let screenshotSent = false;
    for (const cmd of result.cmds || []) {
      if (cmd === '__screenshot__') {
        const path = screenshot();
        await sendPhoto(path);
        screenshotSent = true;
      } else if (cmd === '__search__') {
        const sr = await webSearch(text);
        await sendMsg(`🔍 نتائج البحث:\n${sr.slice(0, 500)}`);
      } else {
        const rawCmd = cmd.replace(/^adb /, '');
        const out = adb(rawCmd);
        console.log(`[ADB] ${rawCmd} → ${out.slice(0, 80)}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // بعد تنفيذ الأوامر خذ screenshot تلقائي
    if (!screenshotSent && (result.cmds || []).length > 0) {
      await new Promise(r => setTimeout(r, 1500));
      const path = screenshot();
      await sendPhoto(path, `✅ ${result.reply}`);
    } else if (!screenshotSent) {
      await sendMsg(`✅ ${result.reply}`);
    }

  } catch (e) {
    console.error('[ERROR]', e.message);
    await sendMsg(`❌ ${e.message.slice(0, 200)}`);
  }
}

// ── Polling loop ─────────────────────────────────────────────────────────────

async function poll() {
  const res = await tgRequest('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
  if (res.ok && res.result?.length) {
    for (const upd of res.result) {
      offset = upd.update_id + 1;
      if (!upd.message) continue;
      if (String(upd.message.chat.id) !== CHAT_ID) continue;
      const text = upd.message.text || '';
      console.log(`[MSG] ${text}`);
      handleMessage(text).catch(e => console.error('[HANDLER]', e.message));
    }
  }
}

(async () => {
  console.log('🤖 Smart Android Bot started');
  await sendMsg('🚀 *Android Cloud جاهز!*\n\n👁 أنا أشوف شاشتك وأتحكم فيها\n🔍 أقدر أبحث في الويب\n\nأرسل /start');
  while (true) {
    try { await poll(); } catch (e) { console.error('[POLL]', e.message); await new Promise(r => setTimeout(r, 5000)); }
  }
})();
