# ぼうけんドリル 拡張設計書 v4
## データ分離・文章題エンジン・新エリア6ステージ

> 目的：(1) 子どもの「もっとステージほしい」に応える新エリア追加、(2) 問題データの
> HTML外出し（JSON化）、(3) 数字が毎回変わる文章題テンプレートエンジン、の3点を一括実装する
> ための詳細設計。設計書v3の後継。実装担当はコード生成のみが残タスク。

---

## 0. スコープと前提

### 0.1 今回やること

1. **データ層の分離**：国語の単語プールと文章題テンプレートを `words.json` に外出し
2. **文章題テンプレートエンジン**：数字を変数化し、文章と答えが連動する仕組み（層1に実装）
3. **新エリア2つ・6ステージ追加**：「そらの しま」（3ステージ）＋「うみの そこ」（3ステージ、新ボス含む）
4. **マップのエリアゾーンをデータ駆動化**：ステージ追加に自動追従する構造へ
5. sw.js キャッシュ更新（`bouken-v5`）、words.json のキャッシュ追加

### 0.2 やらないこと（スコープ外）

- 漢字の手書き書き取り（要件定義v0の Phase 2 のまま据え置き）
- 既存11ステージの変更（新規追加のみ。既存の見た目・挙動は不変＝後方互換）
- サウンド拡充

### 0.3 実装済み資産（v4アプリ。再利用のみ、再実装禁止）

設計書v3 §0.1 の全資産（テーマ切替・シーン/宝レジストリ・ナビキャラ・演出タイムライン・
導入モーダル・subFlavor・ずかんメモ・ボス演出パターン）に加え：
- `SCENE_SVGS` / `TREASURE_SVGS` レジストリ → 新ステージはエントリ追加のみ
- `makeKanjiGen(pool, prompt)` / `makeOppGen(prompt)` → プール差し替えで新ステージに流用可
- `clearTitle` フィールド → 新ボスにも使用
- `fireBossParticles()` → 新ボスにも使用（発火条件の追加のみ）

---

## 1. データ層：words.json

### 1.1 設計原則

- **層1（ロジック）＝index.html内のJS**、**層2（素材）＝words.json**。合意済み方針。
- 1ファイル集約（案A採用）。種類は最上位キーで分ける。
- 将来AIがこのファイルだけを差し替えて語彙・文章題を増やせることが最重要。
  **スキーマは「配列に要素を足すだけで増える」形に統一**する。

### 1.2 スキーマ（v1）

```json
{
  "version": 1,
  "kanji": {
    "g1a": [["山","やま"], ["川","かわ"], "…既存KANJI_Aを移設…"],
    "g1b": [["王","おう"], "…既存KANJI_Bを移設…"],
    "kana": [["ぱん","パン"], ["けーき","ケーキ"], ["ばす","バス"], "…§3.4参照…"]
  },
  "opposites": [["うえ","した"], "…既存OPPを移設…"],
  "storyProblems": [
    {
      "id": "apple-add",
      "pattern": "add",
      "text": "りんごが {a}こ あります。{b}こ もらいました。ぜんぶで なんこ？",
      "vars": { "a": [2, 9], "b": [1, 8] },
      "unit": "こ"
    },
    {
      "id": "bird-sub",
      "pattern": "sub",
      "text": "とりが {a}わ います。{b}わ とんで いきました。のこりは なんわ？",
      "vars": { "a": [5, 15], "b": [1, "a-1"] },
      "unit": "わ"
    }
  ]
}
```

**スキーマの規約**：
- `kanji.*`：`[表記, よみ]` のペア配列。キー名（g1a等）は STAGES 側から参照される。
  新しいプール（例：2年漢字 `g2a`）は**キーを足すだけ**で追加可能。
- `opposites`：`[語, 反対語]` のペア配列。
- `storyProblems[]`：文章題テンプレート。フィールドは §2 で定義。
- 数値・文字列以外（関数・式の文字列評価）は**格納禁止**。`vars` の上限指定に限り
  `"a-1"` 形式の簡易参照を許す（§2.3）。

### 1.3 初期データ量（実装時にAI生成で同梱する量の指定）

