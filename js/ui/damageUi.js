import {
  calculateDamage,
  calculateStats,
  resolveEffectiveSpecies
} from "../calculator.js";
import { getBuilds } from "../storage.js";
import { createSearchableInput } from "./searchableSelect.js";

/**
 * @typedef {"hp" | "atk" | "def" | "spa" | "spd" | "spe"} StatName 能力値の識別子。
 * @typedef {{ id?: string, name: string, types?: string[], abilities?: string[], baseStats?: Partial<Record<StatName, number>>, megaForms?: MegaForm[] }} Species 種族マスターデータ。
 * @typedef {{ name: string, types?: string[], ability?: string, baseStats?: Partial<Record<StatName, number>> }} MegaForm メガフォルムのマスターデータ。
 * @typedef {{ name: string, up?: StatName | null, down?: StatName | null }} Nature 性格マスターデータ。
 * @typedef {{ name: string, type?: string, category?: string, power?: number, isSpread?: boolean, isContact?: boolean }} Move 技マスターデータ。
 * @typedef {{ name: string }} Item 持ち物マスターデータ。
 * @typedef {{ id: string, speciesId?: string, name?: string, memo?: string, level?: number, nature?: string, ability?: string, item?: string, megaForm?: string, points?: Partial<Record<StatName, number>>, moves?: string[], updatedAt?: string }} PokemonBuild 保存済み育成個体データ。
 * @typedef {{ pokemon?: Species[], natures?: Nature[], items?: Item[], moves?: Move[] }} DamageMasterData ダメージ画面で使用するマスターデータ。
 * @typedef {{ build: PokemonBuild, speciesId: string, rank: number }} SideState 攻撃側または防御側の表示状態。
 */

const LEVEL = 50;
const MAX_POINT = 32;
const STAT_ROWS = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "攻撃" },
  { key: "def", label: "防御" },
  { key: "spa", label: "特攻" },
  { key: "spd", label: "特防" },
  { key: "spe", label: "素早さ" }
];

/** @type {DamageMasterData} */
let masterData = {};
/** @type {HTMLElement | null} */
let rootElement = null;
/** @type {Map<string, PokemonBuild>} */
let savedBuildsById = new Map();
/** @type {string} */
let selectedMoveName = "";
/** @type {string[]} */
let attackerMoveNames = [];
/** @type {Map<"attacker" | "defender", ReturnType<typeof createSearchableInput>>} */
let speciesSearchInputs = new Map();
/** @type {ReturnType<typeof createSearchableInput> | null} */
let moveSearchInput = null;

/**
 * @typedef {object} DamageSideState
 * @property {PokemonBuild} build 個体データ。
 * @property {number} rank ランク補正。
 */

/** @type {{ attacker: DamageSideState, defender: DamageSideState }} */
let sideStates = {
  attacker: {
    build: {
      id: "direct-attacker",
      speciesId: "",
      name: "",
      level: LEVEL,
      nature: "",
      ability: "",
      item: "なし",
      megaForm: "",
      points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: []
    },
    rank: 0
  },
  defender: {
    build: {
      id: "direct-defender",
      speciesId: "",
      name: "",
      level: LEVEL,
      nature: "",
      ability: "",
      item: "なし",
      megaForm: "",
      points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: []
    },
    rank: 0
  }
};

/**
 * 配列以外のマスターデータを安全に配列へ変換する。
 * @template T
 * @param {unknown} value 確認する値。
 * @returns {T[]} 配列または空配列。
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * HTMLへ執り込む文字列をエスケープする。
 * @param {unknown} value 表示する値。
 * @returns {string} エスケープ済み文字列。
 */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

/**
 * 個体の能力ポイントを安全な範囲へ正規化する。
 * @param {PokemonBuild} build 正規化対象の個体。
 * @returns {PokemonBuild} 正規化した個体。
 */
function normalizeBuild(build) {
  const points = {};
  for (const { key } of STAT_ROWS) {
    const numericPoint = Number(build.points?.[key]);
    points[key] = Number.isFinite(numericPoint)
      ? Math.min(MAX_POINT, Math.max(0, Math.trunc(numericPoint)))
      : 0;
  }
  return {
    id: build.id || "",
    speciesId: build.speciesId || "",
    name: build.name || "",
    memo: build.memo || "",
    level: LEVEL,
    nature: build.nature || "",
    ability: build.ability || "",
    item: build.item || "なし",
    megaForm: build.megaForm || "",
    points,
    moves: asArray(build.moves).filter((move) => typeof move === "string")
  };
}

/**
 * 保存済み個体プルダウンを再描画する。
 * @returns {void}
 */
