import {
  calculateStats,
  resolveEffectiveSpecies
} from "../calculator.js";
import {
  deleteBuild,
  duplicateBuild,
  exportBuildsJson,
  getBuilds,
  importBuildsJson,
  saveBuild
} from "../storage.js";

/**
 * @typedef {"hp" | "atk" | "def" | "spa" | "spd" | "spe"} StatName 能力値の識別子。
 * @typedef {{ id?: string, name: string, types?: string[], abilities?: string[], baseStats?: Partial<Record<StatName, number>>, megaForms?: MegaForm[] }} Species 種族マスターデータ。
 * @typedef {{ name: string, types?: string[], ability?: string, baseStats?: Partial<Record<StatName, number>> }} MegaForm メガフォルムのマスターデータ。
 * @typedef {{ name: string, up?: StatName | null, down?: StatName | null }} Nature 性格マスターデータ。
 * @typedef {{ name: string, type?: string, category?: string, power?: number }} Move 技マスターデータ。
 * @typedef {{ name: string }} Item 持ち物マスターデータ。
 * @typedef {{ id: string, speciesId?: string, name?: string, memo?: string, level?: number, nature?: string, ability?: string, item?: string, megaForm?: string, points?: Partial<Record<StatName, number>>, moves?: string[], updatedAt?: string }} PokemonBuild 保存する育成個体データ。
 * @typedef {{ pokemon?: Species[], natures?: Nature[], items?: Item[], moves?: Move[] }} ManagerMasterData 管理画面で使用するマスターデータ。
 */

const LEVEL = 50;
const MAX_POINT = 32;
const TOTAL_POINTS = 66;
const STAT_ROWS = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "攻撃" },
  { key: "def", label: "防御" },
  { key: "spa", label: "特攻" },
  { key: "spd", label: "特防" },
  { key: "spe", label: "素早さ" }
];

/**
 * HTMLに挿入する文字列をエスケープする。
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
 * マスターデータが配列の場合にその値を返す。
 * @template T
 * @param {unknown} value 確認する値。
 * @returns {T[]} 配列、または空配列。
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * リスト領域に表示する個体カードを更新する。
 * @param {HTMLElement} list 個体一覧の要素。
 * @param {PokemonBuild[]} builds 保存済み個体一覧。
 * @param {Species[]} pokemon 種族マスターデータ。
 * @returns {void}
 */
function renderBuildList(list, builds, pokemon) {
  if (builds.length === 0) {
    list.innerHTML = '<p class="manager-empty">登録済みの個体はありません。</p>';
    return;
  }

  list.innerHTML = builds.map((build) => {
    const species = pokemon.find((entry) => entry.id === build.speciesId);
    const title = build.name?.trim() || species?.name || "名称未設定";
    const speciesName = species?.name || "不明なポケモン";
    const moves = asArray(build.moves).filter(Boolean);
    const details = [
      speciesName,
      build.nature || "性格未設定",
      build.item || "持ち物なし",
      build.megaForm || ""
    ].filter(Boolean).join(" ・ ");
    return `
      <article class="manager-build-card">
        <div class="manager-build-summary">
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(details)}</p>
          ${build.memo ? `<p class="manager-build-memo">${escapeHtml(build.memo)}</p>` : ""}
          ${moves.length ? `<p class="manager-build-moves">${moves.map(escapeHtml).join(" / ")}</p>` : ""}
        </div>
        <div class="manager-build-actions">
          <button class="button button-secondary" type="button" data-action="edit" data-id="${escapeHtml(build.id)}">編集</button>
          <button class="button button-secondary" type="button" data-action="duplicate" data-id="${escapeHtml(build.id)}">複製</button>
          <button class="button button-danger" type="button" data-action="delete" data-id="${escapeHtml(build.id)}">削除</button>
          <button class="button button-secondary" type="button" data-action="set-attacker" data-id="${escapeHtml(build.id)}">ダメ計の攻撃側へセット</button>
          <button class="button button-secondary" type="button" data-action="set-defender" data-id="${escapeHtml(build.id)}">ダメ計の防御側へセット</button>
        </div>
      </article>
    `;
  }).join("");

}

