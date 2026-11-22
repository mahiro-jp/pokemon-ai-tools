/**
 * @typedef {{
 *   id: string,
 *   speciesId?: string,
 *   name?: string,
 *   memo?: string,
 *   level?: number,
 *   nature?: string,
 *   ability?: string,
 *   item?: string,
 *   megaForm?: string,
 *   points?: Record<string, number>,
 *   moves?: string[],
 *   updatedAt?: string
 * }} PokemonBuild
 */

const BUILDS_KEY = "pk_app_builds_v1";
const GEMINI_KEY = "pk_app_gemini_key_v1";
const GEMINI_MODEL_KEY = "pk_app_gemini_model_v1";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const LEGACY_GEMINI_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-2.5-pro"
]);
const COPY_SUFFIX = " (コピー)";

/**
 * ブラウザーのlocalStorageを取得する。
 * @returns {Storage} localStorageオブジェクト。
 * @throws {Error} localStorageが利用できない場合。
 */
function getStorage() {
  const storage = globalThis.localStorage;
  if (!storage) {
    throw new Error("localStorageを利用できません。");
  }
  return storage;
}

/**
 * 値が配列ではないオブジェクトか判定する。
 * @param {unknown} value 判定対象。
 * @returns {boolean} オブジェクトの場合はtrue。
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 個体データが保存・インポート可能な構造か検証する。
 * @param {unknown} build 検証対象の値。
 * @returns {build is PokemonBuild} 個体データとして有効な場合はtrue。
 */
function isValidBuild(build) {
  if (!isRecord(build) || typeof build.id !== "string" || build.id.trim() === "") {
    return false;
  }

  const stringFields = [
    "speciesId",
    "name",
    "memo",
    "nature",
    "ability",
    "item",
    "megaForm",
    "updatedAt"
  ];
  if (stringFields.some((field) => build[field] !== undefined && typeof build[field] !== "string")) {
    return false;
  }
  if (build.level !== undefined && typeof build.level !== "number") {
    return false;
  }
  if (build.points !== undefined && !isRecord(build.points)) {
    return false;
  }
  if (build.moves !== undefined && (!Array.isArray(build.moves) || !build.moves.every((move) => typeof move === "string"))) {
    return false;
  }

  return true;
}

/**
 * 保存済みの育成個体一覧を取得する。
 * 未保存、JSON破損、または配列形式でない場合は空配列を返す。
 * @returns {PokemonBuild[]} 保存済みの育成個体一覧。
 */
export function getBuilds() {
  const json = getStorage().getItem(BUILDS_KEY);
  if (json === null) {
    return [];
  }

  let builds;
  try {
    builds = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(builds) || !builds.every(isValidBuild)) {
    return [];
  }
  return builds;
}

/**
 * 個体を新規追加、または同じIDの個体を上書きして保存する。
 * @param {PokemonBuild} build 保存する個体データ。
 * @returns {PokemonBuild} 更新日時を付与した保存済みデータ。
 * @throws {TypeError} 個体データに有効なIDがない場合。
 */
export function saveBuild(build) {
  if (!isValidBuild(build)) {
    throw new TypeError("個体データの形式またはIDが正しくありません。");
  }

  const builds = getBuilds();
  const savedBuild = { ...build, updatedAt: new Date().toISOString() };
  const existingIndex = builds.findIndex((entry) => entry.id === savedBuild.id);
  if (existingIndex === -1) {
    builds.push(savedBuild);
  } else {
    builds[existingIndex] = savedBuild;
  }
  getStorage().setItem(BUILDS_KEY, JSON.stringify(builds));
  return savedBuild;
}

/**
 * 指定IDの個体を削除して保存する。
 * @param {string} id 削除する個体のID。
 * @returns {PokemonBuild[]} 削除後の個体一覧。
 * @throws {TypeError} IDが文字列でない、または空の場合。
 */
export function deleteBuild(id) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError("削除する個体のIDが正しくありません。");
  }

  const builds = getBuilds().filter((build) => build.id !== id);
  getStorage().setItem(BUILDS_KEY, JSON.stringify(builds));
  return builds;
}