| データ | 既存 | 今回同梱する量 |
|---|---|---|
| kanji.g1a / g1b | 30語 / 34語 | **既存を移設のみ**（増量は次回以降。スキーマ上はいつでも足せる） |
| kanji.kana（カタカナ語） | なし | **40語**（食べ物・乗り物・動物・身の回り品から。§3.4） |
| opposites | 20ペア | **30ペアに増量**（+10。1〜2年語彙の範囲で） |
| storyProblems | なし | **たし算6種＋ひき算6種＝12テンプレート**（場面：くだもの、どうぶつ、おかし、のりもの、こうえん、ほん 等で場面の重複を避ける） |

### 1.4 ロード戦略（重要：file:// 対応）

- 起動時に `fetch('./words.json')` で読み込む。
- **フォールバック必須**：PCでのダブルクリック確認（`file://`）では fetch が
  CORS制約で失敗する。そのため **index.html 内に最小限の内蔵データ
  （`WORDS_FALLBACK`：既存プール相当＋文章題2種のみ）を持ち、fetch失敗時はそれを使う**。
  - 本番（GitHub Pages）：words.json が読まれ、全量が使える
  - file:// 確認時：内蔵フォールバックで全ステージが一応動く（語彙が少ないだけ）
  - この挙動を README に明記する
- ロードは非同期。`init` で `loadWords()` を開始し、**マップ表示はブロックしない**。
  クイズ開始時（`startQuiz`）にロード未完了なら完了を待ってから出題を構築する
  （実装：`wordsReady` Promise を `buildQuestions` の前で await。UI上は導入モーダル表示中に
  完了するため、体感の待ちはほぼ発生しない）。
- `sw.js`：`ASSETS` に `./words.json` を追加。キャッシュ名 `bouken-v5`。

### 1.5 既存コードからの移行

- `KANJI_A` → `WORDS.kanji.g1a`、`KANJI_B` → `WORDS.kanji.g1b`、`OPP` → `WORDS.opposites`
  に参照を差し替え。STAGES の `gen` はプール名の参照になるため、**gen の組み立てを
  「ステージ定義に `gen` 関数を直書き」から「`qtype` フィールド＋パラメータ指定」へ変更してもよい**が、
  影響範囲が大きいため**今回は現行方式（gen直書き）を維持**し、gen内で `WORDS.…` を参照する
  最小変更に留める（プール参照は遅延評価にする：makeKanjiGen にプール名文字列を渡し、
  呼び出し時に WORDS から引く。ロード完了後にしか呼ばれないため安全）。

---

## 2. 文章題テンプレートエンジン（層1に新設）

### 2.1 テンプレートの構成要素

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | string | テンプレート識別子（重複出題の抑制に使用） |
| `pattern` | string | 計算パターン名。v1では `add` / `sub` の2種のみ実装 |
| `text` | string | 問題文。`{a}` `{b}` が変数プレースホルダ |
| `vars` | object | 変数ごとの `[最小, 最大]`。最大には `"a-1"` 形式の参照可（§2.3） |
| `unit` | string | 答えの単位（「こ」「わ」等）。結果画面・不正解表示で「こたえは 「7こ」」のように使用 |

### 2.2 計算パターン（層1、コードに実装。後から増やせる構造）

```
const PATTERNS = {
  add: (v) => v.a + v.b,
  sub: (v) => v.a - v.b
};
```
- パターン追加＝このオブジェクトにエントリを足すだけ。**将来 `mul` / `div` / `diff`（ちがいは
  いくつ）等を足す想定**をコメントで明記しておく。
- words.json 側が未知の pattern を指定していた場合：そのテンプレートは**読み飛ばして console.warn**
  （エラーで止めない。データ先行でパターン未実装、という状況を許容するため）。

### 2.3 変数の生成と制約

- `vars: { "a": [2, 9], "b": [1, "a-1"] }` のように、**bの上限にaを参照する簡易記法**を許す。
  対応する参照形式は `"変数名"` と `"変数名-整数"` の2種のみ（それ以外の式は不可）。
  生成順は宣言順（aを先に確定→bの範囲を解決）。
- **答えの妥当性ガード**：生成後に `answer >= 0` かつ `answer <= 999` を検証し、
  違反したら再生成（最大20回。それでもダメならそのテンプレートをスキップ）。
  これにより「ひき算で答えがマイナス」事故をスキーマ側の制約＋実行時ガードの二重で防ぐ。
- 表示は `text` の `{a}` `{b}` を確定値で置換。答えは `PATTERNS[pattern](vars)`。
  出題形式は**数値入力（テンキー）**、つまり既存の `numQ` と同じ型で返す。
  不正解時の答え表示に `unit` を付ける（「こたえは 「7こ」」）。

