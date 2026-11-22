import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POKEMON_INPUT = path.join(PROJECT_ROOT, "pokemon.txt");
const ENGLISH_INPUT = path.join(PROJECT_ROOT, "pokemon_en.txt");
const JSON_OUTPUT = path.join(PROJECT_ROOT, "data", "pokemon.json");
const TEXT_OUTPUT = path.join(PROJECT_ROOT, "formatted_pokemon.txt");

const TYPE_MAP = Object.freeze({
  "ノーマル": "normal",
  "ほのお": "fire",
  "みず": "water",
  "くさ": "grass",
  "でんき": "electric",
  "こおり": "ice",
  "かくとう": "fighting",
  "どく": "poison",
  "じめん": "ground",
  "ひこう": "flying",
  "エスパー": "psychic",
  "むし": "bug",
  "いわ": "rock",
  "ゴースト": "ghost",
  "ドラゴン": "dragon",
  "あく": "dark",
  "はがね": "steel",
  "フェアリー": "fairy"
});

/**
 * Read a UTF-8 text file.
 * @param {string} filePath - Absolute input file path.
 * @returns {string} File contents.
 */
function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

/**
 * Normalize a Pokedex number for lookup.
 * @param {string} id - Pokedex number with or without leading zeroes.
 * @returns {string} Numeric Pokedex number.
 */
function normalizeNumber(id) {
  return String(Number.parseInt(String(id).replace(/:$/, ""), 10));
}

/**
 * Parse the tab-separated Japanese and English name mapping.
 * @param {string} text - Contents of pokemon_en.txt.
 * @returns {Map<string, string>} Pokedex number to English name.
 */
function parseEnglishNames(text) {
  const names = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const columns = line.split("\t");
    if (columns.length < 3) continue;

    names.set(normalizeNumber(columns[0].trim()), columns[2].trim());
  }

  return names;
}

/**
 * Convert an English Pokemon name into a data id slug.
 * @param {string} englishName - English Pokemon name.
 * @returns {string} Lowercase hyphenated id.
 */
function slugEnglishName(englishName) {
  return englishName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Split a Japanese type string into English type names.
 * @param {string} typeText - Japanese type string such as "くさタイプどくタイプ".
 * @returns {string[]} English type names.
 */
function parseTypes(typeText) {
  return typeText
    .split("タイプ")
    .map((type) => type.trim())
    .filter(Boolean)
    .map((type) => TYPE_MAP[type] || type);
}

/**
 * Parse six base stats from a hyphen-separated string.
 * @param {string} statsText - Stat values in hp, atk, def, spa, spd, spe order.
 * @returns {{hp: number, atk: number, def: number, spa: number, spd: number, spe: number}} Parsed stats.
 */
function parseBaseStats(statsText) {
  const values = statsText.split("-").map((value) => Number.parseInt(value.trim(), 10));
  return {
    hp: Number.isFinite(values[0]) ? values[0] : 0,
    atk: Number.isFinite(values[1]) ? values[1] : 0,
    def: Number.isFinite(values[2]) ? values[2] : 0,
    spa: Number.isFinite(values[3]) ? values[3] : 0,
    spd: Number.isFinite(values[4]) ? values[4] : 0,
    spe: Number.isFinite(values[5]) ? values[5] : 0
  };
}

/**
 * Determine whether a Japanese name is an ordinary Pokemon species that only shares a Mega prefix.
 * @param {string} name - Japanese Pokemon name.
 * @returns {boolean} True for normal entries whose names happen to start with メガ.
 */
function isMegaPrefixSpecies(name) {
  return name === "メガニウム" || name === "メガヤンマ";
}

/**
 * Generate the unique id for a Japanese Pokemon form.
 * @param {string} number - Pokedex number.
 * @param {string} name - Japanese Pokemon name.
 * @param {Map<string, string>} englishNames - Pokedex number to English name mapping.
 * @returns {string} Generated id.
 */
function generateId(number, name, englishNames) {
  if (name === "ヒートロトム") return "rotom-heat";
  if (name === "ウォッシュロトム") return "rotom-wash";
  if (name === "フロストロトム") return "rotom-frost";
  if (name === "スピンロトム") return "rotom-fan";
  if (name === "カットロトム") return "rotom-mow";
  if (name === "フラエッテ(えいえん)") return "floette-eternal";

  if (name === "ニャオニクス♂" || name === "イエッサン♂" || name === "イダイトウ♂") {
    const base = number === "678" ? "meowstic" : slugEnglishName(englishNames.get(normalizeNumber(number)) || name);
    return `${base}-m`;
  }
  if (name === "ニャオニクス♀" || name === "イエッサン♀" || name === "イダイトウ♀") {
    const base = number === "678" ? "meowstic" : slugEnglishName(englishNames.get(normalizeNumber(number)) || name);
    return `${base}-f`;
  }
  if (name === "ギルガルド(シールド)") return "aegislash-shield";
  if (name === "ギルガルド(ブレード)") return "aegislash-blade";

  const base = slugEnglishName(englishNames.get(normalizeNumber(number)) || name);
  if (name.endsWith("(アローラ)")) return `${base}-alola`;
  if (name.endsWith("(ガラル)")) return `${base}-galar`;
  if (name.endsWith("(ヒスイ)")) return `${base}-hisui`;
  if (name.endsWith("(パルデア単)")) return `${base}-paldea-combat`;
  if (name.endsWith("(パルデア炎)")) return `${base}-paldea-blaze`;
  if (name.endsWith("(パルデア水)")) return `${base}-paldea-aqua`;
  if (name.endsWith("(普通)")) return `${base}-average`;
  if (name.endsWith("(小)")) return `${base}-small`;
  if (name.endsWith("(大)")) return `${base}-large`;
  if (name.endsWith("(特大)")) return `${base}-super`;
  if (name.endsWith("(まひる)")) return `${base}-midday`;
  if (name.endsWith("(まよなか)")) return `${base}-midnight`;
  if (name.endsWith("(たそがれ)")) return `${base}-dusk`;
  if (name.endsWith("(ハイ)")) return `${base}-amped`;
  if (name.endsWith("(ロー)")) return `${base}-low-key`;
  if (name.endsWith("(ナイーブ)")) return `${base}-zero`;
  if (name.endsWith("(マイティ)")) return `${base}-hero`;

  return base;
}

/**
 * Parse every Pokedex entry in pokemon.txt.
 * @param {string} text - Contents of pokemon.txt.
 * @returns {{number: string, name: string, types: string[], abilities: string[], baseStats: object}[]} Pokemon entries.
 */
function parsePokemonEntries(text) {
  const entries = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);

  for (let index = 0; index < lines.length;) {
    const numberMatch = /^(\d{3,4}):$/.exec(lines[index]);
    if (!numberMatch) {
      index++;
      continue;
    }

    const number = normalizeNumber(numberMatch[1]);
    const name = lines[index + 1] || "";
    const typeText = lines[index + 2] || "";
    const statsText = lines[index + 3] || "";
    const entryLines = [name, typeText, statsText];
    let cursor = index + 4;
    const abilities = [];

    while (cursor < lines.length && !/^\d{3,4}:$/.test(lines[cursor])) {
      abilities.push(lines[cursor]);
      cursor++;
    }

    entries.push({
      number,
      name,
      types: parseTypes(typeText),
      abilities,
      baseStats: parseBaseStats(statsText)
    });
    index = cursor;
  }

  return entries;
}

