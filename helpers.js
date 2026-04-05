// src/utils/helpers.js

/**
 * Normalize JID - handle both @s.whatsapp.net and @lid formats
 */
function normalizeJid(jid) {
  if (!jid) return null;
  const clean = jid.replace(/:[0-9]+@/, '@');
  if (clean.endsWith('@lid')) return clean.replace('@lid', '@s.whatsapp.net');
  return clean;
}

function jidToPhone(jid) {
  if (!jid) return 'Unknown';
  return normalizeJid(jid).split('@')[0];
}

function formatMention(jid) { return `@${jidToPhone(jid)}`; }

function getSender(msg) {
  return normalizeJid(msg.key?.participant || msg.key?.remoteJid);
}

function isGroup(msg) { return msg.key?.remoteJid?.endsWith('@g.us'); }
function getChatId(msg) { return msg.key?.remoteJid; }

// ─── RANK SYSTEM ───
const RANKS = [
  { name: '⚔️ Warrior',         min: 0,     max: 999   },
  { name: '🥈 Letnan',           min: 1000,  max: 4999  },
  { name: '🥇 Letnan ★★',        min: 5000,  max: 14999 },
  { name: '💎 Letnan ★★★',       min: 15000, max: 29999 },
  { name: '🔷 Letnan ★★★★',      min: 30000, max: 49999 },
  { name: '🔶 Letnan ★★★★★',     min: 50000, max: 74999 },
  { name: '🎖️ Jendral',          min: 75000, max: 89999 },
  { name: '👑 Champion',          min: 90000, max: 100000},
];

function getRank(exp) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (exp >= RANKS[i].min) return RANKS[i].name;
  }
  return RANKS[0].name;
}

function getLevel(exp) { return Math.min(100, Math.floor(exp / 1000) + 1); }

function getExpToNextRank(exp) {
  for (const rank of RANKS) {
    if (exp < rank.max) return rank.max - exp;
  }
  return 0;
}

// ─── STATUS BAR ───
function formatStatusBar(user) {
  if (!user) return '';
  const badges = JSON.parse(user.badges || '[]');
  const badgeDisplay = badges.length > 0 ? badges.map(b => b.emoji || '🏅').join('') : 'Belum ada';
  const rank = getRank(user.exp);
  const level = getLevel(user.exp);

  return `╔════════════════════╗
║ 👤 *${user.name}*
║ 📊 Lv.${level} | EXP: ${user.exp}
║ 🏆 Rank: ${rank}
║ 💰 Koin: ${user.coins.toLocaleString()}
║ 📍 Region: ${user.region}
║ 🎖️ Badge: ${badgeDisplay} (${badges.length})
║ 🐾 Pokemon: ${user.pokemon_count || 0} | 🦖 Digimon: ${user.digimon_count || 0}
║ ⭐ Starter: ${user.starter_name || 'Belum dipilih'}
╚════════════════════╝`;
}

// ─── TYPE EMOJI ───
const TYPE_EMOJI = {
  normal: '⬜', fire: '🔥', water: '💧', electric: '⚡',
  grass: '🌿', ice: '❄️', fighting: '🥊', poison: '☠️',
  ground: '🏜️', flying: '🌬️', psychic: '🔮', bug: '🐛',
  rock: '🪨', ghost: '👻', dragon: '🐉', dark: '🌑',
  steel: '⚙️', fairy: '🌸'
};

function getTypeEmoji(type) { return TYPE_EMOJI[type?.toLowerCase()] || '❓'; }