### 2.4 出題ビルダー

`makeStoryGen(filter)` を新設。`filter` は省略可で、省略時は全テンプレートから、
`{ pattern:'add' }` のような指定時は該当分から抽選する。1回のクイズ（10問）内では
同一テンプレートの再使用を避け（テンプレート数が10未満の場合のみ再使用許可）、
再使用時も変数値が同じ問題は既存の `buildQuestions` の重複ガードで排除される。

---

## 3. 新しい出題タイプ（層1に追加する gen）

### 3.1 とけい よみ（genClock）

- 1年生範囲：「なんじ」「なんじはん」のみ（分針は12か6の2択に限定）。
- **問題文にアナログ時計のSVGを埋め込む**（インライン生成。viewBox 0 0 100 100、
  文字盤＋短針・長針。針角度は 時針=30°×時＋(はんなら+15°)、分針=0° or 180°）。
  時計SVGの描画スタイルは共通ルール準拠（輪郭線 Ink Line、文字盤 `#FFFDF7`、針 `#C9622E`）。
- 出題：時計を表示し「なんじ かな？」→ 4択（「3じ」「3じはん」「9じ」「9じはん」のような
  紛らわしい選択肢：正解の時刻、その「はん」違い、長針短針を読み違えた時刻、ランダム1つ）。
- データ不要（完全ランダム生成）。

### 3.2 おおきな かず（genBigNum）

- 2年生範囲：100〜1000。出題2形式をランダム：
  (a) 大小比較（「どちらが おおきい？」2択、既存 genCompare の範囲拡大版）
  (b) 合成（「100が {a}こ、10が {b}こ、1が {c}こ で いくつ？」→ 数値入力）
- データ不要。

### 3.3 わりざん（genDiv）

- 3年先取り：九九の逆（`a×b=c` から `c ÷ a = ?`）。あまりなし限定。
- 数値入力。データ不要。

### 3.4 カタカナ よみ（makeKanaGen）

- `WORDS.kanji.kana`（`[ひらがな表記, カタカナ表記]` 40語）から出題。
- 出題：ひらがな語を大きく表示し「カタカナで かくと どれ？」→ 4択
  （正解＋他の語のカタカナ3つ）。既存 makeKanjiGen と同じ仕組みの表記違いなので、
  **makeKanjiGen をそのまま流用**（プール名 `kana`、プロンプト差し替え）で実装できる。
  ※選択肢の並びで文字数がヒントにならないよう、距離の近い語長を優先抽選…は**しない**
  （実装コスト対効果が低い。ランダム3語で可）。

---

（§4以降：新エリア・ステージ詳細、マップ拡張、実装順序、完了定義 → 後半に続く）

---

## 4. 新エリアとステージ（6ステージ追加：11 → 17）

物語上のつなぎ：「さいごの とう」クリア後、コンパスが新しい方角を指す——
空に浮かぶ島「そらの しま」と、海の底「うみの そこ」が現れる、という体裁。
（実装上は単に STAGES 配列の12〜17番目。とうクリアで12番が解放される既存の順次解放のまま）

### 4.0 新エリアのパレット

**そらの しま（Phase E）**
| 役割 | HEX |
|---|---|
| Sky High | `#CFE6F5`（高空の空） |
| Cloud | `#F7F4EC`（雲・既存Snow共用） |
| Sky Isle Green | `#8CC08C`（浮島の草） |
| Isle Rock | `#B8A98A`（浮島の土台・既存Castle Shadow共用） |
| Sun Gold | `#F2C14E`（既存Star Gold共用） |

**うみの そこ（Phase F）**
| 役割 | HEX |
|---|---|
| Deep Sea | `#1F4E66`（深海の水） |
| Sea Mid | `#2E7D99`（中層の水・既存ocean-d近似） |
| Coral Pink | `#F2A0B4`（さんご） |
| Coral Orange | `#F5A55B`（さんご・既存Magma Core共用） |
| Ryugu Aqua | `#7EE0D0`（竜宮の光） |