/**
 * Merge Mega entries into the directly preceding normal form of the same Pokedex number.
 * @param {{number: string, name: string, types: string[], abilities: string[], baseStats: object}[]} entries - Parsed entries.
 * @param {Map<string, string>} englishNames - Pokedex number to English name mapping.
 * @returns {object[]} Completed Pokemon JSON records.
 */
function buildPokemonData(entries, englishNames) {
  const pokemon = [];
  const lastNormalByNumber = new Map();
  const normalByNumberAndName = new Map();

  for (const entry of entries) {
    const isMegaEntry = entry.name.startsWith("メガ") && !isMegaPrefixSpecies(entry.name);

    if (isMegaEntry) {
      const megaName = entry.name.replace(/^メガ/, "");
      const normalNameCandidates = [
        megaName,
        entry.number === "670" ? "フラエッテ(えいえん)" : ""
      ].filter(Boolean);
      let base = null;
      const byName = normalByNumberAndName.get(entry.number);
      if (byName) {
        base = normalNameCandidates.map((candidate) => byName.get(candidate)).find(Boolean) || null;
      }
      base = base || lastNormalByNumber.get(entry.number);
      if (base) {
        base.megaForms.push({
          name: entry.name,
          types: entry.types,
          ability: entry.abilities[0] || "",
          baseStats: entry.baseStats
        });
      } else {
        pokemon.push({
          id: generateId(entry.number, entry.name, englishNames),
          name: entry.name,
          types: entry.types,
          abilities: entry.abilities,
          baseStats: entry.baseStats,
          megaForms: []
        });
      }
      continue;
    }

    const record = {
      id: generateId(entry.number, entry.name, englishNames),
      name: entry.name,
      types: entry.types,
      abilities: entry.abilities,
      baseStats: entry.baseStats,
      megaForms: []
    };
    pokemon.push(record);
    lastNormalByNumber.set(entry.number, record);
    if (!normalByNumberAndName.has(entry.number)) {
      normalByNumberAndName.set(entry.number, new Map());
    }
    normalByNumberAndName.get(entry.number).set(entry.name, record);
  }

  return pokemon;
}

/**
 * Format Pokemon records into an easy-to-read confirmation text.
 * @param {object[]} pokemon - Completed Pokemon records.
 * @param {{number: string}[]} entries - Parsed entries used to map record numbers.
 * @returns {string} One record per line.
 */
function formatConfirmation(pokemon, entries) {
  const lines = [];

  for (const record of pokemon) {
    const source = entries.find((entry) => entry.name === record.name);
    const number = source ? source.number : "";
    const stats = record.baseStats;
    const megaNames = record.megaForms.map((form) => form.name).join(", ");

    lines.push([
      number,
      record.id,
      record.name,
      record.types.join("/"),
      `${stats.hp}-${stats.atk}-${stats.def}-${stats.spa}-${stats.spd}-${stats.spe}`,
      record.abilities.join("/"),
      megaNames
    ].join(" | "));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Write JSON and confirmation files.
 * @param {object[]} pokemon - Completed Pokemon records.
 * @param {string} confirmationText - Confirmation file contents.
 * @returns {void}
 */
function writeOutputs(pokemon, confirmationText) {
  fs.mkdirSync(path.dirname(JSON_OUTPUT), { recursive: true });
  fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(pokemon, null, 2)}\n`, "utf8");
  fs.writeFileSync(TEXT_OUTPUT, confirmationText, "utf8");
}

const englishNames = parseEnglishNames(readText(ENGLISH_INPUT));
const entries = parsePokemonEntries(readText(POKEMON_INPUT));
const pokemon = buildPokemonData(entries, englishNames);
writeOutputs(pokemon, formatConfirmation(pokemon, entries));

console.log(`Built ${pokemon.length} Pokemon records.`);
console.log(`Wrote ${JSON_OUTPUT}`);
console.log(`Wrote ${TEXT_OUTPUT}`);
