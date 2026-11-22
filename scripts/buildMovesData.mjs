import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOVES_INPUT = path.join(PROJECT_ROOT, "moves.txt");
const ENGLISH_INPUT = path.join(PROJECT_ROOT, "moves_en.txt");
const JSON_OUTPUT = path.join(PROJECT_ROOT, "data", "moves.json");

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

const CATEGORY_MAP = Object.freeze({
  "物理": "physical",
  "特殊": "special",
  "変化": "status"
});

/**
 * Read a UTF-8 text file and remove an optional byte-order mark.
 * @param {string} filePath - Absolute input file path.
 * @returns {string} File contents.
 */
function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

/**
 * Parse the Japanese-to-English move name mapping.
 * @param {string} text - Contents of moves_en.txt.
 * @returns {Map<string, string>} Japanese move names mapped to English names.
 */
function parseEnglishNames(text) {
  const names = new Map();

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;

    const columns = rawLine.split("\t");
    if (columns.length !== 2 || !columns[0].trim() || !columns[1].trim()) {
      throw new Error(`Invalid English-name row at line ${index + 1}.`);
    }

    const [japaneseName, englishName] = columns.map((column) => column.trim());
    if (names.has(japaneseName)) {
      throw new Error(`Duplicate English-name mapping for "${japaneseName}".`);
    }
    names.set(japaneseName, englishName);
  }

  return names;
}

/**
 * Convert an English move name into its lowercase hyphenated id.
 * @param {string} englishName - English move name.
 * @returns {string} Generated move id.
 */
function slugEnglishName(englishName) {
  const slug = englishName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  if (!slug) {
    throw new Error(`Cannot generate an id from English name "${englishName}".`);
  }
  return slug;
}

/**
 * Parse a numeric field, treating a hyphen as an unknown value.
 * @param {string} value - Numeric text or "-".
 * @param {string} fieldName - Field name for error reporting.
 * @param {string} moveName - Japanese move name for error reporting.
 * @returns {number | null} Parsed integer or null.
 */
function parseNullableInteger(value, fieldName, moveName) {
  if (value === "-") return null;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${fieldName} "${value}" for "${moveName}".`);
  }
  return Number.parseInt(value, 10);
}

/**
 * Parse paired basic-data and target/effect rows into move records.
 * @param {string} text - Contents of moves.txt.
 * @param {Map<string, string>} englishNames - Japanese-to-English move names.
 * @returns {{id: string, name: string, type: string, category: string, power: number | null, accuracy: number | null, isContact: boolean, isSpread: boolean}[]} Move records.
 */
function buildMoves(text, englishNames) {
  const lines = text.replace(/\r?\n+$/, "").split(/\r?\n/);
  if (lines.length % 2 !== 0) {
    throw new Error(`Expected move data in pairs of lines; found ${lines.length} lines.`);
  }

  const moves = [];
  const ids = new Set();
  const spreadTargets = new Set(["相手全体", "自分以外全体"]);

  for (let index = 0; index < lines.length; index += 2) {
    const basic = lines[index].split("\t").map((column) => column.trim());
    const details = lines[index + 1].split("\t").map((column) => column.trim());
    const [name, japaneseType, japaneseCategory, power, accuracy, , contact] = basic;

    if (basic.length !== 8 || details.length < 2 || basic.some((column) => !column)) {
      throw new Error(`Invalid move data at lines ${index + 1}-${index + 2}.`);
    }
    if (!TYPE_MAP[japaneseType]) {
      throw new Error(`Unknown type "${japaneseType}" for "${name}".`);
    }
    if (!CATEGORY_MAP[japaneseCategory]) {
      throw new Error(`Unknown category "${japaneseCategory}" for "${name}".`);
    }
    if (contact !== "接○" && contact !== "接×") {
      throw new Error(`Unknown contact value "${contact}" for "${name}".`);
    }

    const englishName = englishNames.get(name);
    if (!englishName) {
      throw new Error(`Missing English-name mapping for "${name}".`);
    }

    const id = slugEnglishName(englishName);
    if (ids.has(id)) {
      throw new Error(`Duplicate generated move id "${id}".`);
    }
    ids.add(id);

    moves.push({
      id,
      name,
      type: TYPE_MAP[japaneseType],
      category: CATEGORY_MAP[japaneseCategory],
      power: parseNullableInteger(power, "power", name),
      accuracy: parseNullableInteger(accuracy, "accuracy", name),
      isContact: contact === "接○",
      isSpread: spreadTargets.has(details[0])
    });
  }

  return moves;
}

/**
 * Write all parsed move records to the production JSON file.
 * @param {{id: string, name: string, type: string, category: string, power: number | null, accuracy: number | null, isContact: boolean, isSpread: boolean}[]} moves - Move records.
 * @returns {void}
 */
function writeMoves(moves) {
  fs.mkdirSync(path.dirname(JSON_OUTPUT), { recursive: true });
  fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(moves, null, 2)}\n`, "utf8");
}

const englishNames = parseEnglishNames(readText(ENGLISH_INPUT));
const moves = buildMoves(readText(MOVES_INPUT), englishNames);
writeMoves(moves);

console.log(`Built ${moves.length} move records.`);
console.log(`Wrote ${JSON_OUTPUT}`);