カード用テーマCSS：
```css
#scr-quiz[data-stage-theme="sora1"], #scr-quiz[data-stage-theme="sora2"],
#scr-quiz[data-stage-theme="sora3"]{ --card-bg:#EDF4FA; --card-frame:#5B9FC4; }
#scr-quiz[data-stage-theme="umi1"], #scr-quiz[data-stage-theme="umi2"],
#scr-quiz[data-stage-theme="umi3"]{ --card-bg:#E4F0EE; --card-frame:#2E7D99; }
```
（本文ink `#4A3B28` とのコントラストを実装時実測。4.5:1 未満なら card-bg を明側へ調整）

コーナー装飾：
- そら＝雲コーナー（角パーツ＋白い雲粒）／うみ＝さんごコーナー（角パーツ＋ピンクさんご粒）。
  既存のdata-URI差し替え方式（v3実装）と同じ。ラフ：
```svg
<!-- そら --> <path d="(既存の角パス)" fill="#5B9FC4"/><ellipse cx="12" cy="12" rx="5" ry="3.5" fill="#F7F4EC" stroke="#3D3323" stroke-width="1.5"/>
<!-- うみ --> <path d="(既存の角パス)" fill="#2E7D99"/><path d="M9 15 Q9 8 12 8 Q15 8 15 15" fill="none" stroke="#F2A0B4" stroke-width="2.5" stroke-linecap="round"/>
```

### 4.1 ステージ12：とけいの きゅうでん（id: sora1 / scene: sora1 / theme: sora1）

- **出題**：genClock（§3.1）／ n:10
- **シーン構図**：雲の上に立つ白い宮殿、屋根の下に大時計（文字盤＝`bd-arch` を時計面の光に）。
```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#CFE6F5"/>
  <ellipse cx="60" cy="104" rx="52" ry="14" fill="#F7F4EC" stroke="#3D3323" stroke-width="2"/>
  <g stroke="#3D3323" stroke-width="2">
    <rect x="34" y="46" width="52" height="52" fill="#F7F4EC"/>
    <rect x="34" y="46" width="8" height="52" fill="#D8D2C0"/>
    <path d="M28 46 L60 24 L92 46 Z" fill="#5B9FC4"/>
  </g>
  <circle cx="60" cy="68" r="14" fill="#FFFDF7" stroke="#3D3323" stroke-width="2"/>
  <circle class="bd-arch" cx="60" cy="68" r="17" fill="#F2C14E" opacity="0"/>
  <path d="M60 68 L60 58 M60 68 L67 68" stroke="#C9622E" stroke-width="2.5" stroke-linecap="round"/>
  <ellipse cx="20" cy="30" rx="11" ry="5" fill="#F7F4EC" stroke="#3D3323" stroke-width="1.5"/>
  <ellipse cx="100" cy="20" rx="9" ry="4" fill="#F7F4EC" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```
- **宝**：とけいの ふりこ（scene: pendulum、1状態）
```svg
<svg viewBox="0 0 100 80"><path d="M50 10 L50 46" stroke="#D4A63C" stroke-width="4"/><rect x="46" y="6" width="8" height="8" rx="2" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/><circle cx="50" cy="56" r="14" fill="#F2C14E" stroke="#3D3323" stroke-width="2"/><path d="M38 52 A14 14 0 0 0 50 70 L50 42 A14 14 0 0 0 38 52Z" fill="#D4A63C"/><circle cx="50" cy="56" r="5" fill="#FFFDF7" stroke="#3D3323" stroke-width="1.5"/></svg>
```
- intro：「くもの うえに おしろが みえる！ここは とけいの きゅうでん。はりが よめたら なかに はいれるよ」
- subFlavor：（4択のため未設定＝デフォルト）／ genClock のプロンプトは「とけいは いま なんじ？」
- memo：「ちくたく ちくたく。きゅうでんの じかんを きざんで いた ふりこ」

### 4.2 ステージ13：ぶんしょうだいの にわ（id: sora2 / scene: sora2 / theme: sora2）

- **出題**：makeStoryGen()（§2.4。add/sub混合）／ n:10 ／ **文章題エンジンの初出ステージ**
- **シーン構図**：浮島の庭園。花壇（3色の花）、じょうろ、中央にアーチ形のトレリス
  （＝`bd-arch` はアーチ内の光）。
