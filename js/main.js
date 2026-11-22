import {
  getApiKey,
  getGeminiModel,
  saveApiKey,
  saveGeminiModel
} from "./storage.js";

/**
 * アプリ内で共有するマスターデータ。
 * 読み込みに失敗したデータは空配列として保持し、画面にエラーを通知する。
 * @type {{ pokemon: unknown[], moves: unknown[], items: unknown[], natures: unknown[] }}
 */
export let masterData = {
  pokemon: [],
  moves: [],
  items: [],
  natures: []
};

const MASTER_DATA_PATHS = {
  pokemon: "./data/pokemon.json",
  moves: "./data/moves.json",
  items: "./data/items.json",
  natures: "./data/natures.json"
};

/**
 * 指定したJSONマスターデータを取得する。
 * @param {string} path 読み込むJSONファイルのパス。
 * @returns {Promise<unknown[]>} 読み込んだ配列データ。
 * @throws {Error} 通信失敗、HTTPエラー、または配列形式でない場合。
 */
async function fetchMasterData(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} の読み込みに失敗しました（HTTP ${response.status}）。`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`${path} のデータ形式が正しくありません。`);
  }
  return data;
}

/**
 * マスターデータを並列で読み込み、利用できないデータを空配列にする。
 * @returns {Promise<string[]>} 読み込みに失敗したデータのエラーメッセージ。
 */
async function loadMasterData() {
  const entries = Object.entries(MASTER_DATA_PATHS);
  const results = await Promise.all(entries.map(async ([name, path]) => {
    try {
      return { name, data: await fetchMasterData(path), error: "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "原因不明のエラーです。";
      return { name, data: [], error: message };
    }
  }));

  masterData = Object.fromEntries(results.map(({ name, data }) => [name, data]));
  return results.filter((result) => result.error).map((result) => result.error);
}

/**
 * 選択中のタブと対応するパネルを切り替える。
 * @param {string} panelId 表示するパネルのID。
 * @returns {void}
 */
function activateTab(panelId) {
  const tabButtons = document.querySelectorAll("[data-tab-target]");
  const panels = document.querySelectorAll(".tab-panel");
  const selectedButton = Array.from(tabButtons).find(
    (button) => button.dataset.tabTarget === panelId
  );
  const selectedPanel = document.getElementById(panelId);
  if (!selectedButton || !selectedPanel) return;

  tabButtons.forEach((button) => {
    const isActive = button === selectedButton;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });
  panels.forEach((panel) => {
    panel.hidden = panel !== selectedPanel;
  });
}

/**
 * APIキーの設定状況に応じてヘッダーの表示を更新する。
 * @returns {void}
 */
function updateApiKeyBadge() {
  const badge = document.getElementById("api-key-badge");
  if (badge) badge.hidden = Boolean(getApiKey().trim());
}

/**
 * API設定ダイアログを保存済みの設定で開く。
 * @returns {void}
 */
function openApiSettings() {
  const dialog = document.getElementById("api-settings-dialog");
  const apiKeyInput = document.getElementById("gemini-api-key");
  const modelSelect = document.getElementById("gemini-model");
  const message = document.getElementById("api-settings-message");
  if (!(dialog instanceof HTMLDialogElement)
    || !(apiKeyInput instanceof HTMLInputElement)
    || !(modelSelect instanceof HTMLSelectElement)
    || !(message instanceof HTMLElement)) {
    return;
  }

  apiKeyInput.value = getApiKey();
  const savedModel = getGeminiModel();
  if (Array.from(modelSelect.options).some((option) => option.value === savedModel)) {
    modelSelect.value = savedModel;
  } else {
    modelSelect.value = "gemini-2.5-flash";
  }
  message.textContent = "";
  message.classList.remove("is-error");
  dialog.showModal();
  apiKeyInput.focus();
}

/**
 * API設定ダイアログを閉じる。
 * @returns {void}
 */
function closeApiSettings() {
  const dialog = document.getElementById("api-settings-dialog");
  if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
}

/**
 * API設定フォームの内容を保存し、キーの設定状態を更新する。
 * @param {SubmitEvent} event フォーム送信イベント。
 * @returns {void}
 */
function saveApiSettings(event) {
  event.preventDefault();
  const apiKeyInput = document.getElementById("gemini-api-key");
  const modelSelect = document.getElementById("gemini-model");
  const message = document.getElementById("api-settings-message");
  if (!(apiKeyInput instanceof HTMLInputElement)
    || !(modelSelect instanceof HTMLSelectElement)
    || !(message instanceof HTMLElement)) {
    return;
  }

  try {
    saveApiKey(apiKeyInput.value.trim());
    saveGeminiModel(modelSelect.value);
    updateApiKeyBadge();
    closeApiSettings();
  } catch (error) {
    message.textContent = error instanceof Error
      ? `設定を保存できませんでした: ${error.message}`
      : "設定を保存できませんでした。";
    message.classList.add("is-error");
  }
}

/**
 * 初期画面のタブとAPI設定のイベントを準備する。
 * @returns {void}
 */
function initializeControls() {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const panelId = button.dataset.tabTarget;
      if (panelId) activateTab(panelId);
    });
  });

  document.getElementById("api-settings-button")
    ?.addEventListener("click", openApiSettings);
  document.getElementById("api-settings-close")
    ?.addEventListener("click", closeApiSettings);
  document.getElementById("api-settings-cancel")
    ?.addEventListener("click", closeApiSettings);
  document.getElementById("api-settings-form")
    ?.addEventListener("submit", saveApiSettings);
  updateApiKeyBadge();
  activateTab("tab-manager");
}

/**
 * マスターデータ読み込み結果を画面に通知する。
 * @param {string[]} errors 読み込みに失敗したデータのエラーメッセージ。
 * @returns {void}
 */
function showMasterDataErrors(errors) {
  const status = document.getElementById("app-status");
  if (!status || errors.length === 0) return;

  status.textContent = `一部のマスターデータを読み込めませんでした。該当機能が制限される場合があります。${errors.join(" ")}`;
  status.hidden = false;
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeControls();
  const errors = await loadMasterData();
  showMasterDataErrors(errors);
});