export function refreshDamageSavedBuilds() {
  if (!rootElement) return;
  for (const side of ["attacker", "defender"]) {
    const select = rootElement.querySelector(`#damage-${side}-saved`);
    if (!(select instanceof HTMLSelectElement)) continue;
    const previousValue = select.value;
    const builds = getBuilds();
    savedBuildsById = new Map(builds.map((build) => [build.id, build]));
    const pokemon = asArray(masterData.pokemon);
    select.innerHTML = [
      '<option value="">保存済み個体を選択</option>',
      ...builds.map((build) => {
        const species = pokemon.find((entry) => entry.id === build.speciesId);
        const label = build.name?.trim() || species?.name || "名称未設定";
        return `<option value="${escapeHtml(build.id)}">${escapeHtml(label)}</option>`;
      })
    ].join("");
    if (builds.some((build) => build.id === previousValue)) {
      select.value = previousValue;
    }
  }
}

/**
 * 指定された個体を攻撃側または防御側へ反映する。
 * @param {"attacker" | "defender"} side 個体をセットするペイン。
 * @param {PokemonBuild} build セットする個体データ。
 * @returns {void}
 */
export function setPokemonToSide(side, build) {
  if (side !== "attacker" && side !== "defender") return;
  if (!rootElement || !build || typeof build !== "object") return;

  sideStates[side].build = normalizeBuild(build);
  if (side === "attacker") {
    const buildMoves = asArray(build.moves).filter((move) => typeof move === "string");
    attackerMoveNames = Array.from({ length: 4 }, (_, index) => buildMoves[index] || "");
    selectedMoveName = attackerMoveNames.find((move) => move) || selectedMoveName;
  }
  fillSide(side, sideStates[side].build);
  updateMoveButtons();
  calculateAndRender();
}

/**
 * 種族、特性、持ち物、メガフォルムの選択肢を更新する。
 * @param {"attacker" | "defender"} side 対象ペイン。
 * @param {string} selectedAbility 選択する特性。
 * @param {string} selectedMega 選択するメガフォルム。
 * @returns {void}
 */