```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#CFE6F5"/>
  <path d="M8 96 Q60 84 112 96 L104 112 Q60 120 16 112 Z" fill="#8CC08C" stroke="#3D3323" stroke-width="2"/>
  <path d="M16 112 Q60 120 104 112 L100 118 Q60 124 20 118 Z" fill="#B8A98A"/>
  <path d="M44 96 Q44 66 60 66 Q76 66 76 96" fill="none" stroke="#7A9B5C" stroke-width="5"/>
  <ellipse class="bd-arch" cx="60" cy="86" rx="12" ry="12" fill="#F2C14E" opacity="0"/>
  <g stroke="#3D3323" stroke-width="1.5">
    <circle cx="26" cy="92" r="5" fill="#F2A0B4"/><circle cx="36" cy="96" r="5" fill="#F2C14E"/>
    <circle cx="92" cy="94" r="5" fill="#8E7BC4"/><circle cx="100" cy="90" r="5" fill="#F2A0B4"/>
  </g>
  <path d="M22 88 L26 92 M36 92 L36 96 M92 90 L92 94 M100 86 L100 90" stroke="#4E6E3B" stroke-width="2"/>
  <ellipse cx="104" cy="24" rx="10" ry="4.5" fill="#F7F4EC" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```
- **宝**：まほうの じょうろ（scene: wateringcan、1状態）
```svg
<svg viewBox="0 0 100 80"><path d="M30 30 L66 30 L62 62 L34 62 Z" fill="#7EC8DE" stroke="#3D3323" stroke-width="2"/><path d="M30 30 L34 62 L40 62 L38 30 Z" fill="#4A93B8"/><path d="M66 36 L82 24 L84 30 L68 44" fill="#7EC8DE" stroke="#3D3323" stroke-width="2"/><circle cx="84" cy="26" r="5" fill="#4A93B8" stroke="#3D3323" stroke-width="2"/><path d="M26 34 Q14 40 26 50" fill="none" stroke="#4A93B8" stroke-width="4"/><path d="M88 18 L90 14 M92 24 L96 22 M90 32 L94 34" stroke="#7EE0D0" stroke-width="2" stroke-linecap="round"/></svg>
```
- intro：「そらの にわに ついたよ。おはなの せわを しながら、おはなしの もんだいを といて みよう！」
- subFlavor：「おはなしを よく よんでね」
- memo：「みずを あげると おはなが ちょっと うれしそうに ゆれる」

### 4.3 ステージ14：おおきなかずの くも（id: sora3 / scene: sora3 / theme: sora3）

- **出題**：genBigNum（§3.2）／ n:10
- **シーン構図**：積み上がる入道雲の階段（大きい雲ほど上に）、雲間から差す光（＝`bd-arch`）、
  頂上に「100」の看板を持つ小さな旗。
```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#CFE6F5"/>
  <ellipse class="bd-arch" cx="72" cy="34" rx="20" ry="14" fill="#F2C14E" opacity="0"/>
  <g stroke="#3D3323" stroke-width="2">
    <ellipse cx="30" cy="98" rx="24" ry="11" fill="#F7F4EC"/>
    <ellipse cx="58" cy="76" rx="27" ry="12" fill="#F7F4EC"/>
    <ellipse cx="80" cy="52" rx="30" ry="13" fill="#F7F4EC"/>
  </g>
  <path d="M6 98 A24 11 0 0 0 30 109 L30 87 A24 11 0 0 0 6 98Z" fill="#DDE6EE"/>
  <path d="M31 76 A27 12 0 0 0 58 88 L58 64 A27 12 0 0 0 31 76Z" fill="#DDE6EE"/>
  <path d="M50 52 A30 13 0 0 0 80 65 L80 39 A30 13 0 0 0 50 52Z" fill="#DDE6EE"/>
  <path d="M92 40 L92 22 L106 26 L92 30" fill="#E8763D" stroke="#3D3323" stroke-width="1.5"/>
  <text x="80" y="56" font-size="12" font-weight="bold" fill="#3D3323" text-anchor="middle">100</text>
</svg>
```
  ※シーンSVG内での `<text>` 使用は本ステージのみ例外的に許可（数のステージである記号性を優先）。
- **宝**：かずの ぼうえんきょう（scene: telescope、1状態）
```svg
<svg viewBox="0 0 100 80"><path d="M18 56 L66 26 L74 38 L26 68 Z" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/><path d="M18 56 L26 68 L22 62 Z" fill="#B8892E"/><path d="M64 22 L80 32 L74 42 L58 32 Z" fill="#4A6FA8" stroke="#3D3323" stroke-width="2"/><circle cx="78" cy="30" r="4" fill="#7EE0D0" stroke="#3D3323" stroke-width="1.5"/><path d="M30 66 L26 76 M38 62 L42 74" stroke="#8C7B66" stroke-width="3" stroke-linecap="round"/></svg>
```
- intro：「くもの かいだんを のぼると、とおくまで みわたせるよ。100より おおきい かずの せかいだ！」
- subFlavor：「100の まとまりで かんがえよう」
- memo：「のぞくと とおくの かずまで はっきり みえるんだって」

