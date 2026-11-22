/**
 * @typedef {"hp" | "atk" | "def" | "spa" | "spd" | "spe"} StatName
 * @typedef {{ hp?: number, atk?: number, def?: number, spa?: number, spd?: number, spe?: number }} BaseStats
 * @typedef {{ id?: string, name?: string, types?: string[], abilities?: string[], ability?: string, baseStats?: BaseStats, megaForms?: Array<{ name: string, types: string[], ability: string, baseStats: BaseStats }> }} SpeciesData
 * @typedef {{ nature?: string, ability?: string, item?: string, megaForm?: string, points?: Partial<Record<StatName, number>> }} PokemonBuild
 * @typedef {{ name: string, up: StatName | null, down: StatName | null }} NatureData
 * @typedef {{ id?: string, name?: string, type?: string, category?: string, power?: number, isSpread?: boolean, isContact?: boolean }} MoveData
 * @typedef {{ attackerRank?: number | Partial<Record<StatName, number>>, defenderRank?: number | Partial<Record<StatName, number>>, isCritical?: boolean, isDoubleBattle?: boolean, weather?: string, isBurned?: boolean, status?: string, statusCondition?: string }} FieldOptions
 * @typedef {{ natures?: NatureData[], naturesData?: NatureData[] }} MasterData
 * @typedef {{ rolls: number[], minDamage: number, maxDamage: number, minPercent: number, maxPercent: number, koText: string, appliedModifiers: string[] }} DamageResult
 */

