import { calculateStats, resolveEffectiveSpecies } from "../calculator.js";
import { requestBuildAdjustment } from "../geminiApi.js";
import { getBuilds, saveBuild } from "../storage.js";
import { createSearchableInput } from "./searchableSelect.js";

/**
 * @typedef {"hp" | "atk" | "def" | "spa" | "spd" | "spe"} StatName 能力値の識別子。
 * @typedef {{ id: string, name: string, abilities?: string[], baseStats?: Partial<Record<StatName, number>>, megaForms?: Array<{ name: string, ability?: string, baseStats?: Partial<Record<StatName, number>> }> }} Species 種族マスターデータ。
 * @typedef {{ id: string, speciesId?: string, name?: string, memo?: string, level?: number, nature?: string, ability?: string, item?: string, megaForm?: string, points?: Partial<Record<StatName, number>>, moves?: string[] }} PokemonBuild 育成個体データ。
 * @typedef {{ nature?: string, item?: string, ability?: string, megaForm?: string | null, points?: Partial<Record<StatName, number>>, moves?: string[], benchmarks?: Array<{ target?: string, category?: string, summary?: string }>, explanation?: string, isPointsOverLimit?: boolean }} AdjustmentProposal Geminiから受け取った調整案。
 * @typedef {{ pokemon?: Species[], natures?: Array<{ name: string, up?: StatName | null, down?: StatName | null }>, items?: Array<{ name: string }>, moves?: Array<{ name: string }> }} AdvisorMasterData 調整提案画面で使用するマスターデータ。
 * @typedef {{ onBuildsChanged?: () => void, onSendToDamage?: (side: "attacker" | "defender", build: PokemonBuild) => void }} AdvisorCallbacks 調整案の反映時に呼び出す関数。
 */

const LEVEL = 50;
const MAX_POINT_PER_STAT = 32;
const MAX_TOTAL_POINTS = 66;
const STAT_ROWS = [
  { key: "hp", label: "HP" },
  { key: "atk", label: "攻撃" },
  { key: "def", label: "防御" },
  { key: "spa", label: "特攻" },
  { key: "spd", label: "特防" },
  { key: "spe", label: "素早さ" }
];
const QUICK_TEMPLATES = [
  { label: "汎用アタッカー配分", request: "種族値と技構成に合わせた汎用アタッカー配分を提案してください。" },
  { label: "物理耐久重視", request: "物理攻撃を受けるための耐久を重視した配分を提案してください。" },
  { label: "特殊耐久重視", request: "特殊攻撃を受けるための耐久を重視した配分を提案してください。" },
  { label: "最速ベース", request: "素早さを重視し、可能な限り速く動ける配分を提案してください。" }
];
const CATEGORY_LABELS = {
  offense: "攻撃",
  defense: "防御",
  speed: "素早さ"
};

/**
 * 値が配列ではないオブジェクトか判定する。
 * @param {unknown} value 判定対象の値。
 * @returns {boolean} オブジェクトの場合はtrue。
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
 * 能力ポイントを0〜32の整数に補正する。
 * @param {unknown} value 補正する値。
 * @returns {number} 範囲内の整数。
 */
function normalizePoint(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(MAX_POINT_PER_STAT, Math.max(0, Math.trunc(numericValue)));
}

/**
 * 選択中のポケモンと基準個体から、提案依頼に使用する個体を作成する。
 * @param {Species} species 対象ポケモン。
 * @param {PokemonBuild} [baseBuild] 基準にする保存済み個体。
 * @param {AdvisorMasterData} masterData マスターデータ。
 * @returns {PokemonBuild} 補完済みの基準個体。
 */