### 4.4 ステージ15：わりざんの しんかい（id: umi1 / scene: umi1 / theme: umi1）

- **出題**：genDiv（§3.3）／ n:10
- **シーン構図**：深海。上から差す光条、泳ぐ魚の群れ（等分に分かれている＝わり算の暗喩）、
  海底の岩と海藻。光条の中心が `bd-arch`。
```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#1F4E66"/>
  <path d="M50 0 L36 120 L58 120 L64 0 Z" fill="#2E7D99" opacity="0.6"/>
  <ellipse class="bd-arch" cx="52" cy="52" rx="16" ry="24" fill="#7EE0D0" opacity="0"/>
  <g fill="#F2C14E" stroke="#3D3323" stroke-width="1.5">
    <path d="M24 40 L36 44 L24 48 L28 44 Z"/><path d="M24 58 L36 62 L24 66 L28 62 Z"/>
    <path d="M78 46 L90 50 L78 54 L82 50 Z"/><path d="M78 64 L90 68 L78 72 L82 68 Z"/>
  </g>
  <path d="M0 108 Q20 100 34 108 T70 108 T120 106 L120 120 L0 120 Z" fill="#173B4E" stroke="#3D3323" stroke-width="2"/>
  <path d="M20 108 Q18 94 24 86 M28 108 Q30 96 26 90" fill="none" stroke="#4E6E3B" stroke-width="3" stroke-linecap="round"/>
  <circle cx="98" cy="30" r="2.5" fill="#7EE0D0"/><circle cx="104" cy="20" r="2" fill="#7EE0D0"/>
</svg>
```
- **宝**：しんじゅの たま（scene: pearl、1状態）
```svg
<svg viewBox="0 0 100 80"><path d="M22 52 Q50 20 78 52 Q64 66 50 66 Q36 66 22 52Z" fill="#F2A0B4" stroke="#3D3323" stroke-width="2"/><path d="M22 52 Q50 20 78 52 Q64 44 50 44 Q36 44 22 52Z" fill="#E07A94"/><circle cx="50" cy="48" r="11" fill="#FFFDF7" stroke="#3D3323" stroke-width="2"/><circle cx="46" cy="44" r="3.5" fill="#7EE0D0" opacity="0.7"/></svg>
```
- intro：「ざぶーん！うみの そこに もぐるよ。おさかなを おなじ かずずつ わけて あげよう」
- subFlavor：「九九を さかさに つかうと とけるよ」
- memo：「かいの なかで ながい あいだ そだった たからもの」

### 4.5 ステージ16：カタカナの ちんぼつせん（id: umi2 / scene: umi2 / theme: umi2）

- **出題**：makeKanjiGen('kana', 'カタカナで かくと どれ？')（§3.4）／ n:10
- **シーン構図**：海底の沈没船（傾いた船体2階調＋折れたマスト）、船窓から漏れる光
  （＝`bd-arch`）、まわりにさんご。
```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#1F4E66"/>
  <g stroke="#3D3323" stroke-width="2" transform="rotate(-8 60 78)">
    <path d="M22 70 L98 70 L88 96 L34 96 Z" fill="#8A6543"/>
    <path d="M22 70 L34 96 L42 96 L32 70 Z" fill="#6E4A28"/>
    <rect x="56" y="34" width="6" height="36" fill="#6E4A28"/>
    <path d="M62 38 L86 50 L62 56 Z" fill="#EFE6D0"/>
  </g>
  <circle cx="48" cy="82" r="5" fill="#F2C14E" stroke="#3D3323" stroke-width="1.5"/>
  <circle class="bd-arch" cx="48" cy="82" r="8" fill="#F2C14E" opacity="0"/>
  <circle cx="70" cy="84" r="5" fill="#173B4E" stroke="#3D3323" stroke-width="1.5"/>
  <path d="M8 112 Q8 98 14 92 M16 112 Q18 100 14 96 M104 112 Q104 100 110 94" fill="none" stroke="#F2A0B4" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="30" cy="40" r="2" fill="#7EE0D0"/><circle cx="36" cy="30" r="2.5" fill="#7EE0D0"/>
</svg>
```
- **宝**：せんちょうの ぼうし（scene: captainhat、1状態）
```svg
<svg viewBox="0 0 100 80"><path d="M22 50 Q50 22 78 50 L78 56 Q50 48 22 56 Z" fill="#2E4A6E" stroke="#3D3323" stroke-width="2"/><path d="M22 50 Q36 36 50 32 L50 52 Q36 52 22 56 Z" fill="#1F3852"/><path d="M14 56 Q50 46 86 56 Q50 64 14 56Z" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/><circle cx="50" cy="42" r="6" fill="#F2C14E" stroke="#3D3323" stroke-width="1.5"/></svg>
```
- intro：「ふるい ふねが しずんで いる…！つみにの なまえは ぜんぶ カタカナで かかれて いるみたい」
- memo：「かぶると きぶんは おおうなばらの せんちょう！」

