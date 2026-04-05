// src/index.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
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

// InMemoryStore — handle message store + LID mapping otomatis
const store = makeInMemoryStore({ logger });
store.readFromFile('./baileys_store.json');
setInterval(() => store.writeToFile('./baileys_store.json'), 10_000);

/**
 * Resolve JID: gunakan remoteJidAlt jika participant adalah @lid
 * Sesuai dokumentasi Baileys terbaru — jangan konvert, pakai Alt field
 */
function resolveJid(msg) {
  const key = msg.key;
  // Di grup: participant bisa @lid, Alt-nya adalah PN
  const raw = key.participant || key.remoteJid;
  // remoteJidAlt tersedia di Baileys terbaru sebagai PN fallback
  const alt = key.participantAlt || key.remoteJidAlt;

  if (raw && raw.endsWith('@lid') && alt) {
    return jidNormalizedUser(alt);
  }
  if (raw) {
    return jidNormalizedUser(raw);
  }
  return null;
}

function resolveChatId(msg) {
  const jid = msg.key.remoteJid;
  // Kalau remoteJid adalah @lid, pakai Alt
  if (jid && jid.endsWith('@lid') && msg.key.remoteJidAlt) {
    return msg.key.remoteJidAlt;
  }
  return jid;
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
    auth: state,
    generateHighQualityLinkPreview: false,
    browser: ['WA RPG Bot', 'Chrome', '1.0.0'],
    getMessage: async (key) => {
      const msg = await store.loadMessage(key.remoteJid, key.id);
      return msg?.message || undefined;
    },
  });

  // Bind store ke socket — ini yang handle LID mapping otomatis
  store.bind(sock.ev);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const QRCode = require('qrcode');
      const qrString = await QRCode.toString(qr, { type: 'terminal', small: true });
      console.log(qrString);
      console.log('📱 Scan QR di atas!');
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log('❌ Koneksi terputus, kode:', code, '| Reconnect:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 5000);
      } else {
        console.log('🚫 Logged out. Hapus folder auth/ dan restart.');
      }
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

        const senderJid = resolveJid(msg);
        const chatId = resolveChatId(msg);

        if (!senderJid || !chatId) continue;

        const text = extractText(msg);
        if (!text) continue;

        console.log(`📩 [${new Date().toLocaleTimeString()}] ${senderJid.split('@')[0]} → ${chatId.split('@')[0]}: ${text.slice(0, 60)}`);

        if (!text.startsWith('.')) continue;

        // Override key biar handleCommand baca JID yang sudah resolved
        if (msg.key.participant) msg.key.participant = senderJid;
        msg.key.remoteJid = chatId;

        await handleCommand(sock, msg, text);

      } catch (err) {
        console.error('❌ Error handle message:', err.message, err.stack);
      }
    }
  });

  return sock;
}

connectToWhatsApp().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Rejection:', reason?.message || reason);
});
