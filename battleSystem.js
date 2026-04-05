// src/systems/battleSystem.js
const { db } = require('../../database/db');
const { getActivePokemon, updatePokemonHp, addPokemonExp } = require('./pokemonSystem');
const { getActiveDigimon, updateDigimonHp, addDigimonExp, increaseBond } = require('./digimonSystem');
const { addCoins, addExp, getUser, removeCoins } = require('./userSystem');
const { calcDamageGen3, calcStat, calcHP, getTypeMultiplier, effectivenessText, hpBar, randInt, checkSTAB, isCriticalHit } = require('../utils/helpers');
const { fetchMove } = require('../utils/pokeapi');
const { v4: uuid } = require('crypto');

// Active battles storage (in-memory + DB)
const activeBattles = new Map();

function generateBattleId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

async function startWildBattle(jid, wildPokemon, location, chatId) {
  const userPk = getActivePokemon(jid);
  if (!userPk) return null;

  const parseTypes = (t) => {
    if (!t) return [];
    if (Array.isArray(t)) return t;
    try { return JSON.parse(t); } catch { return [t]; }
  };
  const parseMoves = (m) => {
    if (!m) return [];
    if (Array.isArray(m)) return m;
    try { return JSON.parse(m); } catch { return [m]; }
  };

  const battleId = generateBattleId();
  const battle = {
    id: battleId,
    type: 'wild',
    jid,
    chatId,
    location,
    turn: 1,
    state: 'active',
    userPokemon: {
      ...userPk,
      types: parseTypes(userPk.types),
      moves: parseMoves(userPk.moves),
    },
    wildPokemon: {
      ...wildPokemon,
      types: parseTypes(wildPokemon.types),
      moves: parseMoves(wildPokemon.moves),
      currentHp: wildPokemon.max_hp,
      isCaught: false,
    },
    phase: 'select',
  };

  activeBattles.set(jid, battle);
  return battle;
}

async function startWildDigimonBattle(jid, wildDigimon, location, chatId) {
  const userDg = getActiveDigimon(jid);
  if (!userDg) return null;

  const battleId = generateBattleId();
  const battle = {
    id: battleId,
    type: 'wild_digimon',
    jid,
    chatId,
    location,
    turn: 1,
    state: 'active',
    userDigimon: {
      ...userDg,
      skills: JSON.parse(userDg.skills || '[]'),
    },
    wildDigimon: {
      ...wildDigimon,
      currentHp: wildDigimon.stats.hp * 3,
      maxHp: wildDigimon.stats.hp * 3,
      skills: wildDigimon.skills || [{ name: 'Basic Attack' }],
    },
    phase: 'select',
  };

  activeBattles.set(jid, battle);
  return battle;
}

async function startPvpBattle(attackerJid, defenderJid, chatId) {
  const atkPk = getActivePokemon(attackerJid);
  const defPk = getActivePokemon(defenderJid);

  if (!atkPk || !defPk) return null;

  const parseT = (t) => { if (!t) return []; if (Array.isArray(t)) return t; try { return JSON.parse(t); } catch { return [t]; } };
  const parseM = (m) => { if (!m) return []; if (Array.isArray(m)) return m; try { return JSON.parse(m); } catch { return [m]; } };

  const battleId = generateBattleId();
  const key = `pvp_${attackerJid}_${defenderJid}`;

  const battle = {
    id: battleId,
    type: 'pvp',
    attackerJid,
    defenderJid,
    chatId,
    turn: 1,
    state: 'pending',
    attackerPokemon: {
      ...atkPk,
      types: parseT(atkPk.types),
      moves: parseM(atkPk.moves),
    },
    defenderPokemon: {
      ...defPk,
      types: parseT(defPk.types),
      moves: parseM(defPk.moves),
    },
    currentTurn: attackerJid,
    phase: 'pending',
  };

  activeBattles.set(key, battle);
  activeBattles.set(attackerJid, { ref: key });
  activeBattles.set(defenderJid, { ref: key });

  return battle;
}