### 4.6 ステージ17：でんせつの りゅうぐう（id: umi3 / scene: umi3 / theme: umi3）— 新ボス

- **出題**：ミックス（既存とうのミックスに、今回の新型を加える）：
  `pick([genAddCarry, genSubBorrow, genKuku, genDiv, genBigNum, genClock, makeStoryGen(), makeKanjiGen('kana', …)])`
  ／ **n:14**（旧ボス12より多く）
- **シーン構図**：竜宮城。アクアの光をまとった多層の屋根（2階調×2層）、正面の門
  （＝`bd-arch`、Ryugu Aqua の光）、まわりに泡と魚。
```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#173B4E"/>
  <g stroke="#3D3323" stroke-width="2">
    <path d="M24 58 Q60 40 96 58 L88 66 L32 66 Z" fill="#F2A0B4"/>
    <path d="M24 58 Q42 49 60 47 L60 66 L32 66 Z" fill="#E07A94"/>
    <path d="M34 86 Q60 72 86 86 L80 92 L40 92 Z" fill="#F2A0B4"/>
    <rect x="40" y="66" width="40" height="8" fill="#7EE0D0"/>
    <rect x="36" y="92" width="48" height="20" fill="#EFE6D0"/>
  </g>
  <path d="M54 112 L54 98 Q60 92 66 98 L66 112 Z" fill="#1F4E66"/>
  <ellipse class="bd-arch" cx="60" cy="104" rx="7" ry="9" fill="#7EE0D0" opacity="0"/>
  <circle cx="20" cy="30" r="2.5" fill="#7EE0D0"/><circle cx="26" cy="20" r="2" fill="#7EE0D0"/>
  <path d="M98 34 L108 37 L98 40 L101 37 Z" fill="#F2C14E" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```
- **宝**：りゅうぐうの たまてばこ（scene: tamatebako、**2状態**：閉じた箱 → 開いて
  Ryugu Aqua の光があふれる。既存の tr-a/tr-b 汎用機構を使用）
```svg
<svg viewBox="0 0 100 80">
  <g class="tr-a">
    <rect x="28" y="34" width="44" height="28" rx="4" fill="#C9622E" stroke="#3D3323" stroke-width="2"/>
    <path d="M28 34 Q50 22 72 34 L72 42 L28 42 Z" fill="#A84A20" stroke="#3D3323" stroke-width="2"/>
    <rect x="46" y="38" width="8" height="10" rx="2" fill="#D4A63C" stroke="#3D3323" stroke-width="1.5"/>
  </g>
  <g class="tr-b" style="display:none;opacity:0">
    <rect x="28" y="40" width="44" height="24" rx="4" fill="#C9622E" stroke="#3D3323" stroke-width="2"/>
    <path d="M28 40 Q50 14 72 40" fill="none" stroke="#A84A20" stroke-width="5"/>
    <ellipse cx="50" cy="36" rx="16" ry="12" fill="#7EE0D0" opacity="0.8"/>
    <path d="M42 26 L40 18 M50 24 L50 14 M58 26 L60 18" stroke="#7EE0D0" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="50" cy="38" r="4" fill="#FFFDF7"/>
  </g>
</svg>
```
- **ボス特別演出**（既存とうと同等＋α）：
  - `clearTitle: '🌊 うみの でんせつに なった！'`
  - クリア時 `fireBossParticles()` を発火（発火条件に `s.id === 'umi3'` を追加。
    実装は条件を `(s.id === 'tou' || s.id === 'umi3')` ではなく **`STAGES[i].boss === true`
    フィールドの新設**に変更し、tou と umi3 の両方に `boss:true` を付ける。
    今後ボスを増やす時にフィールド追加だけで済むようにする）
