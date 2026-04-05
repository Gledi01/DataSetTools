// src/index.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidStatusBroadcast,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const path = require('path');
const fs = require('fs');

const { initDatabase } = require('../database/db');
const { handleCommand } = require('./handlers/commandHandler');

const AUTH_FOLDER = path.join(__dirname, '../auth');
if (!fs.existsSync(AUTH_FOLDER)) fs.mkdirSync(AUTH_FOLDER, { recursive: true });

const logger = pino({ level: 'silent' });

// ─── Simple message store (pengganti makeInMemoryStore yang dihapus) ───
const msgStore = {};
function storeMessage(jid, msg) {
  if (!msgStore[jid]) msgStore[jid] = {};
  msgStore[jid][msg.key.id] = msg;
}
function getStoredMessage(jid, id) {
  return msgStore[jid]?.[id]?.message || undefined;
}

// ─── Custom key store (pengganti makeCacheableSignalKeyStore yang deprecated) ───
function makeCustomKeyStore(keys) {
  const cache = {};
  return {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const k = `${type}:${id}`;
        if (cache[k] !== undefined) {
          if (cache[k] !== null) data[id] = cache[k];
        } else {
          const val = await keys.get(type, [id]);
          const item = val?.[id] ?? null;
          cache[k] = item;
          if (item !== null) data[id] = item;
        }
      }
      return data;
    },
    set: async (data) => {
      for (const [type, ids] of Object.entries(data)) {
        for (const [id, val] of Object.entries(ids)) {
          cache[`${type}:${id}`] = val;
        }
      }
      await keys.set(data);
    },
    clear: () => { for (const k of Object.keys(cache)) delete cache[k]; },
  };
}

// ─── Resolve JID: handle @lid dengan pakai Alt field ───
function resolveJid(key) {
  const raw = key.participant || key.remoteJid;
  // Baileys terbaru: jika @lid, Alt berisi PN asli
  const alt = key.participantAlt || key.remoteJidAlt;
  if (raw?.endsWith('@lid') && alt) return jidNormalizedUser(alt);
  if (raw) return jidNormalizedUser(raw);
  return null;
}

function resolveChatId(key) {
  if (key.remoteJid?.endsWith('@lid') && key.remoteJidAlt) return key.remoteJidAlt;
  return key.remoteJid;
}

function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}

async function connectToWhatsApp() {
  initDatabase();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCustomKeyStore(state.keys),
    },
    generateHighQualityLinkPreview: false,
    browser: ['WA RPG Bot', 'Chrome', '1.0.0'],
    getMessage: async (key) => getStoredMessage(key.remoteJid, key.id),
  });

  sock.ev.on('creds.update', saveCreds);

  // Simpan pesan masuk ke store lokal
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (msg.key?.remoteJid) storeMessage(msg.key.remoteJid, msg);
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const QRCode = require('qrcode');
        const str = await QRCode.toString(qr, { type: 'terminal', small: true });
        console.log(str);
      } catch {
        console.log('QR:', qr);
      }
      console.log('📱 Scan QR di atas!');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('❌ Koneksi terputus, kode:', code, '| Reconnect:', shouldReconnect);
      if (shouldReconnect) setTimeout(() => connectToWhatsApp(), 5000);
      else console.log('🚫 Logged out. Hapus folder auth/ dan restart.');
    } else if (connection === 'open') {
      console.log('✅ Bot WhatsApp RPG berhasil terhubung!');
      console.log('🎮 Bot siap menerima perintah.\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;
        if (!msg.key.remoteJid) continue;
        if (isJidBroadcast(msg.key.remoteJid)) continue;
        if (isJidStatusBroadcast(msg.key.remoteJid)) continue;

        const senderJid = resolveJid(msg.key);
        const chatId = resolveChatId(msg.key);

        if (!senderJid || !chatId) continue;

        const text = extractText(msg);
        if (!text) continue;

        console.log(`📩 [${new Date().toLocaleTimeString()}] ${senderJid.split('@')[0]}: ${text.slice(0, 60)}`);

        if (!text.startsWith('.')) continue;

        // Override key agar handler baca JID resolved
        if (msg.key.participant) msg.key.participant = senderJid;
        msg.key.remoteJid = chatId;

        await handleCommand(sock, msg, text);

      } catch (err) {
        console.error('❌ Error:', err.message, '\n', err.stack);
      }
    }
  });

  return sock;
}

connectToWhatsApp().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => console.error('❌ Uncaught:', err.message));
process.on('unhandledRejection', (r) => console.error('❌ Rejection:', r?.message || r));
