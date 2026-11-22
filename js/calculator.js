/**
 * @typedef {"hp" | "atk" | "def" | "spa" | "spd" | "spe"} StatName
 * @typedef {{ hp?: number, atk?: number, def?: number, spa?: number, spd?: number, spe?: number }} BaseStats
 * @typedef {{ id?: string, name?: string, types?: string[], abilities?: string[], ability?: string, baseStats?: BaseStats, megaForms?: Array<{ name: string, types: string[], ability: string, baseStats: BaseStats }> }} SpeciesData
 * @typedef {{ nature?: string, ability?: string, item?: string, megaForm?: string, points?: Partial<Record<StatName, number>> }} PokemonBuild
 * @typedef {{ name: string, up: StatName | null, down: StatName | null }} NatureData
 * @typedef {{ name?: string, type?: string, category?: string, power?: number, isSpread?: boolean }} MoveData
 * @typedef {{ attackerRank?: number | Partial<Record<StatName, number>>, defenderRank?: number | Partial<Record<StatName, number>>, isCritical?: boolean, isDoubleBattle?: boolean, weather?: string, isBurned?: boolean }} FieldOptions
 * @typedef {{ natures?: NatureData[], naturesData?: NatureData[] }} MasterData
 * @typedef {{ rolls: number[], minDamage: number, maxDamage: number, minPercent: number, maxPercent: number, koText: string }} DamageResult
 */

const LEVEL = 50;
const MAX_POINT = 32;
const IV = 31;
const RANDOM_ROLLS = Array.from({ length: 16 }, (_, index) => 85 + index);
const STAT_NAMES = ["hp", "atk", "def", "spa", "spd", "spe"];
const RANK_NUMERATORS = [2, 2, 2, 2, 2, 2, 2, 3, 4, 5, 6, 7, 8];
const RANK_DENOMINATORS = [8, 7, 6, 5, 4, 3, 2, 2, 2, 2, 2, 2, 2];

