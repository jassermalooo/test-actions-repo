const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = '5653032481';
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
      let raw = ''; res.on('data', d => raw += d);
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

// ── DuckDuckGo Search ────────────────────────────────────────────────────────

function webSearch(query) {
  return new Promise(resolve => {
    const q = encodeURIComponent(query);
    const req = https.request({
      hostname: 'api.duckduckgo.com',
      path: `/?q=${q}&format=json&no_html=1&skip_disambig=1`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, res => {
      let raw = ''; res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const results = [];
          if (data.AbstractText) results.push(data.AbstractText);
          if (data.Answer) results.push(data.Answer);
          (data.RelatedTopics || []).slice(0, 4).forEach(t => { if (t.Text) results.push('• ' + t.Text); });
          resolve(results.join('\n') || 'لا توجد نتائج');
        } catch(e) { resolve('فشل البحث'); }
      });
    });
    req.on('error', () => resolve('فشل البحث'));
    req.end();
  });
}

// ── Ollama Local AI (llava-phi3 — runs on GitHub Actions, no API key) ────────

function askAI(userText, imageBase64) {
  return new Promise((resolve, reject) => {
    const messages = [{
      role: 'user',
      content: userText,
      ...(imageBase64 ? { images: [imageBase64] } : {})
    }];

    const body = JSON.stringify({ model: 'llava-phi3', messages, stream: false });
    const req = http.request({
      hostname: 'localhost',
      port: 11434,
      path: '/api/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let raw = ''; res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.error) { reject(new Error(data.error)); return; }
          resolve(data.message?.content || 'لا يوجد رد');
        } catch(e) { reject(new Error('Failed to parse Ollama response: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an Android phone controller. When given a user command (in Arabic) and optionally a screenshot of the current screen, respond ONLY with a JSON object like this:

For ADB commands:
{"action":"adb","commands":["shell input tap 540 960","shell input keyevent 3"],"desc":"فتح الصفحة الرئيسية"}

For web search:
{"action":"search","query":"search term in arabic or english"}

For text reply:
{"action":"text","reply":"your reply in arabic"}

ADB reference:
- Tap: shell input tap X Y
- Type text: shell input text 'text'
- Home: shell input keyevent 3
- Back: shell input keyevent 4
- Recent: shell input keyevent 187
- Open Chrome: shell am start -n com.android.chrome/com.google.android.apps.chrome.Main
- Open YouTube: shell am start -n com.google.android.youtube/com.google.android.youtube.HomeActivity
- Open Play Store: shell am start -n com.android.vending/com.android.vending.AssetBrowserActivity
- Scroll down: shell input swipe 540 1200 540 400
- Swipe up: shell input swipe 540 400 540 1200

Always respond with valid JSON only. No extra text.`;

// ── Main command processor ────────────────────────────────────────────────────

async function processCommand(text) {
  let screenBase64 = null;
  try { screenBase64 = screenToBase64(); } catch(e) {}

  const prompt = SYSTEM_PROMPT + '\n\nUser command: ' + text;
  const aiReply = await askAI(prompt, screenBase64);

  // Parse JSON from response
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
    } catch(e) { await sendMsg('✅ تم التنفيذ'); }

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
  console.log('[MSG]', text);

  if (text === '/start') {
    await sendMsg(
      '🤖 *Android Cloud Bot*\n\n' +
      'بوت ذكي يتحكم في هاتف Android!\n\n' +
      '🧠 *النموذج:* llava-phi3 (محلي - بدون API)\n' +
      '🔍 *البحث:* DuckDuckGo مجاني\n\n' +
      '*أمثلة:*\n' +
      '📱 `افتح يوتيوب`\n' +
      '🌐 `افتح كروم`\n' +
      '🔍 `ابحث عن أفضل التطبيقات`\n' +
      '📸 `خذ screenshot`\n' +
      '🏠 `ارجع للرئيسية`\n' +
      '📦 `افتح متجر التطبيقات`'
    );
    return;
  }

  if (text === '/screen' || text === 'خذ screenshot' || text === 'screenshot') {
    try {
      await sendMsg('📸 جاري التقاط الشاشة...');
      const path = screenshot();
      await sendPhoto(path, '📱 شاشة الهاتف الحالية');
    } catch(e) { await sendMsg('❌ فشل التقاط الشاشة: ' + e.message); }
    return;
  }

  if (text === '/home' || text === 'ارجع للرئيسية') {
    adb('shell input keyevent 3');
    await sendMsg('🏠 تم الرجوع للرئيسية');
    return;
  }

  if (text === '/back' || text === 'ارجع') {
    adb('shell input keyevent 4');
    await sendMsg('↩️ تم الضغط Back');
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

// ── Polling ──────────────────────────────────────────────────────────────────

async function poll() {
  try {
    const res = await tgRequest('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    if (res.result?.length > 0) {
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
  console.log('🚀 Bot starting with Ollama llava-phi3 (local AI, no API needed)');
  try {
    await sendMsg('🤖 *Android Cloud Bot جاهز!*\n\nأرسل /start لمعرفة الأوامر 🚀\n\n🧠 النموذج: llava-phi3 (محلي 100%)');
  } catch(e) { console.error('Failed to send start message:', e.message); }
  poll();
})();
