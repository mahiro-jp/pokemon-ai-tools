import { getApiKey, getGeminiModel } from "./storage.js";

const MAX_POINT_PER_STAT = 32;
const MAX_TOTAL_POINTS = 66;
const STAT_NAMES = ["hp", "atk", "def", "spa", "spd", "spe"];
const API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const API_KEY_REQUIRED_MESSAGE = "右上のAPI設定からGemini APIキーを登録してください";

/**
 * Geminiに返却させる調整提案の構造化出力スキーマ。
 * @type {Record<string, unknown>}
 */
export const ADJUSTMENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    nature: {
      type: "string",
      description: "推奨する性格（日本語名）"
    },
    item: {
      type: "string",
      description: "推奨する持ち物（日本語名）。メガシンカ時はメガストーン"
    },
    ability: {
      type: "string",
      description: "推奨する特性（日本語名）"
    },
    megaForm: {
      type: "string",
      description: "メガシンカ時のフォルム名。通常時は空文字"
    },
    points: {
      type: "object",
      properties: {
        hp: { type: "integer" },
        atk: { type: "integer" },
        def: { type: "integer" },
        spa: { type: "integer" },
        spd: { type: "integer" },
        spe: { type: "integer" }
      },
      required: ["hp", "atk", "def", "spa", "spd", "spe"]
    },
    moves: {
      type: "array",
      items: { type: "string" },
      description: "推奨する技構成（最大4つ）"
    },
    benchmarks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "仮想敵と技名"
          },
          category: {
            type: "string",
            enum: ["offense", "defense", "speed"]
          },
          summary: {
            type: "string",
            description: "調整ラインの結果"
          }
        },
        required: ["target", "category", "summary"]
      }
    },
    explanation: {
      type: "string",
      description: "調整意図の解説文"
    }
  },
  required: [
    "nature",
    "item",
    "ability",
    "megaForm",
    "points",
    "moves",
    "benchmarks",
    "explanation"
  ]
};

/**
 * 育成提案に適用するルールと実数値計算式をシステムプロンプトとして作成する。
 * @returns {string} Geminiに渡す日本語のシステムプロンプト。
 */
export function buildAdvisorSystemPrompt() {
  return [
    "あなたはポケモンの育成調整を提案するアシスタントです。必ず日本語で回答し、指定されたJSONスキーマに従ってください。",
    "レベルは常に50固定です。能力ポイントはhp、atk、def、spa、spd、speの各ステータスに0〜32の整数で配分し、6ステータスの合計を必ず66以下にしてください。",
    "実数値の計算は次の式を基準にしてください。HPは「floor((種族値*2+31)*0.5)+60+ポイント」、HP以外は「floor((floor((種族値*2+31)*0.5)+5+ポイント)*性格補正)」です。性格補正は上昇1.1、無補正1.0、下降0.9です。これらの式で実数値を考慮し、調整ラインを逆算してください。",
    "種族データやマスターデータにない性格、持ち物、特性、技、フォルムを捏造せず、提示された候補を使ってください。不明な情報を推測で断定しないでください。",
    "メガシンカ可能なポケモンをメガシンカさせる提案では、itemを必ず「メガストーン」にし、megaFormに提示されたメガ後のフォルム名を指定してください。通常フォルムの提案ではmegaFormを空文字にしてください。",
    "movesは最大4つにしてください。benchmarksには攻撃・防御・素早さの調整ラインと結果を簡潔に記載してください。"
  ].join("\n");
}

/**
 * 値を0〜32の整数に補正する。
 * @param {unknown} value 補正する値。
 * @returns {number} 範囲内の整数。数値にできない場合は0。
 */
function clampPoint(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.min(MAX_POINT_PER_STAT, Math.max(0, Math.trunc(numericValue)));
}

/**
 * APIレスポンスから日本語のエラー内容を作成する。
 * @param {number} status HTTPステータスコード。
 * @param {string} model リクエストしたGeminiモデル名。
 * @param {string} detail APIが返したエラー詳細。
 * @returns {string} 利用者向けのエラーメッセージ。
 */