/**
 * 個体管理画面を初期化する。
 * @param {ManagerMasterData} masterData 種族・性格・持ち物・技のマスターデータ。
 * @param {() => void} onBuildsChanged 個体一覧が変更された際に呼び出す関数。
 * @returns {void}
 * @throws {Error} 個体管理画面の描画先がない場合。
 */
export function initManagerUi(masterData, onBuildsChanged) {
  const root = document.getElementById("manager-ui-root");
  if (!root) throw new Error("個体管理画面の描画先が見つかりません。");

  const pokemon = asArray(masterData?.pokemon)
    .filter((species) => typeof species?.id === "string" && typeof species?.name === "string");
  const natures = asArray(masterData?.natures)
    .filter((nature) => typeof nature?.name === "string");
  const items = asArray(masterData?.items)
    .filter((item) => typeof item?.name === "string");
  const moves = asArray(masterData?.moves)
    .filter((move) => typeof move?.name === "string");
  let editingId = "";
  let builds = [];

  root.innerHTML = `
    <div class="manager-layout">
      <section class="manager-list-section" aria-labelledby="manager-list-title">
        <div class="manager-section-heading">
          <div>
            <h3 id="manager-list-title">登録済み個体</h3>
            <p>個体を編集・複製し、ダメージ計算に呼び出せます。</p>
          </div>
          <div class="manager-backup-actions">
            <button class="button button-secondary" type="button" data-action="export">JSONを書き出す</button>
            <button class="button button-secondary" type="button" data-action="import">JSONを読み込む</button>
            <input class="manager-file-input" type="file" accept="application/json,.json" aria-label="インポートするJSONファイル">
          </div>
        </div>
        <div class="manager-build-list" aria-live="polite"></div>
      </section>
      <section class="manager-editor-section" aria-labelledby="manager-editor-title">
        <div class="manager-section-heading">
          <div>
            <h3 id="manager-editor-title">個体編集</h3>
            <p class="manager-editor-mode">新規個体を作成します。</p>
          </div>
          <button class="button button-secondary" type="button" data-action="new">新規作成</button>
        </div>
        <form class="manager-form">
          <div class="manager-form-grid">
            <label class="form-field" for="manager-species">
              <span>ポケモン</span>
              <select id="manager-species" name="speciesId" required></select>
            </label>
            <label class="form-field" for="manager-name">
              <span>ニックネーム</span>
              <input id="manager-name" name="name" type="text" maxlength="40" autocomplete="off">
            </label>
            <label class="form-field" for="manager-nature">
              <span>性格</span>
              <select id="manager-nature" name="nature"></select>
            </label>
            <label class="form-field" for="manager-ability">
              <span>特性</span>
              <select id="manager-ability" name="ability"></select>
            </label>
            <label class="form-field" for="manager-item">
              <span>持ち物</span>
              <select id="manager-item" name="item"></select>
            </label>
            <label class="form-field manager-mega-field" for="manager-mega">
              <span>メガシンカ</span>
              <select id="manager-mega" name="megaForm"></select>
            </label>
          </div>
          <label class="form-field manager-memo-field" for="manager-memo">
            <span>メモ</span>
            <textarea id="manager-memo" name="memo" rows="2" maxlength="300"></textarea>
          </label>
          <section class="manager-stats-section" aria-labelledby="manager-stats-title">
            <div class="manager-subheading">
              <h4 id="manager-stats-title">ステータス配分</h4>
              <p class="manager-point-summary" aria-live="polite"></p>
            </div>
            <div class="manager-stats-scroll">
              <table class="manager-stats-table">
                <thead>
                  <tr><th scope="col">能力</th><th scope="col">種族値</th><th scope="col">能力ポイント</th><th scope="col">実数値</th></tr>
                </thead>
                <tbody class="manager-stat-rows"></tbody>
              </table>
            </div>
          </section>
          <section class="manager-moves-section" aria-labelledby="manager-moves-title">
            <div class="manager-subheading">
              <h4 id="manager-moves-title">技構成（最大4つ）</h4>
            </div>
            <div class="manager-move-fields"></div>
          </section>
          <p class="manager-message form-message" role="status" aria-live="polite"></p>
          <div class="manager-form-actions">
            <button class="button button-secondary" type="button" data-action="reset">フォームリセット</button>
            <button class="button button-primary manager-save-button" type="submit">保存（新規追加）</button>
          </div>
        </form>
      </section>
    </div>
  `;

  const list = root.querySelector(".manager-build-list");
  const form = root.querySelector(".manager-form");
  const speciesSelect = root.querySelector("#manager-species");
  const natureSelect = root.querySelector("#manager-nature");
  const abilitySelect = root.querySelector("#manager-ability");
  const itemSelect = root.querySelector("#manager-item");
  const megaSelect = root.querySelector("#manager-mega");
  const megaField = root.querySelector(".manager-mega-field");
  const statRows = root.querySelector(".manager-stat-rows");
  const pointSummary = root.querySelector(".manager-point-summary");
  const moveFields = root.querySelector(".manager-move-fields");
  const fileInput = root.querySelector(".manager-file-input");
  const message = root.querySelector(".manager-message");
  const modeLabel = root.querySelector(".manager-editor-mode");
  const saveButton = root.querySelector(".manager-save-button");

  /**
   * 画面に操作結果を表示する。
   * @param {string} text 表示するメッセージ。
   * @param {boolean} isError エラー表示の場合はtrue。
   * @returns {void}
   */
  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  }

  /**
   * 個体変更後に一覧と外部コールバックを更新する。
   * @returns {void}
   */
  function notifyBuildsChanged() {
    try {
      builds = getBuilds();
      renderBuildList(list, builds, pokemon);
    } catch (error) {
      setMessage(`個体データは更新されましたが、一覧を再読み込みできませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
      return;
    }
    if (typeof onBuildsChanged === "function") {
      try {
        onBuildsChanged();
      } catch (error) {
        setMessage(`個体データは更新されましたが、変更通知に失敗しました: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
      }
    }
  }

  /**
   * 選択肢をHTML文字列に変換する。
   * @param {{ value: string, label: string }[]} options 選択肢。
   * @param {string} selected 選択する値。
   * @param {string} emptyLabel 空選択肢の表示名。
   * @returns {string} option要素のHTML。
   */
  function createOptions(options, selected = "", emptyLabel = "選択してください") {
    const emptyOption = `<option value="">${escapeHtml(emptyLabel)}</option>`;
    return emptyOption + options.map((option) => (
      `<option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )).join("");
  }

  /**
   * 種族に応じて特性とメガシンカの選択肢を更新する。
   * @param {string} selectedAbility 選択する特性。
   * @param {string} selectedMega 選択するメガフォルム。
   * @returns {void}
   */
  function updateSpeciesOptions(selectedAbility = "", selectedMega = "") {
    const species = pokemon.find((entry) => entry.id === speciesSelect.value);
    const megaForms = asArray(species?.megaForms)
      .filter((form) => typeof form?.name === "string");
    const abilities = asArray(species?.abilities).filter((ability) => typeof ability === "string");
    const selectedForm = megaForms.find((form) => form.name === selectedMega);
    const abilityOptions = abilities.map((ability) => ({ value: ability, label: ability }));
    if (typeof selectedForm?.ability === "string"
      && !abilityOptions.some((option) => option.value === selectedForm.ability)) {
      abilityOptions.unshift({ value: selectedForm.ability, label: `${selectedForm.ability}（${selectedForm.name}）` });
    }
    abilitySelect.innerHTML = createOptions(abilityOptions, selectedAbility || selectedForm?.ability || abilities[0] || "");

    megaField.hidden = megaForms.length === 0;
    megaSelect.innerHTML = [
      '<option value="">通常</option>',
      ...megaForms.map((form) => `<option value="${escapeHtml(form.name)}"${form.name === selectedMega ? " selected" : ""}>${escapeHtml(form.name)}</option>`)
    ].join("");
    if (megaForms.length === 0) {
      megaSelect.value = "";
      if (itemSelect.value === "メガストーン") itemSelect.value = "なし";
    }
  }

  /**
   * 種族値と能力ポイント入力行を描画する。
   * @param {Partial<Record<StatName, number>>} points 初期能力ポイント。
   * @returns {void}
   */
  function renderStatRows(points = {}) {
    statRows.innerHTML = STAT_ROWS.map(({ key, label }) => `
      <tr data-stat-row="${key}">
        <th scope="row">${label}</th>
        <td class="manager-base-stat" data-base-stat="${key}">—</td>
        <td><input class="manager-point-input" type="number" name="point-${key}" min="0" max="${MAX_POINT}" step="1" value="${escapeHtml(points[key] ?? 0)}" inputmode="numeric" aria-label="${label}能力ポイント"></td>
        <td class="manager-final-stat" data-final-stat="${key}" aria-live="polite">—</td>
      </tr>
    `).join("");
  }

  /**
   * 技データから4枠分の選択欄を描画する。
   * @param {string[]} selectedMoves 保存済みの技。
   * @returns {void}
   */
  function renderMoveFields(selectedMoves = []) {
    const options = moves.filter((move) => typeof move?.name === "string").map((move) => {
      const power = Number(move.power) > 0 ? move.power : "—";
      const category = move.category === "physical" ? "物理"
        : move.category === "special" ? "特殊"
          : move.category === "status" ? "変化" : move.category || "分類不明";
      return {
        value: move.name,
        label: `${move.name}（${move.type || "タイプ不明"}・${category}・威力${power}）`
      };
    });
    moveFields.innerHTML = Array.from({ length: 4 }, (_, index) => `
      <label class="form-field" for="manager-move-${index + 1}">
        <span>技${index + 1}</span>
        <select id="manager-move-${index + 1}" name="move-${index + 1}">${createOptions(options, selectedMoves[index] || "", "未選択")}</select>
      </label>
    `).join("");
  }

  /**
   * 性格・メガフォルムに応じた実数値とポイント合計を更新する。
   * @returns {void}
   */
  function updateStats() {
    const species = pokemon.find((entry) => entry.id === speciesSelect.value);
    const points = {};
    for (const { key } of STAT_ROWS) {
      const input = form.elements.namedItem(`point-${key}`);
      points[key] = input instanceof HTMLInputElement ? Number(input.value) || 0 : 0;
    }

    const total = Object.values(points).reduce((sum, point) => sum + point, 0);
    const remaining = TOTAL_POINTS - total;
    pointSummary.textContent = `合計 ${total} / ${TOTAL_POINTS} ・ 残り ${remaining}`;
    pointSummary.classList.toggle("is-over-limit", total > TOTAL_POINTS);

    const nature = natures.find((entry) => entry.name === natureSelect.value);
    for (const { key } of STAT_ROWS) {
      const row = statRows.querySelector(`[data-stat-row="${key}"]`);
      row.classList.toggle("is-nature-up", nature?.up === key);
      row.classList.toggle("is-nature-down", nature?.down === key);
    }
    if (!species) {
      statRows.querySelectorAll("[data-base-stat], [data-final-stat]").forEach((cell) => {
        cell.textContent = "—";
      });
      return;
    }

    const build = {
      nature: natureSelect.value,
      ability: abilitySelect.value,
      item: itemSelect.value,
      megaForm: megaSelect.value,
      points
    };
    const effectiveSpecies = resolveEffectiveSpecies(species, build);
    const stats = calculateStats(effectiveSpecies, build, natures);
    for (const { key } of STAT_ROWS) {
      const baseCell = statRows.querySelector(`[data-base-stat="${key}"]`);
      const finalCell = statRows.querySelector(`[data-final-stat="${key}"]`);
      baseCell.textContent = String(effectiveSpecies.baseStats?.[key] ?? "—");
      finalCell.textContent = String(stats[key]);
    }
  }

  /**
   * 個体一覧をストレージから読み直して描画する。
   * @returns {void}
   */
  function refreshBuildList() {
    try {
      builds = getBuilds();
      renderBuildList(list, builds, pokemon);
    } catch (error) {
      renderBuildList(list, [], pokemon);
      setMessage(`個体一覧を読み込めませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
    }
  }

  /**
   * フォームを指定個体の内容で埋める。
   * @param {PokemonBuild | null} build 編集する個体。新規作成時はnull。
   * @returns {void}
   */
  function fillForm(build = null) {
    editingId = build?.id || "";
    form.reset();
    speciesSelect.value = build?.speciesId || "";
    root.querySelector("#manager-name").value = build?.name || "";
    root.querySelector("#manager-memo").value = build?.memo || "";
    natureSelect.value = build?.nature || natures[0]?.name || "";
    itemSelect.value = build?.item || "なし";
    updateSpeciesOptions(build?.ability || "", build?.megaForm || "");
    if (build?.megaForm && itemSelect.value !== "メガストーン") itemSelect.value = "メガストーン";
    renderStatRows(build?.points || {});
    renderMoveFields(asArray(build?.moves));
    modeLabel.textContent = editingId ? "保存済み個体を編集中です。" : "新規個体を作成します。";
    saveButton.textContent = editingId ? "保存（上書き）" : "保存（新規追加）";
    setMessage("");
    updateStats();
  }

  /**
   * フォームの入力値から保存用個体データを作成する。
   * @returns {PokemonBuild} フォーム内容を反映した個体データ。
   */
  function readFormBuild() {
    const points = {};
    for (const { key } of STAT_ROWS) {
      const input = form.elements.namedItem(`point-${key}`);
      const value = input instanceof HTMLInputElement ? Number(input.value) : 0;
      points[key] = Number.isFinite(value) ? Math.min(MAX_POINT, Math.max(0, Math.trunc(value))) : 0;
    }
    const selectedMoves = Array.from({ length: 4 }, (_, index) => {
      const input = form.elements.namedItem(`move-${index + 1}`);
      return input instanceof HTMLSelectElement ? input.value : "";
    }).filter(Boolean);

    return {
      id: editingId || "",
      speciesId: speciesSelect.value,
      name: root.querySelector("#manager-name").value.trim(),
      memo: root.querySelector("#manager-memo").value.trim(),
      level: LEVEL,
      nature: natureSelect.value,
      ability: abilitySelect.value,
      item: itemSelect.value || "なし",
      megaForm: megaSelect.value || "",
      points,
      moves: selectedMoves
    };
  }

  /**
   * 個体を保存する。
   * @param {SubmitEvent} event フォーム送信イベント。
   * @returns {void}
   */
  function handleSave(event) {
    event.preventDefault();
    const build = readFormBuild();
    const total = Object.values(build.points || {}).reduce((sum, point) => sum + point, 0);
    if (!build.speciesId) {
      setMessage("ポケモンを選択してください。", true);
      speciesSelect.focus();
      return;
    }
    if (total > TOTAL_POINTS) {
      setMessage(`能力ポイントの合計が${TOTAL_POINTS}を超えています。配分を調整してください。`, true);
      return;
    }
    if (typeof globalThis.crypto?.randomUUID !== "function" && !build.id) {
      setMessage("新規個体を保存するためのIDを生成できません。安全な接続で開いてください。", true);
      return;
    }

    try {
      if (!build.id) build.id = globalThis.crypto.randomUUID();
      saveBuild(build);
      editingId = build.id;
      modeLabel.textContent = "保存済み個体を編集中です。";
      saveButton.textContent = "保存（上書き）";
      setMessage("個体を保存しました。");
      notifyBuildsChanged();
    } catch (error) {
      setMessage(`個体を保存できませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
    }
  }

  /**
   * JSONバックアップファイルをダウンロードする。
   * @returns {void}
   */
  function exportFile() {
    try {
      const blob = new Blob([exportBuildsJson()], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pokemon-builds-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("JSONバックアップを書き出しました。");
    } catch (error) {
      setMessage(`JSONバックアップを書き出せませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
    }
  }

  /**
   * 選択されたJSONファイルを読み込んで個体データに統合する。
   * @param {Event} event ファイル選択イベント。
   * @returns {Promise<void>} 読み込み処理。
   */
  async function importFile(event) {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
    try {
      const importedBuilds = importBuildsJson(await input.files[0].text());
      setMessage(`${importedBuilds.length}件の個体を読み込みました。`);
      notifyBuildsChanged();
    } catch (error) {
      setMessage(`JSONを読み込めませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
    } finally {
      input.value = "";
    }
  }

  /**
   * 一覧ボタンの操作を処理する。
   * @param {MouseEvent} event クリックイベント。
   * @returns {void}
   */
  function handleListAction(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-action]");
    if (!button) return;
    const action = button.getAttribute("data-action");
    const id = button.getAttribute("data-id") || "";
    const build = builds.find((entry) => entry.id === id);

    if (action === "edit" && build) {
      fillForm(build);
      root.querySelector("#manager-editor-title").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "duplicate" && build) {
      try {
        const duplicate = duplicateBuild(id);
        editingId = duplicate.id;
        fillForm(duplicate);
        setMessage("個体を複製しました。");
        notifyBuildsChanged();
      } catch (error) {
        setMessage(`個体を複製できませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
      }
    } else if (action === "set-attacker" && build) {
      document.dispatchEvent(new CustomEvent("pokemon-build-selected", { detail: { build, side: "attacker" } }));
      setMessage("選択した個体をダメージ計算の攻撃側にセットするイベントを送信しました。");
    } else if (action === "set-defender" && build) {
      document.dispatchEvent(new CustomEvent("pokemon-build-selected", { detail: { build, side: "defender" } }));
      setMessage("選択した個体をダメージ計算の防御側にセットするイベントを送信しました。");
    } else if (action === "export") {
      exportFile();
    } else if (action === "import") {
      fileInput.click();
    } else if (action === "new") {
      fillForm();
    } else if (action === "reset") {
      fillForm(editingId ? builds.find((entry) => entry.id === editingId) || null : null);
    }
  }

  /**
   * 入力変更に応じてメガシンカ連動と実数値表示を更新する。
   * @param {Event} event 入力変更イベント。
   * @returns {void}
   */
  function handleFormChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;

    if (target === speciesSelect) {
      updateSpeciesOptions();
      if (itemSelect.value === "メガストーン") itemSelect.value = "なし";
    } else if (target === itemSelect) {
      if (itemSelect.value === "メガストーン") {
        const species = pokemon.find((entry) => entry.id === speciesSelect.value);
        const firstForm = asArray(species?.megaForms)
          .find((form) => typeof form?.name === "string");
        if (firstForm) {
          megaSelect.value = firstForm.name;
          updateSpeciesOptions(firstForm.ability || "", firstForm.name);
        }
      } else if (megaSelect.value) {
        megaSelect.value = "";
        updateSpeciesOptions();
      }
    } else if (target === megaSelect) {
      if (megaSelect.value) {
        itemSelect.value = "メガストーン";
        const species = pokemon.find((entry) => entry.id === speciesSelect.value);
        const form = asArray(species?.megaForms)
          .find((entry) => typeof entry?.name === "string" && entry.name === megaSelect.value);
        updateSpeciesOptions(form?.ability || "", megaSelect.value);
      } else {
        itemSelect.value = "なし";
        updateSpeciesOptions();
      }
    }
    updateStats();
  }

  /**
   * 個体削除要求を処理する。
   * @param {Event} event 削除アクションイベント。
   * @returns {void}
   */
  function handleDelete(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-action='delete']");
    if (!button) return;
    const id = button.getAttribute("data-id");
    const build = builds.find((entry) => entry.id === id);
    if (!id || !build || !globalThis.confirm(`「${build.name || "名称未設定"}」を削除しますか？`)) return;

    try {
      deleteBuild(id);
      if (editingId === id) fillForm();
      setMessage("個体を削除しました。");
      notifyBuildsChanged();
    } catch (error) {
      setMessage(`個体を削除できませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`, true);
    }
  }

  const speciesOptions = pokemon.map((species) => ({ value: species.id, label: species.name }));
  speciesSelect.innerHTML = createOptions(speciesOptions, "", "ポケモンを選択");
  natureSelect.innerHTML = createOptions(
    natures.map((nature) => ({ value: nature.name, label: nature.name })),
    "",
    "性格を選択"
  );
  itemSelect.innerHTML = createOptions([
    { value: "なし", label: "なし" },
    ...items.filter((item) => item.name !== "なし")
      .map((item) => ({ value: item.name, label: item.name }))
  ], "なし", "持ち物を選択");

  renderStatRows();
  renderMoveFields();
  refreshBuildList();
  updateSpeciesOptions();
  updateStats();
  form.addEventListener("submit", handleSave);
  form.addEventListener("change", handleFormChange);
  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.classList.contains("manager-point-input")) {
      if (event.target.value !== "") {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) {
          event.target.value = String(Math.min(MAX_POINT, Math.max(0, Math.trunc(value))));
        }
      }
      updateStats();
    }
  });
  list.addEventListener("click", handleDelete);
  root.addEventListener("click", handleListAction);
  fileInput.addEventListener("change", importFile);
}