function getBattle(jid) {
  const data = activeBattles.get(jid);
  if (!data) return null;
  if (data.ref) return activeBattles.get(data.ref);
  return data;
}

function endBattle(jid) {
  const battle = getBattle(jid);
  if (!battle) return;

  if (battle.type === 'pvp') {
    const key = `pvp_${battle.attackerJid}_${battle.defenderJid}`;
    activeBattles.delete(key);
    activeBattles.delete(battle.attackerJid);
    activeBattles.delete(battle.defenderJid);
  } else {
    activeBattles.delete(jid);
  }
}

async function processPokemonTurn(jid, action, param) {
  const battle = getBattle(jid);
  if (!battle || battle.state !== 'active') return null;

  // Validate turn in PvP
  if (battle.type === 'pvp' && battle.currentTurn !== jid) {
    return { error: 'Bukan giliran kamu!' };
  }

  const result = { messages: [], ended: false };

  if (action === 'run') {
    if (battle.type === 'pvp') {
      return { error: 'Tidak bisa kabur dari PvP!' };
    }
    endBattle(jid);
    result.messages.push('🏃 Kamu berhasil kabur!');
    result.ended = true;
    return result;
  }

  if (action === 'attack') {
    const moveIdx = parseInt(param) - 1;
    let attacker, defender, userIsAttacker;

    if (battle.type === 'pvp') {
      userIsAttacker = battle.currentTurn === battle.attackerJid;
      attacker = userIsAttacker ? battle.attackerPokemon : battle.defenderPokemon;
      defender = userIsAttacker ? battle.defenderPokemon : battle.attackerPokemon;
    } else {
      attacker = battle.userPokemon;
      defender = battle.wildPokemon;
      userIsAttacker = true;
    }

    const moveName = attacker.moves[moveIdx] || attacker.moves[0];
    const moveData = await fetchMove(moveName);

    const types = attacker.types || [];

    // Helper: pastikan types selalu array, bukan JSON string atau string biasa
    const parseTypes = (t) => {
      if (!t) return [];
      if (Array.isArray(t)) return t;
      try { return JSON.parse(t); } catch { return [t]; }
    };

    const defTypes = parseTypes(defender.types);

    const typeMult = getTypeMultiplier(moveData.type, defTypes);
    const attackerTypes = attacker.types || [];
    const stab = checkSTAB(moveData.type, attackerTypes);
    const crit = isCriticalHit();
    const attackerLevel = attacker.level || 5;
    const atkStat = attacker.attack || 10;
    const defStat = defender.defense || defender.stats?.defense || 10;
    const dmg = calcDamageGen3(attackerLevel, atkStat, defStat, moveData.power || 40, typeMult, stab, crit);
    const critText = crit ? '\n💥 *Critical Hit!*' : '';

    // Apply damage
    if (battle.type === 'wild') {
      battle.wildPokemon.currentHp = Math.max(0, battle.wildPokemon.currentHp - dmg);
      result.messages.push(
        `⚔️ *${attacker.name.toUpperCase()}* menggunakan *${moveName.toUpperCase()}*!`,
        `💥 Damage: ${dmg}${critText} ${effectivenessText(typeMult)}`,
        `❤️ ${battle.wildPokemon.name.toUpperCase()}: ${hpBar(battle.wildPokemon.currentHp, battle.wildPokemon.max_hp)}`
      );

      if (battle.wildPokemon.currentHp <= 0) {
        // Wild pokemon fainted
        const expGain = Math.floor((battle.wildPokemon.base_experience || 50) * 1.5);
        const coinGain = randInt(20, 60);
        addExp(jid, expGain);
        addCoins(jid, coinGain);
        addPokemonExp(attacker.id, expGain);
        endBattle(jid);
        result.messages.push(
          `\n💀 *${battle.wildPokemon.name.toUpperCase()}* pingsan!`,
          `🎉 EXP: +${expGain} | 💰 Koin: +${coinGain}`
        );
        result.ended = true;
        result.won = true;
        return result;
      }

      // Wild pokemon counter attack
      const wildMoves = battle.wildPokemon.moves?.slice(0, 4) || ['tackle'];
      const wildMove = wildMoves[Math.floor(Math.random() * wildMoves.length)];
      const wildMoveData = await fetchMove(wildMove);
      const wildTypes = battle.wildPokemon.types || [];
      const wildTypeMult = getTypeMultiplier(wildMoveData.type, attacker.types || []);
      const wildStab = checkSTAB(wildMoveData.type, wildTypes);
      const wildCrit = isCriticalHit();
      const wildLevel = battle.wildPokemon.level || 5;
      // Hitung atk wild dari base stat + level (Gen III formula)
      const wildBaseAtk = battle.wildPokemon.stats?.attack || battle.wildPokemon.attack || 45;
      const wildAtkStat = calcStat(wildBaseAtk, wildLevel);
      const wildDmg = calcDamageGen3(
        wildLevel, wildAtkStat, attacker.defense,
        wildMoveData.power || 35, wildTypeMult, wildStab, wildCrit
      );

      const newUserHp = Math.max(0, attacker.hp - wildDmg);
      battle.userPokemon.hp = newUserHp;
      updatePokemonHp(attacker.id, newUserHp);

      result.messages.push(
        `\n🐾 *${battle.wildPokemon.name.toUpperCase()}* menggunakan *${wildMove.toUpperCase()}*!`,
        `💥 Damage: ${wildDmg}`,
        `❤️ ${attacker.name.toUpperCase()}: ${hpBar(newUserHp, attacker.max_hp)}`
      );

      if (newUserHp <= 0) {
        endBattle(jid);
        result.messages.push(`\n💀 *${attacker.name.toUpperCase()}* pingsan! Kamu kalah...`);
        result.ended = true;
        result.lost = true;
      }

    } else if (battle.type === 'pvp') {
      const defKey = userIsAttacker ? 'defenderPokemon' : 'attackerPokemon';
      battle[defKey].hp = Math.max(0, (battle[defKey].hp || 0) - dmg);

      result.messages.push(
        `⚔️ *${attacker.name.toUpperCase()}* menggunakan *${moveName.toUpperCase()}*!`,
        `💥 Damage: ${dmg} ${effectivenessText(typeMult)}`,
        `❤️ ${defender.name.toUpperCase()}: ${hpBar(battle[defKey].hp, battle[defKey].max_hp)}`
      );

      if (battle[defKey].hp <= 0) {
        const winnerJid = battle.currentTurn;
        const loserJid = winnerJid === battle.attackerJid ? battle.defenderJid : battle.attackerJid;
        const coinsGain = Math.floor(randInt(100, 300));

        // Transfer coins
        removeCoins(loserJid, coinsGain);
        addCoins(winnerJid, coinsGain);
        addExp(winnerJid, 80);
        addExp(loserJid, 20);

        endBattle(jid);
        result.messages.push(
          `\n🏆 *${attacker.name.toUpperCase()}* menang!`,
          `💰 Koin dirampas: ${coinsGain}`,
          `🎖️ EXP: +80 (menang) / +20 (kalah)`
        );
        result.ended = true;
        result.winner = winnerJid;
        result.loser = loserJid;
      } else {
        // Switch turn
        battle.currentTurn = battle.currentTurn === battle.attackerJid ? battle.defenderJid : battle.attackerJid;
        battle.turn++;
        result.messages.push(`\n🔄 Giliran *@${battle.currentTurn.split('@')[0]}*`);
      }
    }

    return result;
  }

  if (action === 'ball') {
    if (battle.type !== 'wild') return { error: 'Tidak bisa menangkap Pokemon lawan!' };

    const user = require('./userSystem').getUser(jid);
    const ballType = param || 'pokeball';

    const ballMap = {
      pokeball: { field: 'pokeballs', mult: 1 },
      great_ball: { field: 'great_balls', mult: 1.5 },
      ultra_ball: { field: 'ultra_balls', mult: 2 },
      master_ball: { field: 'master_balls', mult: 999 },
    };

    const ball = ballMap[ballType] || ballMap.pokeball;
    if ((user[ball.field] || 0) < 1) {
      return { error: `❌ ${ballType.replace('_', ' ')} habis! Beli di Shop.` };
    }

    // Reduce ball count
    const { updateUser } = require('./userSystem');
    updateUser(jid, { [ball.field]: (user[ball.field] || 0) - 1 });

    const hpPct = Math.max(1, (battle.wildPokemon.currentHp / battle.wildPokemon.max_hp) * 100);
    const catchRate = battle.wildPokemon.catch_rate || 45;
    const caught = require('../utils/helpers').calcCatchRate(catchRate, ball.mult, hpPct);

    const shakes = caught ? 3 : randInt(0, 2);
    const shakeStr = '... '.repeat(shakes + 1).trim();
    result.messages.push(`🎯 Pokeball dilempar! ${shakeStr}`);

    if (caught) {
      const { savePokemon, createPokemonFromApi } = require('./pokemonSystem');
      const pkData = createPokemonFromApi(battle.wildPokemon, battle.wildPokemon.level || 5);
      pkData.hp = battle.wildPokemon.currentHp;
      savePokemon(jid, pkData);
      addExp(jid, 30);

      endBattle(jid);
      result.messages.push(
        `✅ *${battle.wildPokemon.name.toUpperCase()}* berhasil ditangkap!`,
        `📱 Ditambahkan ke Pokedex kamu!`
      );
      result.ended = true;
      result.caught = true;
      result.caughtPokemon = battle.wildPokemon;
    } else {
      result.messages.push(`💨 *${battle.wildPokemon.name.toUpperCase()}* melarikan diri dari Pokeball!`);
    }

    return result;
  }

  return { error: 'Aksi tidak dikenali!' };
}

