/**
 * @typedef {{ value: string | number, label: string, subText?: string }} SearchableItem 検索候補。
 * @typedef {{ id: string, placeholder?: string, items: SearchableItem[], initialValue?: string | number, onSelect?: (selectedValue: string | number) => void, onClear?: () => void }} SearchableInputOptions 検索入力欄の設定。
 * @typedef {{ element: HTMLDivElement, input: HTMLInputElement, clearButton: HTMLButtonElement, datalist: HTMLDataListElement, setValue: (value: string | number | null) => void, getValue: () => string | number | null }} SearchableInput 検索入力欄と操作メソッド。
 */

/**
 * ひらがなの1文字を対応するカタカナへ変換する。
 * @param {string} character 変換する文字。
 * @returns {string} 変換後の文字。
 */
function convertKanaCharacter(character) {
  return String.fromCharCode(character.charCodeAt(0) + 0x60);
}

/**
 * ひらがなを対応するカタカナへ変換する。
 * @param {string} value 変換する文字列。
 * @returns {string} カタカナへ変換した文字列。
 */
function normalizeKana(value) {
  return value.replace(/[ぁ-ゖ]/g, convertKanaCharacter);
}

/**
 * 検索候補から指定された値を持つ項目を取得する。
 * @param {SearchableItem[]} items 検索候補一覧。
 * @param {string | number} value 検索する項目の値。
 * @returns {SearchableItem | undefined} 一致した項目。
 */
function findItemByValue(items, value) {
  for (const item of items) {
    if (item.value === value) return item;
  }
  return undefined;
}

/**
 * 表示名が一致する検索候補を取得する。
 * @param {SearchableItem[]} items 検索候補一覧。
 * @param {string} label 検索する表示名。
 * @returns {SearchableItem | undefined} 一致した項目。
 */
function findItemByLabel(items, label) {
  for (const item of items) {
    if (normalizeKana(item.label.trim()) === label) return item;
  }
  return undefined;
}

/**
 * 文字検索と候補選択ができる入力欄を生成する。
 * @param {SearchableInputOptions} options 入力欄の設定。
 * @returns {SearchableInput} 生成した要素と値の設定メソッド。
 * @throws {TypeError} 設定や検索候補が不正な場合。
 * @throws {RangeError} 初期値または設定値に対応する検索候補がない場合。
 */
export function createSearchableInput(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("検索入力欄の設定が必要です。");
  }
  if (typeof options.id !== "string" || options.id.trim() === "") {
    throw new TypeError("検索入力欄のIDを指定してください。");
  }
  if (!Array.isArray(options.items)) {
    throw new TypeError("検索候補は配列で指定してください。");
  }

  const items = options.items;
  for (const item of items) {
    if (!item || typeof item !== "object"
      || (typeof item.value !== "string" && typeof item.value !== "number")
      || String(item.value) === ""
      || typeof item.label !== "string"
      || (item.subText !== undefined && typeof item.subText !== "string")) {
      throw new TypeError("検索候補には値と表示名を指定してください。");
    }
  }
  if (options.onSelect !== undefined && typeof options.onSelect !== "function") {
    throw new TypeError("選択時のコールバックは関数で指定してください。");
  }
  if (options.onClear !== undefined && typeof options.onClear !== "function") {
    throw new TypeError("クリア時のコールバックは関数で指定してください。");
  }

  const element = document.createElement("div");
  element.className = "searchable-input";

  const input = document.createElement("input");
  input.id = options.id;
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = options.placeholder ?? "";
  input.setAttribute("list", `${options.id}-list`);

  const clearButton = document.createElement("button");
  clearButton.className = "searchable-input-clear";
  clearButton.type = "button";
  clearButton.setAttribute("aria-label", "入力をクリア");
  clearButton.textContent = "×";
  clearButton.hidden = true;

  const datalist = document.createElement("datalist");
  datalist.id = `${options.id}-list`;
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.label;
    if (item.subText) option.label = item.subText;
    datalist.append(option);
  }

  element.append(input, clearButton, datalist);

  /** @type {string | number | undefined} */
  let lastSelectedValue;
  /** @type {string | number | undefined} */
  let selectedValue;

  /**
   * 入力文字を候補と照合し、一致した項目を通知する。
   * @returns {void}
   */
  function selectExactMatch() {
    const searchValue = normalizeKana(input.value.trim());
    const item = findItemByLabel(items, searchValue);

    if (!item) {
      lastSelectedValue = undefined;
      selectedValue = undefined;
      return;
    }
    selectedValue = item.value;
    if (lastSelectedValue !== item.value) {
      lastSelectedValue = item.value;
      options.onSelect?.(item.value);
    }
  }

  /**
   * 入力内容を正規化して表示と選択状態を更新する。
   * @param {boolean} isComposing 日本語入力の変換中かどうか。
   * @returns {void}
   */
  function handleInput(isComposing = false) {
    if (!isComposing) {
      const normalizedValue = normalizeKana(input.value);
      if (normalizedValue !== input.value) {
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;
        input.value = normalizedValue;
        if (selectionStart !== null && selectionEnd !== null) {
          input.setSelectionRange(selectionStart, selectionEnd);
        }
      }
      selectExactMatch();
    }
    clearButton.hidden = input.value.length === 0;
  }

  /**
   * 入力イベントに応じて検索内容を更新する。
   * @param {InputEvent} event 入力イベント。
   * @returns {void}
   */
  function handleInputEvent(event) {
    handleInput(event.isComposing);
  }

  /**
   * 日本語入力の変換確定後に検索内容を更新する。
   * @returns {void}
   */
  function handleCompositionEnd() {
    handleInput();
  }

  /**
   * 入力確定時に候補を選択する。
   * @returns {void}
   */
  function handleChange() {
    selectExactMatch();
  }

  /**
   * 入力値を消去してクリア通知を行う。
   * @returns {void}
   */
  function handleClear() {
    input.value = "";
    lastSelectedValue = undefined;
    selectedValue = undefined;
    clearButton.hidden = true;
    options.onClear?.();
    input.focus();
  }

  input.addEventListener("input", handleInputEvent);
  input.addEventListener("compositionend", handleCompositionEnd);
  input.addEventListener("change", handleChange);
  clearButton.addEventListener("click", handleClear);

  /**
   * 項目の値を表示名へ変換して入力欄へ設定する。
   * コールバックは呼び出さず、フォームの外部更新に使用する。
   * @param {string | number | null} value 設定する項目の値。nullまたは空文字でクリアする。
   * @returns {void}
   * @throws {RangeError} 値に対応する検索候補がない場合。
   */
  function setValue(value) {
    if (value === null || value === "") {
      input.value = "";
      lastSelectedValue = undefined;
      selectedValue = undefined;
      clearButton.hidden = true;
      return;
    }

    const item = findItemByValue(items, value);
    if (!item) {
      throw new RangeError("指定された値に対応する検索候補がありません。");
    }
    input.value = item.label;
    lastSelectedValue = item.value;
    selectedValue = item.value;
    clearButton.hidden = false;
  }

  /**
   * 入力欄で現在確定している候補の値を取得する。
   * @returns {string | number | null} 確定した候補の値。未選択時はnull。
   */
  function getValue() {
    return selectedValue ?? null;
  }

  if (options.initialValue !== undefined && options.initialValue !== "") {
    setValue(options.initialValue);
  }

  return { element, input, clearButton, datalist, setValue, getValue };
}
