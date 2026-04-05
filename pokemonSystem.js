// src/systems/pokemonSystem.js
const { db } = require('../../database/db');
const { fetchPokemon, fetchMove } = require('../utils/pokeapi');
const { getTypeEmoji, hpBar, randInt, calcStat, calcHP } = require('../utils/helpers');

function createPokemonFromApi(apiData, level = 5) {
  // Gunakan formula Gen III resmi (Bulbapedia)
  // IV random 0-31 untuk wild, 15 untuk starter (rata-rata bagus)
  const iv = { hp: randInt(0,31), atk: randInt(0,31), def: randInt(0,31), spa: randInt(0,31), spd: randInt(0,31), spe: randInt(0,31) };

  const maxHp  = calcHP(apiData.stats.hp, level, iv.hp);
  const attack = calcStat(apiData.stats.attack, level, iv.atk);
  const defense = calcStat(apiData.stats.defense, level, iv.def);
  const spAtk  = calcStat(apiData.stats.sp_attack, level, iv.spa);
  const spDef  = calcStat(apiData.stats.sp_defense, level, iv.spd);
  const speed  = calcStat(apiData.stats.speed, level, iv.spe);

  // Pick moves yang bisa dipelajari sampai level ini
  const learnedMoves = apiData.moves
    .filter(m => m.level_learned <= level || m.level_learned === 0)
    .slice(0, 4)
    .map(m => m.name);

  if (learnedMoves.length === 0) learnedMoves.push('tackle', 'scratch', 'pound');

  return {
    pokemon_id: apiData.id,
    name: apiData.name,
    level,
    exp: 0,
    hp: maxHp,
    max_hp: maxHp,
    attack,
    defense,
    sp_attack: spAtk,
    sp_defense: spDef,
    speed,
    types: JSON.stringify(apiData.types),
    abilities: JSON.stringify(apiData.abilities.map(a => a.name)),
    moves: JSON.stringify(learnedMoves),
    sprite_url: apiData.sprites.official || apiData.sprites.front,
    is_shiny: Math.random() < 0.001 ? 1 : 0,
    base_stats: JSON.stringify(apiData.stats), // simpan base stats untuk battle
  };
}

