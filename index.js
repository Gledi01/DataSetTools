// src/index.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidStatusBroadcast,
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const path = require('path');
const fs = require('fs');

const { initDatabase } = require('../database/db');
const { handleCommand } = require('./handlers/commandHandler');
const { normalizeJid, getChatId } = require('./utils/helpers');

// Auth state folder
const AUTH_FOLDER = path.join(__dirname, '../auth');
if (!fs.existsSync(AUTH_FOLDER)) fs.mkdirSync(AUTH_FOLDER, { recursive: true });

// Logger (suppress verbose Baileys logs)
const logger = pino({ level: 'silent' });

/**
 * Custom in-memory signal key store (pengganti makeCacheableSignalKeyStore yang deprecated).
 */
function makeCustomKeyStore(keys) {
  const cache = {};
  return {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const cacheKey = `${type}:${id}`;
        if (cache[cacheKey] !== undefined) {
          data[id] = cache[cacheKey];
        } else {
          const val = await keys.get(type, [id]);
          const item = val?.[id];
          cache[cacheKey] = item ?? null;
          if (item !== undefined && item !== null) data[id] = item;
        }
      }
      return data;
    },
    set: async (data) => {
      for (const [type, ids] of Object.entries(data)) {
        for (const [id, value] of Object.entries(ids)) {
          cache[`${type}:${id}`] = value;
        }
      }
      await keys.set(data);
    },
    clear: () => {
      for (const key of Object.keys(cache)) delete cache[key];
    },
  };
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
    getMessage: async () => undefined,
  });

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
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('❌ Koneksi terputus. Reconnect:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(), 5000);
      } else {
        console.log('🚫 Logged out. Hapus folder auth/ dan restart bot.');
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
        if (isJidBroadcast(msg.key.remoteJid)) continue;
        if (isJidStatusBroadcast(msg.key.remoteJid)) continue;
        if (msg.key.fromMe) continue;

        // Resolve @lid ke @s.whatsapp.net
        const senderRaw = msg.key.participant || msg.key.remoteJid;
        if (!senderRaw) continue;

        let resolvedJid = senderRaw;
        if (senderRaw.endsWith('@lid')) {
          const contact = sock.contacts?.[senderRaw];
          if (contact?.id) {
            resolvedJid = contact.id;
          } else {
            resolvedJid = senderRaw.replace('@lid', '@s.whatsapp.net');
          }
        }

        // Override JID di msg agar semua handler baca yang sudah resolved
        if (msg.key.participant) msg.key.participant = resolvedJid;
        else msg.key.remoteJid = resolvedJid;

        // Extract message text
        const msgText = extractMessageText(msg);
        if (!msgText) continue;

        // Log incoming
        const sender = normalizeJid(resolvedJid);
        const chatId = getChatId(msg);
        console.log(`📩 [${new Date().toLocaleTimeString()}] ${sender?.split('@')[0]}: ${msgText.slice(0, 60)}`);

        // Handle commands (starts with .)
        if (msgText.startsWith('.')) {
          await handleCommand(sock, msg, msgText);
        }

      } catch (err) {
        console.error('❌ Error handling message:', err.message);
      }
    }
  });

  return sock;
}

function extractMessageText(msg) {
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

connectToWhatsApp().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason?.message || reason);
});