/**
 * 指定IDの個体を複製し、新しいIDで保存する。
 * @param {string} id 複製する個体のID。
 * @returns {PokemonBuild} 保存した複製データ。
 * @throws {Error} 指定個体が存在しない場合、またはUUIDを生成できない場合。
 */
export function duplicateBuild(id) {
  const build = getBuilds().find((entry) => entry.id === id);
  if (!build) {
    throw new Error("複製する個体が見つかりません。");
  }
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("個体複製に必要なUUIDを生成できません。");
  }

  const duplicate = {
    ...build,
    id: globalThis.crypto.randomUUID()
  };
  if (typeof build.name === "string" && build.name !== "") {
    duplicate.name = `${build.name}${COPY_SUFFIX}`;
  } else if (typeof build.memo === "string" && build.memo !== "") {
    duplicate.memo = `${build.memo}${COPY_SUFFIX}`;
  } else {
    duplicate.name = COPY_SUFFIX.trim();
  }

  return saveBuild(duplicate);
}

/**
 * 保存済みの全個体を整形済みJSON文字列として出力する。
 * @returns {string} インデント付きJSON文字列。
 */
export function exportBuildsJson() {
  return JSON.stringify(getBuilds(), null, 2);
}

/**
 * JSON形式の個体データを検証し、既存データとIDを基準に統合して保存する。
 * インポートした個体は同じIDの既存個体を上書きする。
 * @param {string} jsonString インポートするJSON文字列。
 * @returns {PokemonBuild[]} 統合して保存した個体一覧。
 * @throws {Error} JSON構文または個体データの形式が正しくない場合。
 */
export function importBuildsJson(jsonString) {
  if (typeof jsonString !== "string") {
    throw new TypeError("インポートするデータはJSON文字列で指定してください。");
  }

  let importedBuilds;
  try {
    importedBuilds = JSON.parse(jsonString);
  } catch {
    throw new Error("JSONを読み取れません。ファイルの内容を確認してください。");
  }
  if (!Array.isArray(importedBuilds)) {
    throw new Error("インポートデータは個体データの配列である必要があります。");
  }
  const invalidIndex = importedBuilds.findIndex((build) => !isValidBuild(build));
  if (invalidIndex !== -1) {
    throw new Error(`インポートデータの${invalidIndex + 1}件目の形式が正しくありません。`);
  }

  const buildsById = new Map(getBuilds().map((build) => [build.id, build]));
  for (const build of importedBuilds) {
    buildsById.set(build.id, build);
  }
  const builds = Array.from(buildsById.values());
  getStorage().setItem(BUILDS_KEY, JSON.stringify(builds));
  return builds;
}

/**
 * 保存済みのGemini APIキーを取得する。
 * @returns {string} APIキー。未設定の場合は空文字列。
 */
export function getApiKey() {
  return getStorage().getItem(GEMINI_KEY) ?? "";
}

/**
 * Gemini APIキーを保存する。
 * @param {string} key 保存するAPIキー。
 * @returns {void}
 * @throws {TypeError} APIキーが文字列でない場合。
 */
export function saveApiKey(key) {
  if (typeof key !== "string") {
    throw new TypeError("Gemini APIキーは文字列で指定してください。");
  }
  getStorage().setItem(GEMINI_KEY, key);
}

/**
 * 使用するGeminiモデル名を取得する。
 * 未設定または空文字列の場合は既定モデル名を返す。
 * @returns {string} Geminiモデル名。
 */
export function getGeminiModel() {
  const savedModel = getStorage().getItem(GEMINI_MODEL_KEY);
  if (!savedModel || LEGACY_GEMINI_MODELS.has(savedModel)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return savedModel;
}

/**
 * 使用するGeminiモデル名を保存する。
 * @param {string} model 保存するモデル名。
 * @returns {void}
 * @throws {TypeError} モデル名が文字列でない場合。
 */
export function saveGeminiModel(model) {
  if (typeof model !== "string") {
    throw new TypeError("Geminiモデル名は文字列で指定してください。");
  }
  getStorage().setItem(GEMINI_MODEL_KEY, model);
}