function createBaseBuild(species, baseBuild, masterData) {
  const firstNature = asArray(masterData.natures)[0]?.name ?? "";
  const points = {};
  for (const { key } of STAT_ROWS) {
    points[key] = normalizePoint(baseBuild?.points?.[key]);
  }

  return {
    ...(baseBuild ?? {}),
    id: baseBuild?.id ?? "",
    speciesId: species.id,
    name: baseBuild?.name || species.name,
    memo: baseBuild?.memo ?? "",
    level: LEVEL,
    nature: baseBuild?.nature ?? firstNature,
    ability: baseBuild?.ability ?? species.abilities?.[0] ?? "",
    item: baseBuild?.item ?? "なし",
    megaForm: baseBuild?.megaForm ?? "",
    points,
    moves: asArray(baseBuild?.moves).filter((move) => typeof move === "string")
  };
}

/**
 * Geminiの回答を表示・反映に使う形へ正規化する。
 * @param {unknown} value Geminiからの調整案。
 * @param {Species} species 対象ポケモン。
 * @param {PokemonBuild} baseBuild 現在の基準個体。
 * @returns {AdjustmentProposal} 表示に使用する調整案。
 */
function normalizeProposal(value, species, baseBuild) {
  const proposal = isRecord(value) ? value : {};
  const rawPoints = isRecord(proposal.points) ? proposal.points : {};
  const requestedMegaForm = typeof proposal.megaForm === "string" && proposal.megaForm.trim() !== ""
    ? proposal.megaForm
    : null;
  const megaForm = requestedMegaForm
    && asArray(species.megaForms).some((form) => form.name === requestedMegaForm)
    ? requestedMegaForm
    : null;
  const moves = Array.isArray(proposal.moves)
    ? proposal.moves.filter((move) => typeof move === "string").slice(0, 4)
    : [...(baseBuild.moves ?? [])].slice(0, 4);
  const benchmarks = Array.isArray(proposal.benchmarks)
    ? proposal.benchmarks.filter((benchmark) => isRecord(benchmark))
    : [];
  const points = {};
  for (const { key } of STAT_ROWS) {
    points[key] = normalizePoint(rawPoints[key]);
  }

  return {
    nature: typeof proposal.nature === "string" ? proposal.nature : baseBuild.nature,
    item: typeof proposal.item === "string" ? proposal.item : baseBuild.item,
    ability: typeof proposal.ability === "string"
      ? proposal.ability
      : species.abilities?.[0] ?? baseBuild.ability,
    megaForm,
    points,
    moves,
    benchmarks,
    explanation: typeof proposal.explanation === "string" ? proposal.explanation : "",
    isPointsOverLimit: proposal.isPointsOverLimit === true
  };
}

/**
 * 個体保存およびダメージ計算への反映に使うデータを作成する。
 * @param {Species} species 対象ポケモン。
 * @param {AdjustmentProposal} proposal 正規化済みの調整案。
 * @returns {PokemonBuild} 保存・反映用の個体データ。
 * @throws {Error} 新しい個体IDを生成できない場合。
 */
function createProposalBuild(species, proposal) {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("個体保存に必要なIDを生成できません。");
  }

  return {
    id: globalThis.crypto.randomUUID(),
    speciesId: species.id,
    name: species.name,
    memo: proposal.explanation,
    level: LEVEL,
    nature: proposal.nature ?? "",
    ability: proposal.ability ?? "",
    item: proposal.item ?? "なし",
    megaForm: proposal.megaForm ?? "",
    points: { ...proposal.points },
    moves: [...(proposal.moves ?? [])]
  };
}

/**
 * AI調整提案画面を初期化する。
 * @param {AdvisorMasterData} masterData 種族・性格・持ち物・技のマスターデータ。
 * @param {AdvisorCallbacks} [callbacks] 保存やダメージ計算への反映時に呼び出す関数。
 * @returns {void}
 * @throws {Error} 提案画面の描画先がない場合。
 */
