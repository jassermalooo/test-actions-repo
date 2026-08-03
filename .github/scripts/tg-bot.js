const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = '5653032481';
const GH_TOKEN = process.env.GITHUB_TOKEN; // GitHub Models مجاني
let offset = 0;

// ── Telegram helpers ─────────────────────────────────────────────────────────

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
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── ADB helpers ──────────────────────────────────────────────────────────────

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

// ── DuckDuckGo Search (مجاني بدون API) ──────────────────────────────────────

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
          (data.RelatedTopics || []).slice(0, 4).forEach(t => {
            if (t.Text) results.push('• ' + t.Text);
          });
          resolve(results.join('\n') || 'لا توجد نتائج');
        } catch(e) { resolve('فشل البحث'); }
      });
    });
    req.on('error', () => resolve('فشل البحث'));
    req.end();
  });
}

// ── GitHub Models - Llama 3.2 Vision 90B (مجاني) ────────────────────────────

function askLlama(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'Llama-3.2-11B-Vision-Instruct',
      messages,
      max_tokens: 1024,
      temperature: 0.3
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
          if (data.error) { reject(new Error(data.error.message || JSON.stringify(data.error))); return; }
          resolve(data.choices?.[0]?.message?.content || 'لا يوجد رد');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `أنت مساعد ذكي متخصص في التحكم بهاتف Android عبر ADB.
لديك القدرة على رؤية شاشة الهاتف وتنفيذ أوامر ADB.

عند تلقي طلب المستخدم، انظر إلى الشاشة وحدد الإجراء المناسب.
ردك يجب أن يكون بصيغة JSON حصراً في الحالات التالية:

للبحث في الإنترنت:
{"action":"search","query":"استعلام البحث"}

لتنفيذ أوامر ADB:
{"action":"adb","commands":["shell input tap 540 960","shell input keyevent 3"],"desc":"وصف ما سيتم فعله"}

للرد النصي فقط (أسئلة عامة لا تحتاج للهاتف):
{"action":"text","reply":"ردك هنا"}

أوامر ADB المفيدة:
- النقر: shell input tap X Y
- الكتابة: shell input text 'النص'
- Home: shell input keyevent 3
- Back: shell input keyevent 4
- Recent: shell input keyevent 187
- تمرير لأسفل: shell input swipe 540 1200 540 400
- تمرير لأعلى: shell input swipe 540 400 540 1200
- فتح تطبيق: shell monkey -p com.package.name -c android.intent.category.LAUNCHER 1
- إدخال URL: shell am start -a android.intent.action.VIEW -d 'https://...'
`;

// ── Main AI processor ────────────────────────────────────────────────────────

async function processCommand(text) {
  let screenBase64 = null;
  try { screenBase64 = screenToBase64(); } catch(e) { /* emulator might not be ready */ }

  const userContent = screenBase64
    ? [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${screenBase64}` } },
        { type: 'text', text: `الشاشة الحالية للهاتف. طلب المستخدم: ${text}` }
      ]
    : text;

  const aiReply = await askLlama([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ]);

  // Parse JSON response
  const jsonMatch = aiReply.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    await sendMsg(aiReply);
    return;
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (parsed.action === 'search') {
    await sendMsg(`🔍 جاري البحث: *${parsed.query}*`);
    const res = await webSearch(parsed.query);
    await sendMsg(`📋 *نتائج البحث:*\n${res}`);

  } else if (parsed.action === 'adb') {
    await sendMsg(`⚙️ ${parsed.desc || 'جاري التنفيذ...'}`);
    for (const cmd of parsed.commands) {
      adb(cmd);
      await new Promise(r => setTimeout(r, 700));
    }
    await new Promise(r => setTimeout(r, 1500));
    try {
      const after = screenshot();
      await sendPhoto(after, '✅ تم التنفيذ');
    } catch(e) {
      await sendMsg('✅ تم التنفيذ');
    }

  } else if (parsed.action === 'text') {
    await sendMsg(parsed.reply);

  } else {
    await sendMsg(aiReply);
  }
}

// ── Command Handlers ─────────────────────────────────────────────────────────

async function handleMessage(msg) {
  const text = (msg.text || '').trim();
  if (!text) return;

  console.log(`[MSG] ${text}`);

  if (text === '/start') {
    await sendMsg(
      '🤖 *Android Cloud Bot*\n\n' +
      'بوت ذكي يتحكم في هاتف Android بالذكاء الاصطناعي 🧠\n\n' +
      '*النموذج:* Llama 3.2 Vision 90B (يرى الشاشة)\n' +
      '*البحث:* DuckDuckGo مجاني\n\n' +
      '*أمثلة على الأوامر:*\n' +
      '📱 `افتح يوتيوب`\n' +
      '🔍 `ابحث عن أفضل تطبيقات 2025`\n' +
      '📸 `خذ screenshot`\n' +
      '🏠 `ارجع للرئيسية`\n' +
      '⬇️ `نزّل تطبيق واتساب`\n' +
      '💬 `اكتب مرحبا في محقل البحث`\n' +
      '❓ `ما هو الطقس في الرياض اليوم؟`'
    );
    return;
  }

  if (text === '/screen' || text === 'خذ screenshot' || text === 'screenshot') {
    try {
      await sendMsg('📸 جاري التقاط الشاشة...');
      const path = screenshot();
      await sendPhoto(path, '📱 شاشة الهاتف الحالية');
    } catch(e) {
      await sendMsg('❌ فشل التقاط الشاشة: ' + e.message);
    }
    return;
  }

  if (text === '/home' || text === 'ارجع للرئيسية') {
    adb('shell input keyevent 3');
    await sendMsg('🏠 تم الرجوع للرئيسية');
    return;
  }

  if (text === '/back' || text === 'ارجع') {
    adb('shell input keyevent 4');
    await sendMsg('↩️ تم الضغط على Back');
    return;
  }

  if (text === '/recent' || text === 'آخر التطبيقات') {
    adb('shell input keyevent 187');
    await sendMsg('📋 تم فتح آخر التطبيقات');
    return;
  }

  // AI handles everything else
  await sendMsg('🤔 جاري التحليل...');
  try {
    await processCommand(text);
  } catch(e) {
    console.error('Error:', e.message);
    await sendMsg('❌ خطأ: ' + e.message);
  }
}

// ── Polling Loop ─────────────────────────────────────────────────────────────

async function poll() {
  try {
    const res = await tgRequest('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    if (res.result && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message && String(update.message.chat.id) === CHAT_ID) {
          await handleMessage(update.message).catch(e => console.error('Handler error:', e.message));
        }
      }
    }
  } catch(e) {
    console.error('Poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  setImmediate(poll);
}

// ── Start ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🚀 Telegram Bot starting - Llama 3.2 Vision + DuckDuckGo');
  try {
    await sendMsg('🤖 *Android Cloud Bot جاهز!*\n\nأرسل /start لمعرفة الأوامر المتاحة 🚀');
  } catch(e) {
    console.error('Failed to send start message:', e.message);
  }
  poll();
})();