// ─── HP BAR ───
function hpBar(current, max) {
  const pct = Math.max(0, Math.min(1, current / Math.max(1, max)));
  const filled = Math.round(pct * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const color = pct > 0.5 ? '🟩' : pct > 0.2 ? '🟨' : '🟥';
  return `${color} [${bar}] ${current}/${max}`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── POKEMON GEN III STAT FORMULAS (Bulbapedia) ───

/**
 * Hitung stat aktual Gen III
 * Formula: floor((floor((2*Base + IV + floor(EV/4)) * Level / 100) + 5) * Nature)
 * Default: IV=15 (bagus tapi bukan perfect), EV=0, Nature=1.0 (netral)
 */
function calcStat(baseStat, level, iv = 15, ev = 0, nature = 1.0) {
  return Math.floor(
    (Math.floor((2 * baseStat + iv + Math.floor(ev / 4)) * level / 100) + 5) * nature
  );
}

/**
 * Hitung HP aktual Gen III (formula berbeda dari stat lain)
 * HP = floor((2*Base + IV + floor(EV/4)) * Level / 100) + Level + 10
 */
function calcHP(baseHP, level, iv = 15, ev = 0) {
  return Math.floor((2 * baseHP + iv + Math.floor(ev / 4)) * level / 100) + level + 10;
}

/**
 * Damage formula Gen III / Emerald (dari Bulbapedia)
 * Damage = floor(floor(floor(floor(2*Level/5 + 2) * Power * A/D / 50 + 2) * STAB) * Type * Random)
 * Random = roll 217-255, dibagi 255
 * Critical = 2x damage, ignore stat stages
 */
function calcDamageGen3(level, atk, def, power, typeMult = 1, stab = false, critical = false) {
  if (typeMult === 0) return 0;
  if (power === 0) return 0;

  // Base damage
  const baseDmg = Math.floor(
    Math.floor(2 * level / 5 + 2) * power * Math.max(1, atk) / Math.max(1, def) / 50
  ) + 2;

  // Critical hit (2x di Gen I-IV)
  const afterCrit = critical ? baseDmg * 2 : baseDmg;

  // Random 217-255 / 255
  const randomRoll = randInt(217, 255) / 255;
  const afterRandom = Math.floor(afterCrit * randomRoll);

  // STAB: 1.5x
  const afterStab = stab ? Math.floor(afterRandom * 1.5) : afterRandom;

  // Type effectiveness
  const finalDmg = Math.floor(afterStab * typeMult);

  return Math.max(1, finalDmg);
}

/**
 * Critical hit check Gen III: 1/16 chance normal move
 */
function isCriticalHit(highCritRatio = false) {
  // Gen III: threshold dari 256. Normal = 16/256, high crit = 64/256
  return randInt(1, 256) <= (highCritRatio ? 64 : 16);
}

/**
 * Check STAB (Same Type Attack Bonus)
 */
function checkSTAB(moveType, pokemonTypes) {
  if (!moveType || !pokemonTypes) return false;
  return pokemonTypes.some(t => t.toLowerCase() === moveType.toLowerCase());
}

/**
 * Catch rate formula Gen III
 * CatchValue = ((3*MaxHP - 2*CurrentHP) * Rate * BallBonus) / (3*MaxHP)
 * Caught if random(0-255) <= CatchValue/4
 */
function calcCatchRate(catchRate, ballMultiplier, currentHp, maxHp) {
  const catchValue = Math.floor(((3 * maxHp - 2 * currentHp) * catchRate * ballMultiplier) / (3 * maxHp));
  const check = randInt(0, 255);
  return check <= Math.floor(catchValue / 4);
}

// ─── TYPE EFFECTIVENESS ───
const TYPE_CHART = {
  fire:     { grass:2, ice:2, bug:2, steel:2, water:0.5, fire:0.5, rock:0.5, dragon:0.5 },
  water:    { fire:2, ground:2, rock:2, water:0.5, grass:0.5, dragon:0.5 },
  grass:    { water:2, ground:2, rock:2, fire:0.5, grass:0.5, poison:0.5, flying:0.5, bug:0.5, dragon:0.5, steel:0.5 },
  electric: { water:2, flying:2, grass:0.5, electric:0.5, dragon:0.5, ground:0 },
  normal:   { rock:0.5, steel:0.5, ghost:0 },
  rock:     { fire:2, ice:2, flying:2, bug:2, fighting:0.5, ground:0.5, steel:0.5 },
  ground:   { fire:2, electric:2, poison:2, rock:2, steel:2, grass:0.5, bug:0.5, flying:0 },
  ghost:    { psychic:2, ghost:2, normal:0, dark:0.5 },
  ice:      { grass:2, ground:2, flying:2, dragon:2, fire:0.5, water:0.5, ice:0.5, steel:0.5 },
  dragon:   { dragon:2, steel:0.5, fairy:0 },
  psychic:  { fighting:2, poison:2, psychic:0.5, steel:0.5, dark:0 },
  poison:   { grass:2, fairy:2, poison:0.5, ground:0.5, rock:0.5, ghost:0.5, steel:0 },
  flying:   { grass:2, fighting:2, bug:2, electric:0.5, rock:0.5, steel:0.5 },
  bug:      { grass:2, psychic:2, dark:2, fire:0.5, fighting:0.5, flying:0.5, ghost:0.5, steel:0.5, fairy:0.5 },
  fighting: { normal:2, ice:2, rock:2, dark:2, steel:2, poison:0.5, bug:0.5, psychic:0.5, flying:0.5, fairy:0.5, ghost:0 },
  steel:    { ice:2, rock:2, fairy:2, fire:0.5, water:0.5, electric:0.5, steel:0.5 },
  dark:     { psychic:2, ghost:2, fighting:0.5, dark:0.5, fairy:0.5 },
  fairy:    { fighting:2, dragon:2, dark:2, fire:0.5, poison:0.5, steel:0.5 },
};

function getTypeMultiplier(moveType, defenderTypes) {
  let mult = 1;
  const chart = TYPE_CHART[moveType?.toLowerCase()] || {};
  for (const t of (defenderTypes || [])) {
    mult *= chart[t?.toLowerCase()] ?? 1;
  }
  return mult;
}

function effectivenessText(mult) {
  if (mult === 0)    return '❌ *Tidak berpengaruh!*';
  if (mult >= 4)     return '⚡⚡ *Super Efektif banget!!*';
  if (mult >= 2)     return '⚡ *Super Efektif!*';
  if (mult <= 0.25)  return '🛡️🛡️ *Sangat Tidak Efektif...*';
  if (mult <= 0.5)   return '🛡️ *Tidak Efektif...*';
  return '';
}

// ─── DIGIMON ───
const DIGI_STAGE = {
  'Fresh':'🥚', 'In-Training':'🐣', 'Rookie':'🐤',
  'Champion':'🦅', 'Ultimate':'🦁', 'Mega':'🐲'
};
function getDigiStageEmoji(stage) { return DIGI_STAGE[stage] || '🔮'; }

module.exports = {
  normalizeJid, jidToPhone, formatMention, getSender,
  isGroup, getChatId, formatStatusBar, getRank, getLevel,
  getExpToNextRank, RANKS, TYPE_EMOJI, getTypeEmoji,
  hpBar, randInt,
  // Gen III formulas
  calcStat, calcHP, calcDamageGen3, isCriticalHit, checkSTAB, calcCatchRate,
  // kept for backward compat di file lain
  calcDamage: calcDamageGen3,
  getTypeMultiplier, effectivenessText, getDigiStageEmoji,
};