async function acceptPvpBattle(defenderJid) {
  const battle = getBattle(defenderJid);
  if (!battle || battle.type !== 'pvp' || battle.state !== 'pending') return null;
  battle.state = 'active';
  battle.phase = 'select';
  return battle;
}

function formatBattleStatus(battle) {
  if (battle.type === 'wild') {
    const up = battle.userPokemon;
    const wp = battle.wildPokemon;
    return `
🌿 *WILD BATTLE!*
━━━━━━━━━━━━━━━━━
🤺 ${up.name.toUpperCase()} Lv.${up.level}
   ${hpBar(up.hp, up.max_hp)}
━━━━━━━━━━━━━━━━━
🐾 ${wp.name.toUpperCase()} Lv.${wp.level || 5}
   ${hpBar(wp.currentHp, wp.max_hp)}
━━━━━━━━━━━━━━━━━
📋 Pilih aksi:
1️⃣  Attack (ketik: *1* atau *.attack <no skill>*)
🎯 Ball (ketik: *.ball* atau *.ball great_ball*)
🏃 Run (ketik: *.run*)

⚔️ Skill: ${up.moves.slice(0,4).map((m,i)=>`${i+1}.${m}`).join(' | ')}`.trim();
  }

  if (battle.type === 'pvp') {
    const ap = battle.attackerPokemon;
    const dp = battle.defenderPokemon;
    return `
⚔️ *PVP BATTLE!*
━━━━━━━━━━━━━━━━━
🤺 ${ap.name.toUpperCase()} Lv.${ap.level}
   ${hpBar(ap.hp, ap.max_hp)}
vs
🛡️ ${dp.name.toUpperCase()} Lv.${dp.level}
   ${hpBar(dp.hp, dp.max_hp)}
━━━━━━━━━━━━━━━━━
🔄 Giliran: @${battle.currentTurn.split('@')[0]}
⚔️ Ketik: *.attack <no skill>*`.trim();
  }
}

module.exports = {
  startWildBattle, startWildDigimonBattle, startPvpBattle,
  getBattle, endBattle, processPokemonTurn,
  acceptPvpBattle, formatBattleStatus, activeBattles
};