const LEVEL = 50;
const MAX_POINT = 32;
const IV = 31;
const RANDOM_ROLLS = Array.from({ length: 16 }, (_, index) => 85 + index);
const STAT_NAMES = ["hp", "atk", "def", "spa", "spd", "spe"];
const RANK_NUMERATORS = [2, 2, 2, 2, 2, 2, 2, 3, 4, 5, 6, 7, 8];
const RANK_DENOMINATORS = [8, 7, 6, 5, 4, 3, 2, 2, 2, 2, 2, 2, 2];
const TYPE_NAMES = {
  ノーマル: "normal", ほのお: "fire", みず: "water", でんき: "electric",
  くさ: "grass", こおり: "ice", かくとう: "fighting", どく: "poison",
  じめん: "ground", ひこう: "flying", エスパー: "psychic", むし: "bug",
  いわ: "rock", ゴースト: "ghost", ドラゴン: "dragon", あく: "dark",
  はがね: "steel", フェアリー: "fairy"
};
const TYPE_BOOST_ITEMS = {
  normal: ["シルクのスカーフ", "silk-scarf"],
  fire: ["もくたん", "charcoal"],
  water: ["しんぴのしずく", "mystic-water"],
  electric: ["じしゃく", "magnet"],
  grass: ["きせきのタネ", "miracle-seed"],
  ice: ["とけないこおり", "never-melt-ice"],
  fighting: ["くろおび", "black-belt"],
  poison: ["どくバリ", "poison-barb"],
  ground: ["やわらかいすな", "soft-sand"],
  flying: ["するどいくちばし", "sharp-beak"],
  psychic: ["まがったスプーン", "twisted-spoon"],
  bug: ["ぎんのこな", "silver-powder"],
  rock: ["かたいいし", "hard-stone"],
  ghost: ["のろいのおふだ", "spell-tag"],
  dragon: ["りゅうのキバ", "dragon-fang"],
  dark: ["くろいメガネ", "black-glasses"],
  steel: ["メタルコート", "metal-coat"],
  fairy: ["ようせいのハネ", "fairy-feather"]
};
const RESIST_BERRIES = {
  normal: ["ホズのみ", "chilan-berry"],
  fire: ["オッカのみ", "occa-berry"],
  water: ["イトケのみ", "passho-berry"],
  electric: ["ソクノのみ", "wacan-berry"],
  grass: ["リンドのみ", "rindo-berry"],
  ice: ["ヤチェのみ", "yache-berry"],
  fighting: ["ヨプのみ", "chople-berry"],
  poison: ["ビアーのみ", "kebia-berry"],
  ground: ["シュカのみ", "shuca-berry"],
  flying: ["バコウのみ", "coba-berry"],
  psychic: ["ウタンのみ", "payapa-berry"],
  bug: ["タンガのみ", "tanga-berry"],
  rock: ["ヨロギのみ", "charti-berry"],
  ghost: ["カシブのみ", "kasib-berry"],
  dragon: ["ハバンのみ", "haban-berry"],
  dark: ["ナモのみ", "colbur-berry"],
  steel: ["リリバのみ", "babiri-berry"],
  fairy: ["ロゼルのみ", "roseli-berry"]
};
const ABILITY_IDS = {
  "huge-power": "ちからもち", "pure-power": "ヨガパワー", hustle: "はりきり",
  guts: "こんじょう", "solar-power": "サンパワー", adaptability: "てきおうりょく",
  aerilate: "スカイスキン", pixilate: "フェアリースキン",
  refrigerate: "フリーズスキン",
  "tough-claws": "かたいツメ", "iron-fist": "てつのこぶし",
  "strong-jaw": "がんじょうあご", "mega-launcher": "メガランチャー",
  sharpness: "きれあじ", technician: "テクニシャン", reckless: "すてみ",
  "sheer-force": "ちからずく", analytic: "アナライズ", overgrow: "しんりょく",
  blaze: "もうか", torrent: "げきりゅう", swarm: "むしのしらせ",
  "tinted-lens": "いろめがね", multiscale: "マルチスケイル",
  "shadow-shield": "ファントムガード", "thick-fat": "あついしぼう",
  levitate: "ふゆう", "flash-fire": "もらいび", "water-absorb": "ちょすい",
  "storm-drain": "よびみず", "dry-skin": "かんそうはだ",
  "volt-absorb": "ちくでん", "lightning-rod": "ひらいしん",
  "motor-drive": "でんきエンジン", "sap-sipper": "そうしょく",
  "earth-eater": "どしょく", "mold-breaker": "かたやぶり",
  "water-bubble": "すいほう", "filter": "フィルター",
  "solid-rock": "ハードロック", "fur-coat": "ファーコート",
  "ice-scales": "こおりのりんぷん", "choice-band": "こだわりハチマキ",
  "choice-specs": "こだわりメガネ", "assault-vest": "とつげきチョッキ",
  "life-orb": "いのちのたま", "expert-belt": "たつじんのおび",
  "muscle-band": "ちからのハチマキ", "wise-glasses": "ものしりメガネ",
  "normal-gem": "ノーマルジュエル",
  "iron-ball": "くろいてっきゅう"
};

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
  const matchups = TYPE_EFFECTIVENESS[normalizeType(moveType)];
  if (!matchups) return 1;
  return (defenderTypes ?? []).reduce(
    (multiplier, type) => multiplier * (matchups[normalizeType(type)] ?? 1),
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
 * 日本語名または英語IDのタイプを、相性表で使う英語IDに統一する。
 * @param {string} type タイプ名またはID。
 * @returns {string} 相性表で使うタイプID。
 */
function normalizeType(type) {
  return TYPE_NAMES[type] ?? type;
}

/**
 * 特性名または英語IDを日本語名に統一する。
 * @param {string | undefined} ability 特性名またはID。
 * @returns {string} 特性の日本語名。
 */
function normalizeAbility(ability) {
  return ABILITY_IDS[ability] ?? ability ?? "";
}

/**
 * 持ち物の日本語名または英語IDが指定品と一致するか調べる。
 * @param {string | undefined} item 持ち物名またはID。
 * @param {string} name 日本語名。
 * @param {string} id 英語ID。
 * @returns {boolean} 指定した持ち物ならtrue。
 */
function isItem(item, name, id) {
  return item === name || item === id;
}

/**
 * 適用した補正名を、倍率の説明とともに記録する。
 * @param {string[]} modifiers 適用補正の記録先。
 * @param {string} name 補正名。
 * @param {string} multiplier 倍率の表示。
 * @returns {void}
 */
function recordModifier(modifiers, name, multiplier) {
  modifiers.push(`${name}(${multiplier})`);
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
    koText: "ダメージなし",
    appliedModifiers: []
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
 * @param {FieldOptions} fieldOptions 天候・状態異常・場の状態・ランク補正。
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

  const appliedModifiers = [];
  const itemName = attackerBuild.item ?? "";
  const defenderItem = defenderBuild.item ?? "";
  const attackerAbility = normalizeAbility(attackerBuild.ability ?? effectiveAttacker.ability);
  const defenderAbility = normalizeAbility(defenderBuild.ability ?? effectiveDefender.ability);
  const moveName = move.name ?? "";
  const moveType = normalizeType(move.type ?? "");
  const basePower = Number(move.power) || 0;
  const weather = fieldOptions.weather;
  const isSunny = weather === "sun" || weather === "sunny" || weather === "晴れ" || weather === "にほんばれ";
  const isRainy = weather === "rain" || weather === "rainy" || weather === "雨" || weather === "あめ";
  const status = fieldOptions.status ?? fieldOptions.statusCondition
    ?? (fieldOptions.isBurned ? "やけど" : "");
  const statusNames = {
    paralysis: "まひ", poison: "どく", "badly-poisoned": "もうどく", burn: "やけど"
  };
  const normalizedStatus = statusNames[status] ?? status;
  const isBurned = fieldOptions.isBurned === true || normalizedStatus === "やけど";
  const hasGuts = attackerAbility === "こんじょう"
    && move.category === "physical"
    && ["まひ", "どく", "もうどく", "やけど"].includes(normalizedStatus);
  const moldBreaker = attackerAbility === "かたやぶり";
  const heldIronBall = isItem(defenderItem, "くろいてっきゅう", "iron-ball");
  let effectiveType = moveType;
  let adjustedPower = basePower;
  /**
   * 威力補正を計算し、適用した補正名を記録する。
   * @param {number} multiplier 適用する倍率。
   * @param {string} name 補正名。
   * @param {string} [displayName=name] 表示する補正名。
   * @returns {void}
   */
  const applyPowerMultiplier = (multiplier, name, displayName = name) => {
    adjustedPower = applyMultiplier(adjustedPower, multiplier);
    recordModifier(appliedModifiers, displayName, `威力${multiplier}倍`);
  };

  if (attackerAbility === "テクニシャン" && basePower <= 60) {
    applyPowerMultiplier(1.5, "テクニシャン");
  }
  const skinTypes = {
    スカイスキン: "flying",
    フェアリースキン: "fairy",
    フリーズスキン: "ice",
    ドラゴンスキン: "dragon"
  };
  if (moveType === "normal" && skinTypes[attackerAbility]) {
    effectiveType = skinTypes[attackerAbility];
    adjustedPower = applyMultiplier(adjustedPower, 1.2);
    recordModifier(appliedModifiers, attackerAbility, `${effectiveType}タイプ化・威力1.2倍`);
  }

  const typeBoost = TYPE_BOOST_ITEMS[effectiveType];
  if (typeBoost && isItem(itemName, typeBoost[0], typeBoost[1])) {
    applyPowerMultiplier(1.2, typeBoost[0]);
  }
  if (move.category === "physical" && isItem(itemName, "ちからのハチマキ", "muscle-band")) {
    applyPowerMultiplier(1.1, "ちからのハチマキ");
  }
  if (move.category === "special" && isItem(itemName, "ものしりメガネ", "wise-glasses")) {
    applyPowerMultiplier(1.1, "ものしりメガネ");
  }
  if (effectiveType === "normal" && isItem(itemName, "ノーマルジュエル", "normal-gem")) {
    applyPowerMultiplier(1.3, "ノーマルジュエル");
  }
  if (move.isContact === true && attackerAbility === "かたいツメ") {
    applyPowerMultiplier(1.3, "かたいツメ");
  }
  const punchMoves = new Set([
    "アームハンマー", "アイスハンマー", "コメットパンチ", "ドレインパンチ",
    "マッハパンチ", "ぶちかまし", "ジェットパンチ", "ふんどのこぶし", "ダブルパンツァー"
  ]);
  if (attackerAbility === "てつのこぶし" && (moveName.includes("パンチ") || punchMoves.has(moveName))) {
    applyPowerMultiplier(1.2, "てつのこぶし");
  }
  const bitingMoves = new Set(["かみつく", "かみくだく", "くらいつく", "ひっさつまえば", "エラがみ"]);
  if (attackerAbility === "がんじょうあご" && (moveName.includes("キバ") || bitingMoves.has(moveName))) {
    applyPowerMultiplier(1.5, "がんじょうあご");
  }
  const pulseMoves = new Set([
    "はどうだん", "あくのはどう", "りゅうのはどう", "みずのはどう",
    "だいちのはどう", "こんげんのはどう", "いやしのはどう"
  ]);
  if (attackerAbility === "メガランチャー"
    && (pulseMoves.has(moveName) || (moveName.includes("はどう") && moveName !== "ブロッキング"))) {
    applyPowerMultiplier(1.5, "メガランチャー");
  }
  const sharpnessExcludedMoves = new Set([
    "エアカッター", "エアスラッシュ", "アクアカッター", "サイコカッター",
    "つじぎり", "リーフブレード", "せいなるつるぎ", "れんぞくぎり", "だいもんじ"
  ]);
  const slicingMoves = new Set([
    "きりさく", "クロスポイズン", "シザークロス", "シャドークロー",
    "シェルブレード", "ソーラーブレード", "ひけん・ちえなみ", "ドゲザン",
    "むねんのつるぎ", "スターアサルト"
  ]);
  if (attackerAbility === "きれあじ"
    && !sharpnessExcludedMoves.has(moveName)
    && (slicingMoves.has(moveName) || moveName.includes("きり"))) {
    applyPowerMultiplier(1.5, "きれあじ");
  }
  const recoilMoves = new Set([
    "すてみタックル", "ブレイブバード", "フレアドライブ", "ウェーブタックル",
    "ウッドハンマー", "ボルテッカー", "ワイルドボルト", "もろはのずつき",
    "とびひざげり", "かかとおとし", "サンダーダイブ"
  ]);
  if (attackerAbility === "すてみ" && recoilMoves.has(moveName)) {
    applyPowerMultiplier(1.2, "すてみ");
  }
  const sheerForceMoves = new Set([
    "アイアンヘッド", "いわなだれ", "エアスラッシュ", "エナジーボール",
    "かえんほうしゃ", "かみくだく", "10まんボルト", "じゃれつく",
    "シャドーボール", "だいちのちから", "つららおとし", "どくづき",
    "ねっとう", "ヘドロばくだん", "ムーンフォース", "ラスターカノン", "れいとうビーム"
  ]);
  if (attackerAbility === "ちからずく" && sheerForceMoves.has(moveName)) {
    applyPowerMultiplier(1.3, "ちからずく");
  }

  let attackStat = applyRank(attackerStats[attackStatName], attackRank);
  let defenseStat = applyRank(defenderStats[defenseStatName], defenseRank);
  if (isItem(itemName, "こだわりハチマキ", "choice-band") && attackStatName === "atk") {
    attackStat = applyMultiplier(attackStat, 1.5);
    recordModifier(appliedModifiers, "こだわりハチマキ", "攻撃1.5倍");
  }
  if (isItem(itemName, "こだわりメガネ", "choice-specs") && attackStatName === "spa") {
    attackStat = applyMultiplier(attackStat, 1.5);
    recordModifier(appliedModifiers, "こだわりメガネ", "特攻1.5倍");
  }
  if (isItem(defenderItem, "とつげきチョッキ", "assault-vest") && defenseStatName === "spd") {
    defenseStat = applyMultiplier(defenseStat, 1.5);
    recordModifier(appliedModifiers, "とつげきチョッキ", "特防1.5倍");
  }
  if ((attackerSpecies.name === "ピカチュウ" || attackerBuild.name === "ピカチュウ"
    || attackerSpecies.id === "pikachu"
    || attackerBuild.speciesId === "pikachu")
    && (isItem(itemName, "でんきだま", "light-ball") || itemName === "electric-ball")) {
    attackStat = applyMultiplier(attackStat, 2);
    recordModifier(appliedModifiers, "でんきだま", "実数値2倍");
  }
  if (move.category === "physical" && ["ちからもち", "ヨガパワー"].includes(attackerAbility)) {
    attackStat = applyMultiplier(attackStat, 2);
    recordModifier(appliedModifiers, attackerAbility, "攻撃2倍");
  }
  if (move.category === "physical" && attackerAbility === "はりきり") {
    attackStat = applyMultiplier(attackStat, 1.5);
    recordModifier(appliedModifiers, "はりきり", "攻撃1.5倍");
  }
  if (hasGuts) {
    attackStat = applyMultiplier(attackStat, 1.5);
    recordModifier(appliedModifiers, "こんじょう", "攻撃1.5倍");
  }
  if (isSunny && move.category === "special" && attackerAbility === "サンパワー") {
    attackStat = applyMultiplier(attackStat, 1.5);
    recordModifier(appliedModifiers, "サンパワー", "特攻1.5倍");
  }
  if (effectiveType === "water" && attackerAbility === "すいほう") {
    attackStat = applyMultiplier(attackStat, 2);
    recordModifier(appliedModifiers, "すいほう", "攻撃・特攻2倍");
  }
  if (defenderAbility === "あついしぼう" && (effectiveType === "fire" || effectiveType === "ice")) {
    attackStat = applyMultiplier(attackStat, 0.5);
    recordModifier(appliedModifiers, "あついしぼう", "攻撃・特攻0.5倍");
  }
  defenseStat = Math.max(1, defenseStat);
  if (move.category === "physical" && defenderAbility === "ファーコート") {
    defenseStat = applyMultiplier(defenseStat, 2);
    recordModifier(appliedModifiers, "ファーコート", "防御2倍");
  }
  if (move.category === "special" && defenderAbility === "こおりのりんぷん") {
    defenseStat = applyMultiplier(defenseStat, 2);
    recordModifier(appliedModifiers, "こおりのりんぷん", "特防2倍");
  }

  let baseDamage = Math.floor(
    Math.floor(Math.floor(2 * LEVEL / 5 + 2) * adjustedPower * attackStat / defenseStat) / 50
  ) + 2;
  if (fieldOptions.isDoubleBattle && move.isSpread) {
    baseDamage = applyMultiplier(baseDamage, 0.75);
  }

  if (isSunny && effectiveType === "fire") {
    baseDamage = applyMultiplier(baseDamage, 1.5);
  } else if (isSunny && effectiveType === "water") {
    baseDamage = applyMultiplier(baseDamage, 0.5);
  } else if (isRainy && effectiveType === "water") {
    baseDamage = applyMultiplier(baseDamage, 1.5);
  } else if (isRainy && effectiveType === "fire") {
    baseDamage = applyMultiplier(baseDamage, 0.5);
  }
  if (fieldOptions.isCritical === true) {
    baseDamage = applyMultiplier(baseDamage, 1.5);
  }

  const effectiveness = getTypeEffectiveness(effectiveType, (effectiveDefender.types ?? []).map(normalizeType));
  const hasStab = (effectiveAttacker.types ?? []).map(normalizeType).includes(effectiveType);
  const stabMultiplier = hasStab && attackerAbility === "てきおうりょく" ? 2 : 1.5;
  if (hasStab && attackerAbility === "てきおうりょく") {
    recordModifier(appliedModifiers, "てきおうりょく", "タイプ一致2倍");
  }
  let isAbilityImmune = false;
  if (!moldBreaker || (defenderAbility === "ふゆう" && heldIronBall)) {
    isAbilityImmune = (defenderAbility === "ふゆう" && effectiveType === "ground" && !heldIronBall)
      || (defenderAbility === "もらいび" && effectiveType === "fire")
      || (["ちょすい", "よびみず", "かんそうはだ"].includes(defenderAbility) && effectiveType === "water")
      || (["ちくでん", "ひらいしん", "でんきエンジン"].includes(defenderAbility) && effectiveType === "electric")
      || (defenderAbility === "そうしょく" && effectiveType === "grass")
      || (defenderAbility === "どしょく" && effectiveType === "ground");
  }
  if (isAbilityImmune) {
    recordModifier(appliedModifiers, defenderAbility, "ダメージ無効");
  }
  // HP満タン条件を入力するUIがないため、マルチスケイル等は適用しない。
  // 後攻判定UIがないため、アナライズも適用しない。
  const damageIsReducedByDrySkin = defenderAbility === "かんそうはだ" && effectiveType === "fire";
  if (damageIsReducedByDrySkin) recordModifier(appliedModifiers, "かんそうはだ", "ダメージ1.25倍");
  const damageIsReducedByWaterBubble = defenderAbility === "すいほう" && effectiveType === "fire";
  if (damageIsReducedByWaterBubble) recordModifier(appliedModifiers, "すいほう", "ダメージ0.5倍");

  const berry = RESIST_BERRIES[effectiveType];
  const hasBerry = berry && isItem(defenderItem, berry[0], berry[1])
    && (effectiveType === "normal" || effectiveness > 1);
  if (hasBerry) recordModifier(appliedModifiers, berry[0], "ダメージ0.5倍");
  const hasLifeOrb = isItem(itemName, "いのちのたま", "life-orb");
  if (hasLifeOrb) recordModifier(appliedModifiers, "いのちのたま", "ダメージ1.3倍");
  const hasExpertBelt = effectiveness > 1 && isItem(itemName, "たつじんのおび", "expert-belt");
  if (hasExpertBelt) recordModifier(appliedModifiers, "たつじんのおび", "ダメージ1.2倍");
  const hasTintedLens = effectiveness > 0 && effectiveness < 1 && attackerAbility === "いろめがね";
  if (hasTintedLens) recordModifier(appliedModifiers, "いろめがね", "ダメージ2倍");
  const hasFilter = effectiveness > 1 && ["ハードロック", "フィルター"].includes(defenderAbility);
  if (hasFilter) recordModifier(appliedModifiers, defenderAbility, "ダメージ0.75倍");

  const rolls = RANDOM_ROLLS.map((randomValue) => {
    if (effectiveness <= 0 || isAbilityImmune) return 0;
    let damage = Math.floor(baseDamage * randomValue / 100);
    if (hasStab) damage = applyMultiplier(damage, stabMultiplier);
    damage = Math.floor(damage * effectiveness);
    if (move.category === "physical" && isBurned && !hasGuts) {
      damage = applyMultiplier(damage, 0.5);
    }
    if (hasBerry) damage = applyMultiplier(damage, 0.5);
    if (hasTintedLens) damage = applyMultiplier(damage, 2);
    if (hasFilter) damage = applyMultiplier(damage, 0.75);
    if (damageIsReducedByDrySkin) damage = applyMultiplier(damage, 1.25);
    if (damageIsReducedByWaterBubble) damage = applyMultiplier(damage, 0.5);
    if (hasExpertBelt) damage = applyMultiplier(damage, 1.2);
    if (hasLifeOrb) {
      damage = applyMultiplier(damage, 1.3);
    }
    return Math.max(1, damage);
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
    koText: calculateKoText(rolls, maxHp),
    appliedModifiers
  };
}
