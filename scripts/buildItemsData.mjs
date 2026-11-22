import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ITEMS_INPUT = path.join(PROJECT_ROOT, "items.txt");
const ENGLISH_INPUT = path.join(PROJECT_ROOT, "items_en.txt");
const JSON_OUTPUT = path.join(PROJECT_ROOT, "data", "items.json");

/**
 * Read a UTF-8 text file and remove an optional byte-order mark.
 * @param {string} filePath - Absolute input file path.
 * @returns {string} File contents.
 */
function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

/**
 * Parse Japanese-to-English item names, keeping the first duplicate mapping.
 * @param {string} text - Contents of items_en.txt.
 * @returns {Map<string, string>} Japanese item names mapped to English names.
 */
function parseEnglishNames(text) {
  const names = new Map();

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;

    const columns = rawLine.split("\t");
    if (columns.length !== 2) {
      throw new Error(`Invalid English-name row at line ${index + 1}.`);
    }

    const japaneseName = columns[0].trim();
    const englishName = columns[1].trim();
    if (!japaneseName) {
      throw new Error(`Missing Japanese item name at line ${index + 1}.`);
    }

    if (englishName && !names.has(japaneseName)) {
      names.set(japaneseName, englishName);
    }
  }

  return names;
}

/**
 * Convert an English item name into a lowercase hyphenated id.
 * Apostrophes and all non-alphanumeric separators are removed or hyphenated.
 * @param {string} englishName - English item name.
 * @returns {string} Generated item id.
 */
function slugEnglishName(englishName) {
  const slug = englishName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error(`Cannot generate an id from English name "${englishName}".`);
  }
  return slug;
}

/**
 * Derive a generic effect type matching the existing snake_case convention.
 * @param {string} id - Generated item id.
 * @returns {string} Generic effect type.
 */
function deriveEffectType(id) {
  return id.replace(/-/g, "_");
}

/**
 * Infer a simple numeric item multiplier from a Japanese description.
 * @param {string} description - Japanese item description.
 * @returns {number} A recognized multiplier, or 1.0.
 */
function inferMultiplier(description) {
  const match = /([0-9]+(?:\.[0-9]+)?)倍/.exec(description);
  if (!match) return 1.0;
  const multiplier = Number.parseFloat(match[1]);
  return Number.isFinite(multiplier) ? multiplier : 1.0;
}

/**
 * Load the existing mega-stone record without changing its schema or values.
 * @returns {{id: string, name: string, effectType: string, multiplier: number, description: string}} Mega-stone record.
 */
function loadMegaStone() {
  const existingText = fs.readFileSync(JSON_OUTPUT, "utf8");
  const existingItems = JSON.parse(existingText);
  if (!Array.isArray(existingItems)) {
    throw new Error("Existing data/items.json must contain an array.");
  }

  const megaStone = existingItems.find((item) =>
    item && typeof item === "object"
    && (item.id === "mega-stone" || item.name === "メガストーン")
  );

  if (!megaStone) {
    throw new Error('Existing data/items.json has no "メガストーン" record.');
  }

  return {
    id: megaStone.id,
    name: megaStone.name,
    effectType: megaStone.effectType,
    multiplier: megaStone.multiplier,
    description: megaStone.description
  };
}

/**
 * Build item records from paired Japanese source rows.
 * @param {string} text - Contents of items.txt.
 * @param {Map<string, string>} englishNames - Japanese-to-English item names.
 * @param {{id: string, name: string, effectType: string, multiplier: number, description: string}[]} existingItems - Existing item records.
 * @returns {{id: string, name: string, effectType: string, multiplier: number, description: string}[]} Converted item records.
 */
function buildItems(text, englishNames, existingItems) {
  const lines = text
    .replace(/\r?\n+$/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length % 2 !== 0) {
    throw new Error(`Expected item data in pairs of lines; found ${lines.length} non-empty lines.`);
  }

  const existingByName = new Map(
    existingItems
      .filter((item) => item && typeof item.name === "string")
      .map((item) => [item.name, item])
  );
  const items = [];
  const names = new Set();
  const ids = new Set();

  for (let index = 0; index < lines.length; index += 2) {
    const oddColumns = lines[index].split("\t").map((column) => column.trim());
    if (oddColumns.length !== 2 || oddColumns.some((column) => !column)) {
      throw new Error(`Invalid item data at line ${index + 1}.`);
    }

    const [name, description] = oddColumns;
    if (name === "メガストーン") continue;
    if (names.has(name)) continue;

    const englishName = englishNames.get(name);
    if (!englishName) {
      throw new Error(`Missing English-name mapping for "${name}".`);
    }

    const id = slugEnglishName(englishName);
    if (ids.has(id)) continue;

    const existing = existingByName.get(name);
    items.push({
      id,
      name,
      effectType: existing?.effectType ?? deriveEffectType(id),
      multiplier: typeof existing?.multiplier === "number"
        ? existing.multiplier
        : inferMultiplier(description),
      description
    });
    names.add(name);
    ids.add(id);
  }

  return items;
}

/**
 * Write the combined production item list.
 * @param {{id: string, name: string, effectType: string, multiplier: number, description: string}[]} items - Item records.
 * @returns {void}
 */
function writeItems(items) {
  fs.mkdirSync(path.dirname(JSON_OUTPUT), { recursive: true });
  fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

let existingItems = [];
try {
  existingItems = JSON.parse(readText(JSON_OUTPUT));
  if (!Array.isArray(existingItems)) existingItems = [];
} catch {
  existingItems = [];
}

const megaStone = loadMegaStone();
const englishNames = parseEnglishNames(readText(ENGLISH_INPUT));
const convertedItems = buildItems(readText(ITEMS_INPUT), englishNames, existingItems);

const seenNames = new Set(["メガストーン"]);
const seenIds = new Set([megaStone.id]);
const finalItems = [megaStone];

for (const item of convertedItems) {
  if (seenNames.has(item.name) || seenIds.has(item.id)) continue;
  seenNames.add(item.name);
  seenIds.add(item.id);
  finalItems.push(item);
}

writeItems(finalItems);

console.log(`Built ${finalItems.length} item records.`);
console.log(`Wrote ${JSON_OUTPUT}`);