function updateSideOptions(side, selectedAbility = "", selectedMega = "") {
  if (!rootElement) return;
  const pokemon = asArray(masterData.pokemon);
  const items = asArray(masterData.items);
  const abilitySelect = rootElement.querySelector(`#damage-${side}-ability`);
  const itemSelect = rootElement.querySelector(`#damage-${side}-item`);
  const megaSelect = rootElement.querySelector(`#damage-${side}-mega`);
  const megaField = rootElement.querySelector(`#damage-${side}-mega-field`);
  if (!(abilitySelect instanceof HTMLSelectElement)
    || !(itemSelect instanceof HTMLSelectElement)
    || !(megaSelect instanceof HTMLSelectElement)
    || !(megaField instanceof HTMLElement)) return;

  const species = pokemon.find((entry) => entry.id === sideStates[side].build.speciesId);
  const megaForms = asArray(species?.megaForms).filter((form) => typeof form?.name === "string");
  const abilities = asArray(species?.abilities).filter((ability) => typeof ability === "string");
  const selectedForm = megaForms.find((form) => form.name === selectedMega);

  const abilityOptions = abilities.map((ability) => ({ value: ability, label: ability }));
  if (typeof selectedForm?.ability === "string"
    && !abilityOptions.some((option) => option.value === selectedForm.ability)) {
    abilityOptions.unshift({
      value: selectedForm.ability,
      label: `${selectedForm.ability}（${selectedForm.name}）`
    });
  }
  abilitySelect.innerHTML = [
    '<option value="">特性を選択</option>',
    ...abilityOptions.map((option) =>
      `<option value="${escapeHtml(option.value)}"${option.value === (selectedAbility || selectedForm?.ability || abilities[0] || "") ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
  ].join("");

  const itemNames = items
    .filter((item) => typeof item?.name === "string")
    .map((item) => item.name);
  if (!itemNames.includes("なし")) itemNames.unshift("なし");
  itemSelect.innerHTML = itemNames.map((itemName) =>
    `<option value="${escapeHtml(itemName)}"${itemName === itemSelect.value ? " selected" : ""}>${escapeHtml(itemName)}</option>`
  ).join("");
  if (!Array.from(itemSelect.options).some((option) => option.value === itemSelect.value)) {
    itemSelect.value = "なし";
  }

  megaField.hidden = megaForms.length === 0;
  megaSelect.innerHTML = [
    '<option value="">通常</option>',
    ...megaForms.map((form) =>
      `<option value="${escapeHtml(form.name)}"${form.name === selectedMega ? " selected" : ""}>${escapeHtml(form.name)}</option>`
    )
  ].join("");
  if (megaForms.length === 0) megaSelect.value = "";
}

/**
 * 指定ペインの種族変更とメガシンカ連動を処理する。
 * @param {"attacker" | "defender"} side 対象ペイン。
 * @param {string} selectedSpecies 選択された種族ID。
 * @returns {void}
 */
function applySpeciesSide(side, selectedSpecies) {
  if (!rootElement) return;
  const megaSelect = rootElement.querySelector(`#damage-${side}-mega`);
  const itemSelect = rootElement.querySelector(`#damage-${side}-item`);
  if (!(megaSelect instanceof HTMLSelectElement)
    || !(itemSelect instanceof HTMLSelectElement)) return;
  if (sideStates[side].build.speciesId === selectedSpecies) return;

  const build = readSideState(side);
  build.speciesId = selectedSpecies;
  build.megaForm = "";
  build.item = "なし";
  megaSelect.value = "";
  itemSelect.value = "なし";
  sideStates[side].build = build;
  updateSideOptions(side);
  updateSideStats(side);
  calculateAndRender();
}

/**
 * ペインの選択値から育成個体データを作成する。
 * @param {"attacker" | "defender"} side 対象ペイン。
 * @returns {PokemonBuild} 現在の個体データ。
 */
function readSideState(side) {
  if (!rootElement) return normalizeBuild(sideStates[side].build);
  const natureSelect = rootElement.querySelector(`#damage-${side}-nature`);
  const abilitySelect = rootElement.querySelector(`#damage-${side}-ability`);
  const itemSelect = rootElement.querySelector(`#damage-${side}-item`);
  const megaSelect = rootElement.querySelector(`#damage-${side}-mega`);
  const build = normalizeBuild(sideStates[side].build);

  if (natureSelect instanceof HTMLSelectElement) build.nature = natureSelect.value;
  if (abilitySelect instanceof HTMLSelectElement) build.ability = abilitySelect.value;
  if (itemSelect instanceof HTMLSelectElement) build.item = itemSelect.value || "なし";
  if (megaSelect instanceof HTMLSelectElement) build.megaForm = megaSelect.value || "";

  for (const { key } of STAT_ROWS) {
    const input = rootElement.querySelector(`#damage-${side}-point-${key}`);
    build.points[key] = input instanceof HTMLInputElement
      ? Math.min(MAX_POINT, Math.max(0, Number(input.value) || 0))
      : build.points[key] || 0;
  }
  sideStates[side].build = build;
  return build;
}

/**
 * 指定ペインの種族、能力ポイント、性格に基づき実数値とランクを更新する。
 * @param {"attacker" | "defender"} side 対象ペイン。
 * @returns {void}
 */
function updateSideStats(side) {
  if (!rootElement) return;
  const pokemon = asArray(masterData.pokemon);
  const natures = asArray(masterData.natures);
  const build = readSideState(side);
  const species = pokemon.find((entry) => entry.id === build.speciesId);
  if (!species) {
    for (const { key } of STAT_ROWS) {
      const base = rootElement.querySelector(`#damage-${side}-base-${key}`);
      const final = rootElement.querySelector(`#damage-${side}-final-${key}`);
      if (base) base.textContent = "—";
      if (final) final.textContent = "—";
    }
    return;
  }

  const effectiveSpecies = resolveEffectiveSpecies(species, build);
  const stats = calculateStats(effectiveSpecies, build, natures);
  const natureSelect = rootElement.querySelector(`#damage-${side}-nature`);
  const natureName = natureSelect instanceof HTMLSelectElement ? natureSelect.value : build.nature;
  const nature = natures.find((entry) => entry.name === natureName);

  for (const { key } of STAT_ROWS) {
    const base = rootElement.querySelector(`#damage-${side}-base-${key}`);
    const final = rootElement.querySelector(`#damage-${side}-final-${key}`);
    const row = rootElement.querySelector(`#damage-${side}-row-${key}`);
    if (base) base.textContent = String(effectiveSpecies.baseStats?.[key] ?? "—");
    if (final) final.textContent = String(stats[key]);
    if (row instanceof HTMLElement) {
      row.classList.toggle("is-nature-up", nature?.up === key);
      row.classList.toggle("is-nature-down", nature?.down === key);
    }
  }
}

/**
 * 保存済み個体または直接編集の内容をペインへ反映する。
 * @param {"attacker" | "defender"} side 対象ペイン。
 * @param {PokemonBuild} build 表示する個体。
 * @returns {void}
 */
function fillSide(side, build) {
  if (!rootElement) return;
  const pokemon = asArray(masterData.pokemon);
  const natures = asArray(masterData.natures);
  const normalized = normalizeBuild(build);
  sideStates[side].build = normalized;

  const speciesSearch = speciesSearchInputs.get(side);
  const natureSelect = rootElement.querySelector(`#damage-${side}-nature`);
  const savedSelect = rootElement.querySelector(`#damage-${side}-saved`);
  if (speciesSearch) {
    const speciesExists = pokemon.some((species) => species.id === normalized.speciesId);
    speciesSearch.setValue(speciesExists ? normalized.speciesId : null);
  }
  if (natureSelect instanceof HTMLSelectElement) {
    const selectedNature = natures.some((nature) => nature.name === normalized.nature)
      ? normalized.nature
      : natures[0]?.name || "";
    natureSelect.value = selectedNature;
  }
  if (savedSelect instanceof HTMLSelectElement && normalized.id) {
    savedSelect.value = savedBuildsById.has(normalized.id) ? normalized.id : "";
  }

  const itemSelect = rootElement.querySelector(`#damage-${side}-item`);
  if (itemSelect instanceof HTMLSelectElement) itemSelect.value = normalized.item || "なし";
  updateSideOptions(side, normalized.ability, normalized.megaForm);

  const megaSelect = rootElement.querySelector(`#damage-${side}-mega`);
  if (megaSelect instanceof HTMLSelectElement) megaSelect.value = normalized.megaForm || "";
  if (normalized.megaForm) {
    if (itemSelect instanceof HTMLSelectElement) itemSelect.value = "メガストーン";
  }

  const species = pokemon.find((entry) => entry.id === normalized.speciesId);
  if (species && normalized.ability) {
    const megaForm = asArray(species.megaForms).find((form) => form.name === normalized.megaForm);
    updateSideOptions(side, normalized.ability || megaForm?.ability || "", normalized.megaForm);
  }

  for (const { key } of STAT_ROWS) {
    const input = rootElement.querySelector(`#damage-${side}-point-${key}`);
    if (input instanceof HTMLInputElement) {
      input.value = String(normalized.points[key] ?? 0);
    }
  }
  const rankSelect = rootElement.querySelector(`#damage-${side}-rank`);
  if (rankSelect instanceof HTMLSelectElement) rankSelect.value = String(sideStates[side].rank);
  updateSideStats(side);
}

/**
 * 攻守入替時にペインの状態を交換する。
 * @returns {void}
 */
function swapSides() {
  const attacker = sideStates.attacker;
  const defender = sideStates.defender;
  sideStates.attacker = {
    build: normalizeBuild(defender.build),
    rank: defender.rank
  };
  sideStates.defender = {
    build: normalizeBuild(attacker.build),
    rank: attacker.rank
  };
  fillSide("attacker", sideStates.attacker.build);
  fillSide("defender", sideStates.defender.build);
  if (attackerMoveNames.length > 0) {
    const attackerBuild = sideStates.attacker.build;
    attackerMoveNames = asArray(attackerBuild.moves).slice(0, 4);
  }
  updateMoveButtons();
  calculateAndRender();
}

/**
 * 技ボタンの選択表示と技情報を更新する。
 * @param {boolean} syncSearchInput 検索欄の表示も同期する場合はtrue。
 * @returns {void}
 */
function updateMoveButtons(syncSearchInput = true) {
  if (!rootElement) return;
  const moves = asArray(masterData.moves).filter((move) => typeof move?.name === "string");
  const moveButtons = rootElement.querySelectorAll("[data-damage-move]");

  moveButtons.forEach((button, index) => {
    if (!(button instanceof HTMLElement)) return;
    const moveName = attackerMoveNames[index] || "";
    const move = moves.find((entry) => entry.name === moveName);
    button.innerHTML = move
      ? `<span>${escapeHtml(move.name)}</span><small>${escapeHtml(move.type || "不明")}・${escapeHtml(move.category === "physical" ? "物理" : move.category === "special" ? "特殊" : "変化")}・威力${escapeHtml(move.power ?? "—")}</small>`
      : `<span>未選択${index + 1}</span><small>技を選択</small>`;
    button.classList.toggle("is-selected", selectedMoveName === moveName && moveName !== "");
  });

  const selectedMove = moves.find((move) => move.name === selectedMoveName);
  if (syncSearchInput) moveSearchInput?.setValue(selectedMove ? selectedMove.name : null);
  const badge = rootElement.querySelector("#damage-selected-move-badge");
  if (badge instanceof HTMLElement) {
    badge.innerHTML = selectedMove
      ? `<span>${escapeHtml(selectedMove.type || "不明")}</span><span>${escapeHtml(selectedMove.category === "physical" ? "物理" : selectedMove.category === "special" ? "特殊" : "変化")}</span><span>威力${escapeHtml(selectedMove.power ?? "—")}</span>`
      : "<span>技未選択</span>";
  }
}

/**
 * ダメージ計算を実行し、結果パネルを更新する。
 * @returns {void}
 */
function calculateAndRender() {
  if (!rootElement) return;
  const pokemon = asArray(masterData.pokemon);
  const natures = asArray(masterData.natures);
  const moves = asArray(masterData.moves);
  const attackerBuild = readSideState("attacker");
  const defenderBuild = readSideState("defender");
  const attackerSpecies = pokemon.find((entry) => entry.id === attackerBuild.speciesId);
  const defenderSpecies = pokemon.find((entry) => entry.id === defenderBuild.speciesId);
  const move = moves.find((entry) => entry.name === selectedMoveName);

  updateSideStats("attacker");
  updateSideStats("defender");

  const resultElement = rootElement.querySelector("#damage-result");
  if (!(resultElement instanceof HTMLElement)) return;
  if (!attackerSpecies || !defenderSpecies || !move) {
    resultElement.innerHTML = '<p class="damage-result-empty">攻撃側、防御側、技を選択するとダメージを表示します。</p>';
    return;
  }

  const critical = rootElement.querySelector("#damage-critical");
  const burned = rootElement.querySelector("#damage-burn");
  const double = rootElement.querySelector("#damage-double");
  const weather = rootElement.querySelector("#damage-weather");
  const fieldOptions = {
    isCritical: critical instanceof HTMLInputElement ? critical.checked : false,
    isBurned: burned instanceof HTMLInputElement ? burned.checked : false,
    isDoubleBattle: double instanceof HTMLInputElement ? double.checked : false,
    weather: weather instanceof HTMLSelectElement ? weather.value : "",
    attackerRank: sideStates.attacker.rank,
    defenderRank: sideStates.defender.rank
  };

  const effectiveDefender = resolveEffectiveSpecies(defenderSpecies, defenderBuild);
  const defenderStats = calculateStats(
    effectiveDefender,
    defenderBuild,
    natures
  );
  const result = calculateDamage(
    attackerBuild,
    attackerSpecies,
    defenderBuild,
    defenderSpecies,
    move,
    fieldOptions,
    { natures }
  );

  const remainingMin = Math.max(0, defenderStats.hp - result.maxDamage);
  const remainingMax = Math.max(0, defenderStats.hp - result.minDamage);
  const remainingPercent = defenderStats.hp > 0
    ? Math.round(remainingMin / defenderStats.hp * 100)
    : 0;
  const koClass = /^確定/.test(result.koText) ? "is-ko" : "";

  resultElement.innerHTML = `
    <div class="damage-result-heading">
      <div>
        <p>ダメージ量</p>
        <strong>${result.minDamage} ～ ${result.maxDamage}</strong>
      </div>
      <div>
        <p>HP割合</p>
        <strong>${result.minPercent.toFixed(1)}% ～ ${result.maxPercent.toFixed(1)}%</strong>
      </div>
    </div>
    <p class="damage-ko ${koClass}">${escapeHtml(result.koText)}</p>
    <div class="damage-hp-bar" role="img" aria-label="最低ダメージ後の残りHP約${remainingPercent}%">
      <div class="damage-hp-remaining" style="width:${Math.max(0, Math.min(100, remainingPercent))}%"></div>
    </div>
    <p class="damage-hp-text">残りHP目安: ${remainingMin} ～ ${remainingMax} / ${defenderStats.hp}</p>
    ${result.appliedModifiers.length > 0
      ? `<p class="damage-modifiers">補正: ${result.appliedModifiers.map((modifier) => `<span>${escapeHtml(modifier)}</span>`).join("")}</p>`
      : ""}
    <div class="damage-rolls" aria-label="16段階のダメージ乱数">
      ${result.rolls.map((damage, index) => `
        <span title="${85 + index}%乱数"><strong>${damage}</strong><small>${85 + index}%</small></span>
      `).join("")}
    </div>
  `;
}

/**
 * ペインの共通HTMLを作成する。
 * @param {"attacker" | "defender"} side 対象ペイン。
 * @returns {string} ペインのHTML。
 */
function createSideHtml(side) {
  const title = side === "attacker" ? "攻撃側" : "防御側";
  const rankOptions = Array.from({ length: 13 }, (_, index) => {
    const rank = index - 6;
    return `<option value="${rank}">${rank >= 0 ? `+${rank}` : String(rank)}</option>`;
  }).join("");
  const natureOptions = asArray(masterData.natures)
    .filter((nature) => typeof nature?.name === "string")
    .map((nature) => `<option value="${escapeHtml(nature.name)}">${escapeHtml(nature.name)}</option>`)
    .join("");
  const statRows = STAT_ROWS.map(({ key, label }) => `
    <tr id="damage-${side}-row-${key}">
      <th scope="row">${label}</th>
      <td id="damage-${side}-base-${key}">—</td>
      <td>
        <input
          id="damage-${side}-point-${key}"
          type="number"
          min="0"
          max="${MAX_POINT}"
          step="1"
          value="0"
          inputmode="numeric"
          aria-label="${title}${label}能力ポイント"
        >
      </td>
      <td id="damage-${side}-final-${key}" aria-live="polite">—</td>
    </tr>
  `).join("");

  return `
    <section class="damage-side damage-side-${side}" aria-labelledby="damage-${side}-title">
      <h3 id="damage-${side}-title">${title}</h3>
      <div class="damage-side-fields">
        <label class="form-field" for="damage-${side}-saved">
          <span>保存済み個体の呼び出し</span>
          <select id="damage-${side}-saved"></select>
        </label>
        <label class="form-field" for="damage-${side}-species">
          <span>ポケモン名</span>
          <div id="damage-${side}-species-input"></div>
        </label>
        <label class="form-field" for="damage-${side}-nature">
          <span>性格</span>
          <select id="damage-${side}-nature">
            <option value="">性格を選択</option>
            ${natureOptions}
          </select>
        </label>
        <label class="form-field" for="damage-${side}-ability">
          <span>特性</span>
          <select id="damage-${side}-ability"></select>
        </label>
        <label class="form-field" for="damage-${side}-item">
          <span>持ち物</span>
          <select id="damage-${side}-item"></select>
        </label>
        <label class="form-field" id="damage-${side}-mega-field" for="damage-${side}-mega">
          <span>メガシンカ</span>
          <select id="damage-${side}-mega"></select>
        </label>
        <label class="form-field" for="damage-${side}-rank">
          <span>ランク補正</span>
          <select id="damage-${side}-rank">${rankOptions}</select>
        </label>
      </div>
      <div class="damage-stats-scroll">
        <table class="damage-stats-table">
          <thead>
            <tr><th scope="col">能力</th><th scope="col">種族値</th><th scope="col">能力ポイント</th><th scope="col">実数値</th></tr>
          </thead>
          <tbody>${statRows}</tbody>
        </table>
      </div>
    </section>
  `;
}

/**
 * ダメージ画面を初期化する。
 * @param {DamageMasterData} data 種族・性格・持ち物・技のマスターデータ。
 * @returns {void}
 * @throws {Error} ダメージ画面の描画先がない場合。
 */
export function initDamageUi(data) {
  const root = document.getElementById("damage-ui-root");
  if (!root) throw new Error("ダメージ計算画面の描画先が見つかりません。");

  masterData = data && typeof data === "object"
    ? data
    : { pokemon: [], natures: [], items: [], moves: [] };
  rootElement = root;
  root.innerHTML = `
    <div class="damage-layout">
      <div class="damage-panes">
        ${createSideHtml("attacker")}
        <div class="damage-swap-column">
          <button class="button button-secondary damage-swap-button" type="button">攻守入替</button>
        </div>
        ${createSideHtml("defender")}
      </div>
      <section class="damage-moves-section" aria-labelledby="damage-moves-title">
        <h3 id="damage-moves-title">攻撃技</h3>
        <div class="damage-move-buttons" aria-label="技4枠">
          ${Array.from({ length: 4 }, (_, index) => `
            <button class="damage-move-button" type="button" data-damage-move="${index}"></button>
          `).join("")}
        </div>
        <label class="form-field" for="damage-move-select">
          <span>技を直接選択</span>
          <div id="damage-move-input"></div>
        </label>
        <div class="damage-selected-move-badge" id="damage-selected-move-badge"></div>
      </section>
      <section class="damage-options" aria-labelledby="damage-options-title">
        <h3 id="damage-options-title">バトル環境</h3>
        <label class="damage-check"><input id="damage-critical" type="checkbox">急所</label>
        <label class="damage-check"><input id="damage-burn" type="checkbox">やけど（攻撃側）</label>
        <label class="damage-check"><input id="damage-double" type="checkbox">ダブルバトル</label>
        <label class="form-field" for="damage-weather">
          <span>天気</span>
          <select id="damage-weather">
            <option value="">なし</option>
            <option value="晴れ">はれ</option>
            <option value="雨">あめ</option>
          </select>
        </label>
      </section>
      <section class="damage-result" id="damage-result" aria-live="polite">
        <p class="damage-result-empty">攻撃側、防御側、技を選択するとダメージを表示します。</p>
      </section>
    </div>
  `;

  speciesSearchInputs = new Map();
  for (const side of ["attacker", "defender"]) {
    const mount = root.querySelector(`#damage-${side}-species-input`);
    if (!(mount instanceof HTMLElement)) {
      throw new Error(`${side === "attacker" ? "攻撃側" : "防御側"}のポケモン検索欄を準備できません。`);
    }
    const search = createSearchableInput({
      id: `damage-${side}-species`,
      placeholder: "ポケモン名を検索",
      items: asArray(masterData.pokemon)
        .filter((species) => typeof species?.id === "string" && typeof species?.name === "string")
        .map((species) => ({ value: species.id, label: species.name })),
      onSelect: (value) => applySpeciesSide(side, String(value)),
      onClear: () => applySpeciesSide(side, "")
    });
    mount.append(search.element);
    speciesSearchInputs.set(side, search);
    /**
     * 検索欄の確定済みポケモンを対象ペインへ反映する。
     * @returns {void}
     */
    function syncSpeciesSelection() {
      const speciesId = String(search.getValue() ?? "");
      if (speciesId !== sideStates[side].build.speciesId) {
        applySpeciesSide(side, speciesId);
      }
    }
    search.input.addEventListener("input", syncSpeciesSelection);
    search.input.addEventListener("compositionend", syncSpeciesSelection);
  }

  const moveMount = root.querySelector("#damage-move-input");
  if (!(moveMount instanceof HTMLElement)) {
    throw new Error("技の検索欄を準備できません。");
  }
  const moveItems = asArray(masterData.moves)
    .filter((move) => typeof move?.name === "string")
    .map((move) => {
      const category = move.category === "physical" ? "物理"
        : move.category === "special" ? "特殊"
          : move.category === "status" ? "変化" : "分類不明";
      return {
        value: move.name,
        label: move.name,
        subText: `${move.type || "不明"}・${category}・威力${move.power ?? "—"}`
      };
    });

  /**
   * 検索欄で選んだ技を選択中の技と技枠へ反映する。
   * @param {string | number} value 選択された技名。
   * @returns {void}
   */
  function selectMove(value) {
    selectedMoveName = String(value);
    const emptyIndex = attackerMoveNames.findIndex((name) => name === "");
    if (emptyIndex >= 0) attackerMoveNames[emptyIndex] = selectedMoveName;
    updateMoveButtons();
    calculateAndRender();
  }

  /**
   * 技の検索欄をクリアして選択中の技を解除する。
   * @param {boolean} syncSearchInput 検索欄の表示も同期する場合はtrue。
   * @returns {void}
   */
  function clearMove(syncSearchInput = true) {
    selectedMoveName = "";
    updateMoveButtons(syncSearchInput);
    calculateAndRender();
  }

  moveSearchInput = createSearchableInput({
    id: "damage-move-select",
    placeholder: "技名を検索",
    items: moveItems,
    onSelect: selectMove,
    onClear: clearMove
  });
  moveMount.append(moveSearchInput.element);
  /**
   * 技の検索欄で候補外の文字列を入力した場合に選択中の技を解除する。
   * @returns {void}
   */
  function syncMoveSelection() {
    const isExactMove = moveSearchInput.getValue() !== null;
    if (!isExactMove && selectedMoveName) clearMove(false);
  }
  moveSearchInput.input.addEventListener("input", syncMoveSelection);
  moveSearchInput.input.addEventListener("compositionend", syncMoveSelection);

  refreshDamageSavedBuilds();

  const defaultPokemon = asArray(masterData.pokemon)[0];
  if (defaultPokemon) {
    const defaultBuild = {
      id: "direct-attacker",
      speciesId: defaultPokemon.id,
      name: "",
      level: LEVEL,
      nature: asArray(masterData.natures)[0]?.name || "",
      ability: asArray(defaultPokemon.abilities)[0] || "",
      item: "なし",
      megaForm: "",
      points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: []
    };
    sideStates.attacker.build = normalizeBuild(defaultBuild);
  }
  const secondPokemon = asArray(masterData.pokemon)[1] || defaultPokemon;
  if (secondPokemon) {
    const defaultBuild = {
      id: "direct-defender",
      speciesId: secondPokemon.id,
      name: "",
      level: LEVEL,
      nature: asArray(masterData.natures)[0]?.name || "",
      ability: asArray(secondPokemon.abilities)[0] || "",
      item: "なし",
      megaForm: "",
      points: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: []
    };
    sideStates.defender.build = normalizeBuild(defaultBuild);
  }

  fillSide("attacker", sideStates.attacker.build);
  fillSide("defender", sideStates.defender.build);

  const firstMove = asArray(masterData.moves)[0];
  selectedMoveName = firstMove?.name || "";
  attackerMoveNames = Array.from({ length: 4 }, (_, index) =>
    asArray(masterData.moves)[index]?.name || ""
  );
  updateMoveButtons();

  for (const side of ["attacker", "defender"]) {
    const savedSelect = root.querySelector(`#damage-${side}-saved`);
    const natureSelect = root.querySelector(`#damage-${side}-nature`);
    const abilitySelect = root.querySelector(`#damage-${side}-ability`);
    const itemSelect = root.querySelector(`#damage-${side}-item`);
    const megaSelect = root.querySelector(`#damage-${side}-mega`);
    const rankSelect = root.querySelector(`#damage-${side}-rank`);

    savedSelect?.addEventListener("change", () => {
      if (!(savedSelect instanceof HTMLSelectElement)) return;
      const build = savedBuildsById.get(savedSelect.value);
      if (build) setPokemonToSide(side, build);
    });
    natureSelect?.addEventListener("change", () => calculateAndRender());
    abilitySelect?.addEventListener("change", () => calculateAndRender());
    itemSelect?.addEventListener("change", () => {
      if (!(itemSelect instanceof HTMLSelectElement)) return;
      const pokemon = asArray(masterData.pokemon);
      const megaSelect = root.querySelector(`#damage-${side}-mega`);
      if (!(megaSelect instanceof HTMLSelectElement)) return;
      const species = pokemon.find((entry) => entry.id === sideStates[side].build.speciesId);
      const megaForms = asArray(species?.megaForms);
      if (itemSelect.value === "メガストーン" && megaForms.length > 0) {
        const firstForm = megaForms[0];
        megaSelect.value = firstForm.name;
        updateSideOptions(side, firstForm.ability || "", firstForm.name);
      } else if (itemSelect.value !== "メガストーン" && megaSelect.value) {
        megaSelect.value = "";
        updateSideOptions(side);
      }
      calculateAndRender();
    });
    megaSelect?.addEventListener("change", () => {
      if (!(megaSelect instanceof HTMLSelectElement) || !(itemSelect instanceof HTMLSelectElement)) return;
      if (megaSelect.value) {
        itemSelect.value = "メガストーン";
        const species = asArray(masterData.pokemon)
          .find((entry) => entry.id === sideStates[side].build.speciesId);
        const form = asArray(species?.megaForms).find((entry) => entry.name === megaSelect.value);
        updateSideOptions(side, form?.ability || "", megaSelect.value);
      } else {
        itemSelect.value = "なし";
        updateSideOptions(side);
      }
      calculateAndRender();
    });
    rankSelect?.addEventListener("change", () => {
      if (rankSelect instanceof HTMLSelectElement) {
        sideStates[side].rank = Math.min(6, Math.max(-6, Number(rankSelect.value) || 0));
      }
      calculateAndRender();
    });
    for (const { key } of STAT_ROWS) {
      const input = root.querySelector(`#damage-${side}-point-${key}`);
      input?.addEventListener("input", () => {
        if (!(input instanceof HTMLInputElement)) return;
        if (input.value !== "") {
          input.value = String(Math.min(MAX_POINT, Math.max(0, Number(input.value) || 0)));
        }
        calculateAndRender();
      });
    }
  }

  root.querySelectorAll("[data-damage-move]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!(button instanceof HTMLElement)) return;
      const index = Number(button.getAttribute("data-damage-move"));
      if (attackerMoveNames[index]) {
        selectedMoveName = attackerMoveNames[index];
      } else if (selectedMoveName) {
        attackerMoveNames[index] = selectedMoveName;
      }
      updateMoveButtons();
      calculateAndRender();
    });
  });
  root.querySelector(".damage-swap-button")?.addEventListener("click", swapSides);
  root.querySelector("#damage-critical")?.addEventListener("change", calculateAndRender);
  root.querySelector("#damage-burn")?.addEventListener("change", calculateAndRender);
  root.querySelector("#damage-double")?.addEventListener("change", calculateAndRender);
  root.querySelector("#damage-weather")?.addEventListener("change", calculateAndRender);

  calculateAndRender();
}
