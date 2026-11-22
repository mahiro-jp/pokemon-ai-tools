# ポケモン育成・ダメージ計算＆AI調整アプリ 仕様書 (SPEC.md)

## 1. アプリ概要とディレクトリ構成

### 1.1 概要
レベル50固定・能力ポイント制（各ステータス最大32 / 合計最大66）の対戦環境に対応した、個体管理・ダメージ計算・Gemini APIによる育成調整提案を行うWebアプリケーション。

### 1.2 ディレクトリ構成
```text
project-root/
├── index.html                  # メインHTML（タブ切り替えUI・API設定モーダル含む）
├── manifest.json               # PWAマニフェスト（standalone表示対応）
├── SPEC.md                     # 本仕様書
├── .github/
│   └── copilot-instructions.md # Copilot用開発ルール
├── css/
│   └── style.css               # 全体スタイル・テーマ変数
├── data/                        # 静的マスターデータ（JSON）
│   ├── pokemon.json            # 図鑑データ（通常時の種族値・タイプ・特性に加え、メガシンカ可能な個体は `megaForms` 配列にメガ後のフォルム名・種族値・タイプ・特性を定義する）
│   ├── moves.json              # 技データ（威力、タイプ、分類、接触判定等）
│   ├── items.json              # 持ち物データ（メガシンカ用アイテムは個別名にせず `"メガストーン"` 1種に統一する）
│   └── natures.json            # 性格補正データ（上昇・下降ステータス）
└── js/
    ├── main.js                 # エントリーポイント・初期化・タブ制御
    ├── calculator.js           # 実数値計算・ダメージ計算ロジック（純粋関数）
    ├── storage.js              # localStorage 保存・読込・バックアップ管理
    ├── geminiApi.js            # Gemini API 連携（Structured Outputs）
    └── ui/
        ├── managerUi.js        # ポケモン登録・一覧・編集UI
        ├── damageUi.js         # ダメージ計算機UI（攻守入替・リアルタイム再計算）
        └── advisorUi.js        # AI調整提案チャット＆ワンクリック反映UI
```

---

## 2. 共通データ構造（JSONスキーマ）

### 2.1 個体データ (`PokemonBuild`)
アプリ全体（個体管理・ダメージ計算・AI提案の反映）で共通して使用するデータ形式。

```json
{
  "id": "uuid-v4-string",
  "speciesId": "garchomp",
  "name": "ガブリアス",
  "memo": "陽気ASベース・メガ枠",
  "level": 50,
  "nature": "ようき",
  "ability": "さめはだ",
  "item": "メガストーン",
  "megaForm": "メガガブリアス",
  "points": {
    "hp": 4,
    "atk": 32,
    "def": 0,
    "spa": 0,
    "spd": 0,
    "spe": 30
  },
  "moves": ["じしん", "げきりん", "いわなだれ", "アイアンヘッド"],
  "updatedAt": "2026-11-22T12:00:00.000Z"
}
```

### 2.2 `localStorage` 保存キー定義
- `pk_app_builds_v1`: `PokemonBuild[]`（登録済み育成個体リスト）
- `pk_app_gemini_key_v1`: `string`（ユーザーが入力した Gemini API キー）
- `pk_app_gemini_model_v1`: `string`（使用モデル名。デフォルト: `"gemini-2.5-flash"`）

---

## 3. ルール・計算仕様 (`js/calculator.js`)

### 3.1 実数値計算（レベル50固定・能力ポイント制）
- 各ステータスの能力ポイント (`point`) は `0` 〜 `32` の整数。
- 6ステータスの合計ポイントは最大 `66` まで。
- **HP実数値**: `floor((種族値 * 2 + 31 + point) * 0.5) + 60`（※ヌケニン等の例外は種族値1判定で `1` 固定）
- **攻撃・防御・特攻・特防・素早さ実数値**: `floor((floor((種族値 * 2 + 31 + point) * 0.5) + 5) * 性格補正)`
  - 性格補正: 上昇 `1.1`、無補正 `1.0`、下降 `0.9`

### 3.2 ダメージ計算仕様
1. **基本ダメージ**: `floor(floor(floor(2 * 50 / 5 + 2) * 威力 * 攻撃実数値 / 防御実数値) / 50) + 2`
2. **各種補正の適用順序と端数処理**:
   - 複数対象補正 (`0.75`)、天気補正 (`1.5` / `0.5`)、急所 (`1.5`) などの乗算時は、ポケモンの仕様に準拠した丸め処理（五捨五超入 `roundHalfDown` または切り捨て `floor`）を関数化して適用する。
   - **乱数幅**: `0.85` 〜 `1.00` の16段階（`85` 〜 `100` を掛けて `100` で切り捨て）すべてのダメージ配列 `number[16]` を返す。
   - **タイプ一致 (STAB)**: `1.5`。
   - **タイプ相性**: `0`, `0.25`, `0.5`, `1`, `2`, `4` 倍。
3. **返却オブジェクト (`DamageResult`)**:
   - `rolls`: `number[16]`（16段階の全ダメージ）
   - `minDamage`: `number` / `maxDamage`: `number`
   - `minPercent`: `number` / `maxPercent`: `number`（小数第1位まで）
   - `koText`: `string`（例: `"確定1発"`, `"乱数1発 (62.5%)"`, `"確定2発"`）