- intro：「うみの いちばん ふかい ばしょに、でんせつの りゅうぐうじょうが…！ぜんぶの ちからを あわせて とびらを あけよう！」
- memo：「あけては いけない…と いわれて いるけど、もう あけちゃった」

---

## 5. マップ拡張（データ駆動ゾーン）

### 5.1 現状の問題

エリアゾーン（`.zone.z1〜z4`）が**CSSの固定%指定**のため、ステージ追加で島が伸びると
帯の位置がずれる。今回17ステージになるため、このままでは破綻する。

### 5.2 改修：AREAS 定義とゾーンの動的生成

層1に AREAS 配列を新設し、`renderMap()` がゾーンdivを動的生成する方式に変更：

```js
const AREAS = [
  { name:'みずべ',   from:0,  to:2,  color:'#7FB069' },
  { name:'ちてい',   from:3,  to:4,  color:'#5A5478' },
  { name:'ことば',   from:5,  to:7,  color:'#A89A80' },
  { name:'さんちょう', from:8,  to:10, color:'#5C6873' },
  { name:'そらのしま', from:11, to:13, color:'#5B9FC4' },
  { name:'うみのそこ', from:14, to:16, color:'#2E7D99' }
];
```
- ゾーンの top/height はノードのY座標計算（TOPPAD + i*STEP）から導出：
  `top = (TOPPAD + from*STEP - 60) / H * 100 %`、`height = ((to - from + 1) * STEP) / H * 100 %`
  （H はマップ全高。端のゾーンは 0%/100% にクランプ）
- 静的な `.zone.z1〜z4` の div と CSS は**削除**し、opacity・角丸は共通クラス `.zone` に残す。
- XS（ジグザグX座標配列）は 17 要素に拡張（既存11 + `[26, 68, 26, 68, 26, 47]`。
  最終ボス umi3 は中央 47%）。**配列長が STAGES.length に満たない場合は
  `XS[i % XS.length]` でループ**させ、今後の追加で index エラーが出ない防御を入れる。

### 5.3 エリア名ラベル（新規・小change）

各ゾーンの左上に、エリア名の小さなラベル（`.zoneLabel`、ひらがな、12px、白ピル背景、
opacity 0.85）を表示する。子どもがマップ上で「いま どこ」を把握しやすくするため。

---

## 6. 横断仕上げ

1. **sw.js**：`CACHE = 'bouken-v5'`、`ASSETS` に `./words.json` を追加
2. **README**：v5 の節を追記（新エリア6ステージ、words.json の役割、file:// 時の
   フォールバック挙動、AIでの words.json 増補手順の説明）
3. **確認用HTML**：全ステージ解放版を今回も生成（`isUnlocked` を true 化した別ファイル）
4. **検証**（完了定義）：
   - jsdom：全17ステージの通し（テーマ・シーン・出題生成・宝・ボス2種の花火/称号）
   - 文章題エンジン単体テスト：全テンプレート×1000回生成で「answer >= 0」「プレースホルダ
     残存なし」「未知パターンのスキップ動作」を検証
   - genClock/genBigNum/genDiv の値域テスト（各1000回）
   - words.json ロード失敗時（フォールバック）のjsdomテスト
   - 全テーマのコントラスト実測AA
   - 新シーン6・新宝6のPNGコンタクトシート目視
5. **実装順序**：words.jsonとロード機構 → 文章題エンジン＋新gen4種 → AREAS/ゾーン動的化 →
   新6ステージ（素材・STAGES追記・テーマCSS） → ボスフラグ化 → 仕上げ・検証

## 7. 完了の定義（Go判断材料）

1. 既存11ステージの見た目・挙動が**一切変わっていない**（後方互換）
2. とうクリア後に「そらの しま」が解放され、17ステージまで進行できる
3. 文章題が毎回違う数字で出題され、答え・単位表示が連動する
4. words.json を差し替えるだけで語彙・文章題が増やせる（コード変更ゼロで）
5. file://（PCダブルクリック）でも全ステージがフォールバックデータで動作する
6. §6-4 の検証がすべてパスし、コントラスト実測・PNG目視の結果が報告される