function getHttpErrorMessage(status, model, detail) {
  const detailMessage = detail ? `\nGoogle APIの詳細: ${detail}` : "";
  if (status === 400) {
    return `Gemini APIへのリクエストが正しくありません。モデルや入力内容を確認してください。${detailMessage}`;
  }
  if (status === 401 || status === 403) {
    return `Gemini APIキーが無効か、APIの利用が許可されていません。API設定を確認してください。${detailMessage}`;
  }
  if (status === 429) {
    return `Gemini APIの利用上限に達しました。時間をおいてから再度お試しください。${detailMessage}`;
  }
  if (status === 404) {
    return `Geminiモデル「${model}」が見つからないか、このAPIキーでは利用できません。API設定で利用可能なモデルを選択してください。${detailMessage}`;
  }
  if (status >= 500) {
    return `Gemini APIでサーバーエラーが発生しました（HTTP ${status}、モデル: ${model}）。時間をおいてから再度お試しください。${detailMessage}`;
  }
  return `Gemini APIへのリクエストに失敗しました（HTTP ${status}）。${detailMessage}`;
}

/**
 * Gemini APIのエラーレスポンスから診断用の詳細を読み取る。
 * @param {Response} response HTTPエラーレスポンス。
 * @returns {Promise<string>} APIが返したエラー詳細。
 */
async function readApiErrorDetail(response) {
  let responseText;
  try {
    responseText = await response.text();
  } catch {
    return "エラー詳細を読み取れませんでした。";
  }
  if (!responseText) {
    return "";
  }

  try {
    const body = JSON.parse(responseText);
    if (typeof body?.error?.message === "string") {
      return body.error.message.slice(0, 500);
    }
  } catch {
    return responseText.slice(0, 500);
  }
  return responseText.slice(0, 500);
}

/**
 * Gemini APIから受け取った生成テキストをJSONオブジェクトに変換する。
 * @param {unknown} response APIから受け取ったレスポンス。
 * @returns {Record<string, unknown>} JSONとして解析した調整提案。
 * @throws {Error} 生成テキストがない場合、またはJSON形式でない場合。
 */
function parseGeneratedResponse(response) {
  if (typeof response !== "object" || response === null) {
    throw new Error("Gemini APIのレスポンス形式が正しくありません。");
  }
  const candidates = response.candidates;
  const parts = Array.isArray(candidates) ? candidates[0]?.content?.parts : undefined;
  const text = Array.isArray(parts)
    ? parts.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
    : "";
  if (text.trim() === "") {
    throw new Error("Gemini APIから調整案を取得できませんでした。入力内容を変えて再度お試しください。");
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Gemini APIの調整案をJSONとして読み取れませんでした。再度お試しください。");
  }
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("Gemini APIの調整案の形式が正しくありません。");
  }
  return result;
}

/**
 * Gemini APIに育成調整案を依頼し、ポイント値を安全な範囲に補正して返す。
 * @param {Record<string, unknown>} speciesData 対象ポケモンの種族データ。
 * @param {Record<string, unknown>} currentBuild 現在の育成データ。
 * @param {string} userRequest ユーザーが入力した調整要望。
 * @param {Record<string, unknown>} masterData 性格、技、持ち物などのマスターデータ。
 * @returns {Promise<Record<string, unknown> & { points: Record<string, number>, isPointsOverLimit: boolean }>} 調整案と補正済みポイント。
 * @throws {Error} APIキー未設定、通信失敗、APIエラー、または不正なレスポンスの場合。
 */
export async function requestBuildAdjustment(speciesData, currentBuild, userRequest, masterData) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(API_KEY_REQUIRED_MESSAGE);
  }

  const model = getGeminiModel();
  const endpoint = `${API_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await globalThis.fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildAdvisorSystemPrompt() }]
        },
        contents: [{
          role: "user",
          parts: [{
            text: JSON.stringify({
              speciesData,
              currentBuild,
              userRequest,
              masterData
            })
          }]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: ADJUSTMENT_RESPONSE_SCHEMA
        }
      })
    });
  } catch {
    throw new Error("Gemini APIに接続できませんでした。ネットワーク接続を確認して再度お試しください。");
  }

  if (!response.ok) {
    const detail = await readApiErrorDetail(response);
    throw new Error(getHttpErrorMessage(response.status, model, detail));
  }

  let responseBody;
  try {
    responseBody = await response.json();
  } catch {
    throw new Error("Gemini APIのレスポンスを読み取れませんでした。再度お試しください。");
  }

  const result = parseGeneratedResponse(responseBody);
  const returnedPoints = typeof result.points === "object" && result.points !== null
    ? result.points
    : {};
  const points = Object.fromEntries(
    STAT_NAMES.map((stat) => [stat, clampPoint(returnedPoints[stat])])
  );
  const isPointsOverLimit = Object.values(points).reduce((total, point) => total + point, 0) > MAX_TOTAL_POINTS;

  return {
    ...result,
    points,
    isPointsOverLimit
  };
}