function savePokemon(ownerJid, pokemonData) {
  const stmt = db.prepare(`
    INSERT INTO user_pokemon
    (owner_jid, pokemon_id, name, level, exp, hp, max_hp, attack, defense, sp_attack, sp_defense, speed, types, abilities, moves, sprite_url, is_shiny)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    ownerJid,
    pokemonData.pokemon_id,
    pokemonData.name,
    pokemonData.level,
    pokemonData.exp,
    pokemonData.hp,
    pokemonData.max_hp,
    pokemonData.attack,
    pokemonData.defense,
    pokemonData.sp_attack,
    pokemonData.sp_defense,
    pokemonData.speed,
    pokemonData.types,
    pokemonData.abilities,
    pokemonData.moves,
    pokemonData.sprite_url || null,
    pokemonData.is_shiny || 0,
  );

  return result.lastInsertRowid;
}

function getUserPokemon(jid, limit = 20, offset = 0) {
  return db.prepare(`
    SELECT * FROM user_pokemon WHERE owner_jid = ? ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(jid, limit, offset);
}

function getPokemonById(id) {
  return db.prepare('SELECT * FROM user_pokemon WHERE id = ?').get(id);
}

function getPokemonByOwnerAndId(ownerId, pokemonRowId) {
  return db.prepare('SELECT * FROM user_pokemon WHERE id = ? AND owner_jid = ?').get(pokemonRowId, ownerId);
}

function getActivePokemon(jid) {
  const user = db.prepare('SELECT active_pokemon_id FROM users WHERE jid = ?').get(jid);
  if (!user?.active_pokemon_id) {
    // Auto-select first pokemon
    const first = db.prepare('SELECT * FROM user_pokemon WHERE owner_jid = ? LIMIT 1').get(jid);
    if (first) {
      db.prepare('UPDATE users SET active_pokemon_id = ? WHERE jid = ?').run(first.id, jid);
      return first;
    }
    return null;
  }
  return db.prepare('SELECT * FROM user_pokemon WHERE id = ?').get(user.active_pokemon_id);
}

function setActivePokemon(jid, pokemonId) {
  db.prepare('UPDATE users SET active_pokemon_id = ? WHERE jid = ?').run(pokemonId, jid);
}

function healPokemon(pokemonId, amount = 9999) {
  const pk = getPokemonById(pokemonId);
  if (!pk) return;
  const newHp = Math.min(pk.max_hp, pk.hp + amount);
  db.prepare('UPDATE user_pokemon SET hp = ? WHERE id = ?').run(newHp, pokemonId);
}

function updatePokemonHp(pokemonId, hp) {
  db.prepare('UPDATE user_pokemon SET hp = MAX(0, MIN(max_hp, ?)) WHERE id = ?').run(hp, pokemonId);
}

function addPokemonExp(pokemonId, exp) {
  const pk = getPokemonById(pokemonId);
  if (!pk) return null;
  const newExp = pk.exp + exp;
  const newLevel = Math.min(100, Math.floor(newExp / 100) + 1);
  db.prepare('UPDATE user_pokemon SET exp = ?, level = ? WHERE id = ?').run(newExp, newLevel, pokemonId);

  const leveled = newLevel > pk.level;
  if (leveled) {
    // Recalculate stats on level up
    const hpIncrease = Math.floor(randInt(3, 8));
    const atkIncrease = Math.floor(randInt(1, 4));
    db.prepare(`UPDATE user_pokemon SET
      max_hp = max_hp + ?, hp = hp + ?,
      attack = attack + ?, defense = defense + ?,
      sp_attack = sp_attack + ?, sp_defense = sp_defense + ?,
      speed = speed + ?
      WHERE id = ?
    `).run(hpIncrease, hpIncrease, atkIncrease, randInt(1,3), randInt(1,4), randInt(1,3), randInt(1,3), pokemonId);
  }

  return { newExp, newLevel, leveled };
}

function formatPokedexEntry(pokemon, apiData = null) {
  const types = JSON.parse(pokemon.types || '[]');
  const abilities = JSON.parse(pokemon.abilities || '[]');
  const moves = JSON.parse(pokemon.moves || '[]');
  const typeStr = types.map(t => `${getTypeEmoji(t)} ${t}`).join(', ');
  const shinyBadge = pokemon.is_shiny ? '✨ SHINY! ' : '';

  return `
╔══════════════════════╗
║ ${shinyBadge}#${String(pokemon.pokemon_id).padStart(3,'0')} ${pokemon.nickname || pokemon.name.toUpperCase()}
╠══════════════════════╣
║ 🔹 Tipe    : ${typeStr}
║ ⚔️  ATK    : ${pokemon.attack}
║ 🛡️  DEF    : ${pokemon.defense}
║ 🌟 SP.ATK  : ${pokemon.sp_attack}
║ 💠 SP.DEF  : ${pokemon.sp_defense}
║ 💨 SPEED   : ${pokemon.speed}
║ ❤️  HP     : ${hpBar(pokemon.hp, pokemon.max_hp)}
║ 📊 Level   : ${pokemon.level} | EXP: ${pokemon.exp}
║ 🎯 Skill   : ${moves.slice(0,4).join(', ')}
║ 💡 Ability : ${abilities[0] || 'Unknown'}
╚══════════════════════╝`.trim();
}

function formatPokemonList(pokemonList) {
  if (!pokemonList.length) return '📭 Pokedex kosong. Tangkap Pokemon dulu!';
  return pokemonList.map((pk, i) => {
    const types = JSON.parse(pk.types || '[]');
    const typeEmojis = types.map(t => getTypeEmoji(t)).join('');
    const shiny = pk.is_shiny ? '✨' : '';
    return `${i+1}. ${shiny}#${String(pk.pokemon_id).padStart(3,'0')} *${(pk.nickname || pk.name).toUpperCase()}* Lv.${pk.level} ${typeEmojis} ❤️${pk.hp}/${pk.max_hp}`;
  }).join('\n');
}

module.exports = {
  createPokemonFromApi, savePokemon, getUserPokemon,
  getPokemonById, getPokemonByOwnerAndId, getActivePokemon,
  setActivePokemon, healPokemon, updatePokemonHp,
  addPokemonExp, formatPokedexEntry, formatPokemonList
};
