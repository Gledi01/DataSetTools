const axios = require("axios")

const TokenBot = "AAHvnbvO5HRkJbtM19QhN4nFzR7gyZEOr1o"
const OwnerId = "8104800185"

async function CekError(text) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TokenBot}/sendMessage`,
      {
        chat_id: OwnerId, // ← FIX DI SINI
        text,
        parse_mode: "HTML"
      }
    )
  } catch (err) {
    console.log("Gagal kirim ke Telegram:", err.response?.data || err.message)
  }
}

module.exports = { CekError }