const TYPE_EFFECTIVENESS = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { grass: 2, fighting: 2, bug: 2, electric: 0.5, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { grass: 2, psychic: 2, dark: 2, fire: 0.5, fighting: 0.5, poison: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, flying: 2, bug: 2, fighting: 0.5, ground: 0.5, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { ice: 2, rock: 2, fairy: 2, fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5 },
  fairy: { fighting: 2, dragon: 2, dark: 2, fire: 0.5, poison: 0.5, steel: 0.5 }
};

/**
 * ゲーム内の五捨五超入で丸め、微小な浮動小数点誤差を許容する。
 * @param {number} value 丸める値。
 * @returns {number} 丸めた整数。
 */
export function roundHalfDown(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  return fraction > 0.5 + 1e-10 ? lower + 1 : lower;
}

/**
 * 入力を変更せず、選択されたメガフォルムを解決する。
 * @param {SpeciesData} speciesData 通常フォルムの種族データ。
 * @param {PokemonBuild} build 解決対象の育成データ。
 * @returns {SpeciesData} 実効種族値・タイプ・特性を持つ種族データ。
 */
export function resolveEffectiveSpecies(speciesData, build) {
  const form = build.item === "メガストーン" && build.megaForm
    ? speciesData.megaForms?.find((candidate) => candidate.name === build.megaForm)
    : undefined;

  if (form) {
    return {
      ...speciesData,
      baseStats: form.baseStats,
      types: form.types,
      ability: form.ability
    };
  }

  return {
    ...speciesData,
    baseStats: speciesData.baseStats,
    types: speciesData.types,
    ability: build.ability ?? speciesData.abilities?.[0]
  };
}

/**
 * 個体値31、レベル50固定で、能力ポイントを各0〜32に収めて実数値を計算する。
 * @param {SpeciesData} speciesData 通常または解決済みの種族データ。
 * @param {PokemonBuild} build 能力ポイントと性格を含む育成データ。
 * @param {NatureData[]} naturesData 性格マスターデータ。
 * @returns {{ hp: number, atk: number, def: number, spa: number, spd: number, spe: number }} 計算した実数値。
 */
export function calculateStats(speciesData, build, naturesData) {
  const points = {};
  for (const stat of STAT_NAMES) {
    const rawPoint = Number(build.points?.[stat]);
    points[stat] = Number.isFinite(rawPoint)
      ? Math.min(MAX_POINT, Math.max(0, Math.trunc(rawPoint)))
      : 0;
  }

  const baseStats = speciesData.baseStats ?? {};
  const hpBase = Number(baseStats.hp) || 0;
  const hp = hpBase === 1
    ? 1
    : Math.floor((hpBase * 2 + IV) * 0.5) + 60 + points.hp;

  const nature = naturesData?.find((candidate) => candidate.name === build.nature);
  const result = { hp, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  for (const stat of STAT_NAMES.slice(1)) {
    const baseStat = Number(baseStats[stat]) || 0;
    let multiplier = 1;
    if (nature?.up === stat) multiplier = 1.1;
    if (nature?.down === stat) multiplier = 0.9;
    result[stat] = Math.floor(
      (Math.floor((baseStat * 2 + IV) * 0.5) + 5 + points[stat]) * multiplier
    );
  }
  return result;
}

/**
 * 技のタイプと防御側のタイプから、合算したタイプ相性倍率を返す。
 * @param {string} moveType 技のタイプ。
 * @param {string[]} defenderTypes 防御側のタイプ（1〜2種類）。
 * @returns {number} 合算したタイプ相性倍率。
 */
export function getTypeEffectiveness(moveType, defenderTypes) {
  const matchups = TYPE_EFFECTIVENESS[moveType];
  if (!matchups) return 1;
  return (defenderTypes ?? []).reduce(
    (multiplier, type) => multiplier * (matchups[type] ?? 1),
    1
  );
}

/**
 * ランク補正を有効範囲の-6〜+6に収める。
 * @param {number} rank 補正前のランク。
 * @returns {number} 範囲内に収めたランク。
 */
function clampRank(rank) {
  const numericRank = Number(rank);
  return Number.isFinite(numericRank) ? Math.min(6, Math.max(-6, Math.trunc(numericRank))) : 0;
}

/**
 * 数値または能力別マップから、対象能力のランク補正を取得する。
 * @param {number | Partial<Record<StatName, number>>} rank ランク補正。
 * @param {StatName} stat 対象の能力。
 * @returns {number} 範囲内に収めた対象能力のランク。
 */
function getRank(rank, stat) {
  return clampRank(typeof rank === "number" ? rank : rank?.[stat]);
}

/**
 * ランク補正を適用し、実数値を切り捨てる。
 * @param {number} statValue 補正前の実数値。
 * @param {number} rank ランク補正。
 * @returns {number} ランク補正後の実数値。
 */
function applyRank(statValue, rank) {
  const stage = clampRank(rank);
  const index = stage + 6;
  return Math.floor(statValue * RANK_NUMERATORS[index] / RANK_DENOMINATORS[index]);
}

/**
 * 指定倍率を適用し、五捨五超入で丸める。
 * @param {number} value 倍率を適用する値。
 * @param {number} multiplier 適用する倍率。
 * @returns {number} 丸めた結果。
 */
function applyMultiplier(value, multiplier) {
  return roundHalfDown(value * multiplier);
}

/**
 * ダメージを与えない技の計算結果を作成する。
 * @returns {DamageResult} ダメージ0の計算結果。
 */
function emptyDamageResult() {
  return {
    rolls: Array(16).fill(0),
    minDamage: 0,
    maxDamage: 0,
    minPercent: 0,
    maxPercent: 0,
    koText: "ダメージなし"
  };
}

/**
 * 独立したダメージ乱数を繰り返したとき、相手のHPを削り切る確率を計算する。
 * @param {number[]} rolls 1回の攻撃におけるダメージ乱数。
 * @param {number} hp 防御側の最大HP。
 * @returns {string} 日本語の確定数テキスト。
 */
function calculateKoText(rolls, hp) {
  if (rolls.every((roll) => roll === 0) || hp <= 0) return "ダメージなし";

  const minDamage = Math.min(...rolls);
  const maxDamage = Math.max(...rolls);
  const possibleHits = Math.ceil(hp / maxDamage);
  let distribution = new Map([[0, 1]]);

  for (let hits = 1; hits <= possibleHits; hits += 1) {
    const nextDistribution = new Map();
    for (const [total, probability] of distribution) {
      for (const damage of rolls) {
        const nextTotal = total + damage;
        nextDistribution.set(
          nextTotal,
          (nextDistribution.get(nextTotal) ?? 0) + probability / 16
        );
      }
    }
    distribution = nextDistribution;
    let probabilityOfKo = 0;
    for (const [total, probability] of distribution) {
      if (total >= hp) probabilityOfKo += probability;
    }

    if (hits * minDamage >= hp) return `確定${hits}発`;
    if (probabilityOfKo > 0) {
      const percent = Math.round(probabilityOfKo * 1000) / 10;
      return `乱数${hits}発 (${percent}%)`;
    }
  }

  throw new Error("KO probability could not be calculated");
}

/**
 * 16段階のダメージ乱数と確定数を計算する。
 * @param {PokemonBuild} attackerBuild 攻撃側の育成データ。
 * @param {SpeciesData} attackerSpecies 攻撃側の種族マスターデータ。
 * @param {PokemonBuild} defenderBuild 防御側の育成データ。
 * @param {SpeciesData} defenderSpecies 防御側の種族マスターデータ。
 * @param {MoveData} move 技マスターデータ。
 * @param {FieldOptions} fieldOptions 天候・場の状態・ランク補正。
 * @param {MasterData} masterData 性格データを含むマスターデータ。
 * @returns {DamageResult} ダメージ乱数、割合、確定数を含む計算結果。
 */
export function calculateDamage(
  attackerBuild,
  attackerSpecies,
  defenderBuild,
  defenderSpecies,
  move,
  fieldOptions = {},
  masterData = {}
) {
  if (move.category === "status" || !move.power) return emptyDamageResult();

  const naturesData = masterData.natures ?? masterData.naturesData ?? [];
  const effectiveAttacker = resolveEffectiveSpecies(attackerSpecies, attackerBuild);
  const effectiveDefender = resolveEffectiveSpecies(defenderSpecies, defenderBuild);
  const attackerStats = calculateStats(effectiveAttacker, attackerBuild, naturesData);
  const defenderStats = calculateStats(effectiveDefender, defenderBuild, naturesData);
  const attackStatName = move.category === "physical" ? "atk" : "spa";
  const defenseStatName = move.category === "physical" ? "def" : "spd";
  let attackRank = getRank(fieldOptions.attackerRank, attackStatName);
  let defenseRank = getRank(fieldOptions.defenderRank, defenseStatName);
  if (fieldOptions.isCritical === true) {
    if (attackRank < 0) attackRank = 0;
    if (defenseRank > 0) defenseRank = 0;
  }

  let attackStat = applyRank(attackerStats[attackStatName], attackRank);
  let defenseStat = applyRank(defenderStats[defenseStatName], defenseRank);
  if (attackerBuild.item === "こだわりハチマキ" && attackStatName === "atk") {
    attackStat = applyMultiplier(attackStat, 1.5);
  }
  if (attackerBuild.item === "こだわりメガネ" && attackStatName === "spa") {
    attackStat = applyMultiplier(attackStat, 1.5);
  }
  if (defenderBuild.item === "とつげきチョッキ" && defenseStatName === "spd") {
    defenseStat = applyMultiplier(defenseStat, 1.5);
  }
  defenseStat = Math.max(1, defenseStat);

  let baseDamage = Math.floor(
    Math.floor(Math.floor(2 * LEVEL / 5 + 2) * move.power * attackStat / defenseStat) / 50
  ) + 2;
  if (fieldOptions.isDoubleBattle && move.isSpread) {
    baseDamage = applyMultiplier(baseDamage, 0.75);
  }

  const weather = fieldOptions.weather;
  if ((weather === "sun" || weather === "sunny" || weather === "晴れ") && move.type === "fire") {
    baseDamage = applyMultiplier(baseDamage, 1.5);
  } else if ((weather === "sun" || weather === "sunny" || weather === "晴れ") && move.type === "water") {
    baseDamage = applyMultiplier(baseDamage, 0.5);
  } else if ((weather === "rain" || weather === "rainy" || weather === "雨") && move.type === "water") {
    baseDamage = applyMultiplier(baseDamage, 1.5);
  } else if ((weather === "rain" || weather === "rainy" || weather === "雨") && move.type === "fire") {
    baseDamage = applyMultiplier(baseDamage, 0.5);
  }
  if (fieldOptions.isCritical === true) {
    baseDamage = applyMultiplier(baseDamage, 1.5);
  }

  const effectiveness = getTypeEffectiveness(move.type ?? "", effectiveDefender.types ?? []);
  const hasStab = (effectiveAttacker.types ?? []).includes(move.type);
  const rolls = RANDOM_ROLLS.map((randomValue) => {
    let damage = Math.floor(baseDamage * randomValue / 100);
    if (hasStab) damage = applyMultiplier(damage, 1.5);
    damage = Math.floor(damage * effectiveness);
    if (move.category === "physical" && fieldOptions.isBurned) {
      damage = applyMultiplier(damage, 0.5);
    }
    if (attackerBuild.item === "いのちのたま") {
      damage = applyMultiplier(damage, 1.3);
    }
    return effectiveness > 0 ? Math.max(1, damage) : 0;
  });

  const minDamage = Math.min(...rolls);
  const maxDamage = Math.max(...rolls);
  const maxHp = defenderStats.hp;
  return {
    rolls,
    minDamage,
    maxDamage,
    minPercent: maxHp > 0 ? Math.round(minDamage / maxHp * 1000) / 10 : 0,
    maxPercent: maxHp > 0 ? Math.round(maxDamage / maxHp * 1000) / 10 : 0,
    koText: calculateKoText(rolls, maxHp)
  };
}