### 3.3 メガシンカ時の計算ルール
- 持ち物（`item`）はポケモンごとの個別名称ではなく、すべて **`"メガストーン"`** に統一し、選択中のポケモンに対応するメガストーンを所持しているものとして扱う。
- 持ち物が `"メガストーン"` かつ `megaForm` が指定されている場合、**能力ポイント (`points`) と性格 (`nature`) は元の個体のまま引き継ぎ**、種族値・タイプ・特性のみ選択されたメガフォルムのデータで上書きして実数値およびダメージを再計算する。
- 持ち物が `"メガストーン"` の場合、はたきおとす等の「持ち物あり/なし判定」や無効化の対象外（メガストーン準拠）として扱う。
- タイプ一致 (STAB) は `1.5` 倍のみ。

---

## 4. 機能別仕様

### 4.1 ポケモン管理機能 (`managerUi.js`)
- 登録済み個体の一覧表示、新規作成、編集、複製、削除。
- ポケモン名選択時に `data/pokemon.json` から種族値・タイプ・特性候補を自動セット。
- 能力ポイント入力欄（スライダーまたは数値入力、上限32）を設け、残りポイント（`66 - 合計`）をリアルタイム表示。合計が66を超える場合は警告表示。
- 入力変更と同時に6ステータスの最終実数値をリアルタイム再計算し、性格上昇ステータスは赤系、下降ステータスは青系で視覚的に強調表示する。
- **メガシンカ連動UI**: `megaForms` を持つポケモンを選択した際、メガシンカ切り替えUI（通常 / メガ / メガX・メガY）を表示する。
  - 持ち物で `"メガストーン"` を選択すると自動的にメガシンカ状態がON（複数ある場合は第1候補を選択）になる。
  - 逆に画面上でメガシンカをONにした場合も、持ち物が自動的に `"メガストーン"` に切り替わる（OFFに戻すと持ち物は `"なし"` に戻る）。

### 4.2 ダメージ計算機能 (`damageUi.js`)
- 画面上部に「攻撃側（Attacker）」と「防御側（Defender）」を配置し、登録済み個体の呼び出しまたは直接編集が可能。
- 「攻守入替」ボタンで攻撃側と防御側のデータを即座に入れ替え可能。
- 技選択（4枠の技ボタンまたはセレクトボックス）、ランク補正（`-6` 〜 `+6`）、持ち物・特性・場や天気の補正トグルを操作すると即座に再計算し、HPバー風のビジュアルと16段階ダメージ詳細を表示する。
- **メガシンカ連動UI**: `megaForms` を持つポケモンを選択した際、メガシンカ切り替えUI（通常 / メガ / メガX・メガY）を表示する。
  - 持ち物で `"メガストーン"` を選択すると自動的にメガシンカ状態がON（複数ある場合は第1候補を選択）になる。
  - 逆に画面上でメガシンカをONにした場合も、持ち物が自動的に `"メガストーン"` に切り替わる（OFFに戻すと持ち物は `"なし"` に戻る）。

### 4.3 Gemini API 調整提案機能 (`geminiApi.js`, `advisorUi.js`)
- **目的**: ユーザーが自然言語で入力した要望（例：「陽気ガブリアスの地震を最高乱数以外耐えつつ、最速100族抜きにしたい」）に基づき、AIが配分案と調整理由を提案し、ワンクリックで個体データに反映する。
- **エンドポイント**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Structured Outputs (`response_schema`)**:
  Gemini API には必ず以下のJSONスキーマを指定し、構造化データを返却させる。

```json
{
  "type": "OBJECT",
  "properties": {
    "nature": { "type": "STRING", "description": "推奨する性格（日本語名）" },
    "item": { "type": "STRING", "description": "推奨する持ち物（日本語名）" },
    "ability": { "type": "STRING", "description": "推奨する特性（日本語名）" },
    "points": {
      "type": "OBJECT",
      "properties": {
        "hp": { "type": "INTEGER" },
        "atk": { "type": "INTEGER" },
        "def": { "type": "INTEGER" },
        "spa": { "type": "INTEGER" },
        "spd": { "type": "INTEGER" },
        "spe": { "type": "INTEGER" }
      },
      "required": ["hp", "atk", "def", "spa", "spd", "spe"]
    },
    "moves": {
      "type": "ARRAY",
      "items": { "type": "STRING" },
      "description": "推奨する技構成（最大4つ）"
    },
    "benchmarks": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "target": { "type": "STRING", "description": "仮想敵と技名（例：陽気ガブリアスのじしん）" },
          "category": { "type": "STRING", "enum": ["offense", "defense", "speed"] },
          "summary": { "type": "STRING", "description": "調整ラインの結果（例：確定耐え / 81.2%〜96.0%）" }
        },
        "required": ["target", "category", "summary"]
      }
    },
    "explanation": { "type": "STRING", "description": "調整意図の解説文" }
  },
  "required": ["nature", "points", "benchmarks", "explanation"]
}
```

- **検証と画面反映フロー（重要）**:
  1. Geminiから返却された `points` について、アプリ側で「各値0〜32・合計66以内」かバリデーションを行う（超過時は自動補正または警告表示）。
  2. 提案された `nature` と `points` をアプリ側の **`calculator.js` に通して正確な実数値とダメージを計算** し、AIの解説文と並べてプレビュー表示する（AIの暗算ミスをUI上で防止する）。
  3. ユーザーが「この調整を適用」ボタンを押すと、現在編集中の個体データ（またはダメージ計算機のステータス）へ数値が一括反映される。