export function initAdvisorUi(masterData, callbacks = {}) {
  const root = document.getElementById("advisor-ui-root");
  if (!root) throw new Error("AI調整提案画面の描画先が見つかりません。");

  const data = isRecord(masterData) ? masterData : {};
  const pokemon = asArray(data.pokemon)
    .filter((species) => typeof species?.id === "string" && typeof species?.name === "string")
    .map((species) => ({
      ...species,
      abilities: asArray(species.abilities).filter((ability) => typeof ability === "string"),
      megaForms: asArray(species.megaForms).filter((form) => typeof form?.name === "string")
    }));
  const natures = asArray(data.natures)
    .filter((nature) => typeof nature?.name === "string");
  const actions = isRecord(callbacks) ? callbacks : {};
  let savedBuilds = [];
  let currentBuild = null;
  let currentSpecies = null;
  let currentProposal = null;
  let currentProposalBuild = null;
  let isRequesting = false;
  let hasSavedProposal = false;

  root.innerHTML = `
    <div class="advisor-layout">
      <form class="advisor-form">
        <div class="advisor-form-grid">
          <label class="form-field" for="advisor-species">
            <span>対象ポケモン</span>
            <div id="advisor-species-input"></div>
          </label>
          <label class="form-field" for="advisor-saved-build">
            <span>保存済み個体から読み込む</span>
            <select id="advisor-saved-build" name="savedBuildId">
              <option value="">保存済み個体を選択</option>
            </select>
          </label>
        </div>
        <div class="advisor-quick-requests" aria-label="要望テンプレート">
          ${QUICK_TEMPLATES.map((template) => `
            <button class="advisor-quick-chip" type="button" data-advisor-template="${escapeHtml(template.request)}">
              ${escapeHtml(template.label)}
            </button>
          `).join("")}
        </div>
        <label class="form-field" for="advisor-request">
          <span>調整要望</span>
          <textarea
            id="advisor-request"
            name="userRequest"
            rows="4"
            maxlength="1000"
            placeholder="例：陽気ガブリアスのじしんを確定耐えしつつ、最速100族抜き調整"
            required
          ></textarea>
        </label>
        <p class="advisor-message form-message" role="status" aria-live="polite"></p>
        <button class="button button-primary advisor-submit" type="submit" disabled>
          <span class="advisor-spinner" aria-hidden="true" hidden></span>
          <span class="advisor-submit-label">AIに調整を提案してもらう</span>
        </button>
      </form>
      <section class="advisor-result" aria-live="polite" aria-label="調整提案結果"></section>
    </div>
  `;

  const form = root.querySelector(".advisor-form");
  const speciesInputMount = root.querySelector("#advisor-species-input");
  const savedBuildSelect = root.querySelector("#advisor-saved-build");
  const requestInput = root.querySelector("#advisor-request");
  const submitButton = root.querySelector(".advisor-submit");
  const submitLabel = root.querySelector(".advisor-submit-label");
  const spinner = root.querySelector(".advisor-spinner");
  const message = root.querySelector(".advisor-message");
  const resultElement = root.querySelector(".advisor-result");

  if (!(form instanceof HTMLFormElement)
    || !(speciesInputMount instanceof HTMLElement)
    || !(savedBuildSelect instanceof HTMLSelectElement)
    || !(requestInput instanceof HTMLTextAreaElement)
    || !(submitButton instanceof HTMLButtonElement)
    || !(submitLabel instanceof HTMLElement)
    || !(spinner instanceof HTMLElement)
    || !(message instanceof HTMLElement)
    || !(resultElement instanceof HTMLElement)) {
    throw new Error("AI調整提案画面のフォームを準備できません。");
  }

  /**
   * 画面にメッセージを表示する。
   * @param {string} text 表示する文章。
   * @param {boolean} [isError] エラー表示の場合はtrue。
   * @returns {void}
   */
  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
  }

  /**
   * 送信ボタンの使用可否を現在の入力状態に合わせる。
   * @returns {void}
   */
  function updateSubmitState() {
    submitButton.disabled = isRequesting
      || !currentSpecies
      || requestInput.value.trim() === "";
  }

  /**
   * 保存済み個体の選択肢をストレージから読み直す。
   * @returns {void}
   */
  function renderSavedBuildOptions() {
    const previousValue = savedBuildSelect.value;
    try {
      savedBuilds = getBuilds();
      savedBuildSelect.innerHTML = [
        '<option value="">保存済み個体を選択</option>',
        ...savedBuilds.map((build) => {
          const species = pokemon.find((entry) => entry.id === build.speciesId);
          const label = build.name?.trim() || species?.name || "名称未設定";
          return `<option value="${escapeHtml(build.id)}">${escapeHtml(label)}</option>`;
        })
      ].join("");
      if (savedBuilds.some((build) => build.id === previousValue)) {
        savedBuildSelect.value = previousValue;
      }
    } catch (error) {
      savedBuilds = [];
      savedBuildSelect.innerHTML = '<option value="">保存済み個体を読み込めません</option>';
      setMessage(
        `保存済み個体を読み込めませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`,
        true
      );
    }
  }

  /**
   * 調整案をステータス計算結果、調整ライン、解説とともに描画する。
   * @param {Species} species 対象ポケモン。
   * @param {AdjustmentProposal} proposal 正規化済みの調整案。
   * @param {PokemonBuild} proposalBuild 計算に使う調整個体。
   * @returns {void}
   */
  function renderProposal(species, proposal, proposalBuild) {
    const effectiveSpecies = resolveEffectiveSpecies(species, proposalBuild);
    const stats = calculateStats(effectiveSpecies, proposalBuild, natures);
    const totalPoints = STAT_ROWS.reduce(
      (total, { key }) => total + normalizePoint(proposal.points?.[key]),
      0
    );
    const isOverLimit = proposal.isPointsOverLimit || totalPoints > MAX_TOTAL_POINTS;
    const benchmarks = proposal.benchmarks ?? [];
    const benchmarkHtml = benchmarks.length > 0
      ? benchmarks.map((benchmark) => {
        const category = typeof benchmark.category === "string"
          ? CATEGORY_LABELS[benchmark.category] ?? "調整ライン"
          : "調整ライン";
        return `
          <article class="advisor-benchmark">
            <div class="advisor-benchmark-heading">
              <span class="advisor-category">${escapeHtml(category)}</span>
              <strong>${escapeHtml(benchmark.target || "対象未設定")}</strong>
            </div>
            <p>${escapeHtml(benchmark.summary || "結果未設定")}</p>
          </article>
        `;
      }).join("")
      : '<p class="advisor-empty">調整ラインはありません。</p>';
    const formDetails = [
      proposal.nature,
      proposal.item,
      proposal.ability,
      proposal.megaForm
    ].filter((entry) => typeof entry === "string" && entry !== "").map(escapeHtml).join(" ・ ");

    resultElement.innerHTML = `
      <article class="advisor-result-card">
        <div class="advisor-result-heading">
          <div>
            <h3>${escapeHtml(species.name)}の調整案</h3>
            <p>${formDetails}</p>
          </div>
          <div class="advisor-result-badges">
            <span class="advisor-point-badge${isOverLimit ? " is-over-limit" : ""}">
              合計 ${totalPoints} / ${MAX_TOTAL_POINTS} pt
            </span>
            ${isOverLimit ? '<span class="advisor-warning-badge">合計上限超過</span>' : ""}
          </div>
        </div>
        <div class="advisor-stats-scroll">
          <table class="advisor-stats-table">
            <thead>
              <tr><th scope="col">能力</th><th scope="col">能力ポイント</th><th scope="col">実数値</th></tr>
            </thead>
            <tbody>
              ${STAT_ROWS.map(({ key, label }) => `
                <tr>
                  <th scope="row">${label}</th>
                  <td>${normalizePoint(proposal.points?.[key])}</td>
                  <td><span class="advisor-stat-badge">${stats[key]}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
        <section class="advisor-benchmarks" aria-labelledby="advisor-benchmarks-title">
          <h4 id="advisor-benchmarks-title">調整ライン</h4>
          <div class="advisor-benchmark-list">${benchmarkHtml}</div>
        </section>
        <section class="advisor-explanation">
          <h4>調整意図</h4>
          <p>${escapeHtml(proposal.explanation || "解説はありません。")}</p>
        </section>
        ${proposal.moves?.length
          ? `<p class="advisor-moves"><strong>技構成:</strong> ${proposal.moves.map(escapeHtml).join(" / ")}</p>`
          : ""}
        <div class="advisor-actions">
          <button class="button button-primary" type="button" data-advisor-action="save"${hasSavedProposal ? " disabled" : ""}>
            ${hasSavedProposal ? "個体管理に保存済み" : "個体管理に新規保存"}
          </button>
          <button class="button button-secondary" type="button" data-advisor-action="attacker">ダメ計の攻撃側へ送る</button>
          <button class="button button-secondary" type="button" data-advisor-action="defender">ダメ計の防御側へ送る</button>
        </div>
      </article>
    `;
  }

  /**
   * 対象ポケモンを選び直し、提案結果と基準個体を更新する。
   * @param {Species | undefined} species 選択した対象ポケモン。
   * @returns {void}
   */
  function selectSpecies(species) {
    currentSpecies = species ?? null;
    currentBuild = species ? createBaseBuild(species, undefined, data) : null;
    currentProposal = null;
    currentProposalBuild = null;
    hasSavedProposal = false;
    resultElement.replaceChildren();
    updateSubmitState();
  }

  const speciesSearch = createSearchableInput({
    id: "advisor-species",
    placeholder: "ポケモン名を検索",
    items: pokemon.map((species) => ({ value: species.id, label: species.name })),
    onSelect: (value) => selectSpecies(pokemon.find((species) => species.id === String(value))),
    onClear: () => {
      savedBuildSelect.value = "";
      selectSpecies(undefined);
    }
  });
  speciesSearch.input.name = "speciesId";
  speciesSearch.input.required = true;
  speciesInputMount.append(speciesSearch.element);
  renderSavedBuildOptions();
  selectSpecies(undefined);

  /**
   * 対象ポケモンの確定済み候補を提案画面へ反映する。
   * @returns {void}
   */
  function syncSpeciesSelection() {
    const speciesId = String(speciesSearch.getValue() ?? "");
    const species = pokemon.find((entry) => entry.id === speciesId);
    if (species?.id !== currentSpecies?.id) selectSpecies(species);
    savedBuildSelect.value = "";
    setMessage("");
  }
  speciesSearch.input.addEventListener("input", syncSpeciesSelection);
  speciesSearch.input.addEventListener("compositionend", syncSpeciesSelection);

  savedBuildSelect.addEventListener("change", () => {
    const build = savedBuilds.find((entry) => entry.id === savedBuildSelect.value);
    if (!build) {
      selectSpecies(currentSpecies ?? undefined);
      setMessage("");
      return;
    }

    const species = pokemon.find((entry) => entry.id === build.speciesId);
    if (!species) {
      setMessage("保存済み個体のポケモンがマスターデータにありません。", true);
      return;
    }
    speciesSearch.setValue(species.id);
    currentSpecies = species;
    currentBuild = createBaseBuild(species, build, data);
    currentProposal = null;
    currentProposalBuild = null;
    hasSavedProposal = false;
    requestInput.value = build.memo ?? "";
    resultElement.replaceChildren();
    setMessage("");
    updateSubmitState();
  });

  requestInput.addEventListener("input", updateSubmitState);
  root.querySelectorAll("[data-advisor-template]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!(button instanceof HTMLButtonElement)) return;
      requestInput.value = button.dataset.advisorTemplate ?? "";
      requestInput.focus();
      updateSubmitState();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isRequesting) return;
    const species = currentSpecies;
    const userRequest = requestInput.value.trim();
    if (!species || !userRequest) {
      setMessage("対象ポケモンと調整要望を入力してください。", true);
      updateSubmitState();
      return;
    }

    const baseBuild = createBaseBuild(species, currentBuild ?? undefined, data);
    baseBuild.memo = userRequest;
    currentSpecies = species;
    currentBuild = baseBuild;
    isRequesting = true;
    submitLabel.textContent = "調整案を取得しています…";
    spinner.hidden = false;
    submitButton.setAttribute("aria-busy", "true");
    root.classList.add("is-requesting");
    root.querySelectorAll("input, select, textarea, .searchable-input-clear, [data-advisor-template]").forEach((control) => {
      if (control instanceof HTMLInputElement
        || control instanceof HTMLSelectElement
        || control instanceof HTMLTextAreaElement
        || control instanceof HTMLButtonElement) {
        control.disabled = true;
      }
    });
    updateSubmitState();
    setMessage("Geminiに調整案を問い合わせています。");

    try {
      const response = await requestBuildAdjustment(
        species,
        baseBuild,
        userRequest,
        data
      );
      currentProposal = normalizeProposal(response, species, baseBuild);
      currentProposalBuild = {
        ...baseBuild,
        nature: currentProposal.nature ?? "",
        item: currentProposal.item ?? "なし",
        ability: currentProposal.ability ?? "",
        megaForm: currentProposal.megaForm ?? "",
        points: { ...currentProposal.points }
      };
      hasSavedProposal = false;
      renderProposal(species, currentProposal, currentProposalBuild);
      setMessage("調整案を取得しました。実数値はアプリ内で計算しています。");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "調整案を取得できませんでした。",
        true
      );
    } finally {
      isRequesting = false;
      submitLabel.textContent = "AIに調整を提案してもらう";
      spinner.hidden = true;
      submitButton.removeAttribute("aria-busy");
      root.classList.remove("is-requesting");
      root.querySelectorAll("input, select, textarea, .searchable-input-clear, [data-advisor-template]").forEach((control) => {
        if (control instanceof HTMLInputElement
          || control instanceof HTMLSelectElement
          || control instanceof HTMLTextAreaElement
          || control instanceof HTMLButtonElement) {
          control.disabled = false;
        }
      });
      updateSubmitState();
    }
  });

  resultElement.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const actionButton = target.closest("[data-advisor-action]");
    if (!(actionButton instanceof HTMLButtonElement)
      || !currentSpecies
      || !currentProposal
      || !currentProposalBuild) {
      return;
    }

    const action = actionButton.dataset.advisorAction;
    if (action === "save") {
      if (hasSavedProposal) return;
      try {
        const build = createProposalBuild(currentSpecies, currentProposal);
        saveBuild(build);
        hasSavedProposal = true;
        renderProposal(currentSpecies, currentProposal, currentProposalBuild);
        try {
          actions.onBuildsChanged?.();
          setMessage("調整案を個体管理に新規保存しました。");
        } catch (error) {
          setMessage(
            `個体は保存されましたが、保存後の更新通知に失敗しました: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`,
            true
          );
        }
        renderSavedBuildOptions();
      } catch (error) {
        setMessage(
          `個体を保存できませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`,
          true
        );
      }
      return;
    }

    if (action === "attacker" || action === "defender") {
      if (typeof actions.onSendToDamage !== "function") {
        setMessage("ダメージ計算画面への連携が設定されていません。", true);
        return;
      }
      try {
        actions.onSendToDamage(action, createProposalBuild(currentSpecies, currentProposal));
        setMessage(action === "attacker"
          ? "調整案をダメージ計算の攻撃側へ送りました。"
          : "調整案をダメージ計算の防御側へ送りました。");
      } catch (error) {
        setMessage(
          `ダメージ計算へ反映できませんでした: ${error instanceof Error ? error.message : "原因不明のエラーです。"}`,
          true
        );
      }
    }
  });

  document.addEventListener("pokemon-builds-changed", renderSavedBuildOptions);
}
