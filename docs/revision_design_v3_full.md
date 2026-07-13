# ぼうけんドリル 全体リビジョン設計書 v3
## 残り10ステージ＋横断改修の詳細設計（Phase A〜D）

> 目的：パイロット「かんじの いせき」で確立し、だいのGo判断を得た絵作り・演出パターンを、
> 残り10ステージとマップ全体に展開する。本書は実装担当に渡す詳細設計であり、
> 残タスクはコード生成のみ。設計書v2（revision_design_v2_iseki_pilot.md）の後継。

---

## 0. 実装済み資産の棚卸し（何ができていて、何が残っているか）

### 0.1 すでに実装済み（v3アプリ＝パイロット実装で完成、**再利用するだけ。再実装禁止**）

| 資産 | 実装内容 | 横展開時の使い方 |
|---|---|---|
| テーマ切替の仕組み | `STAGES[i].theme` → `#scr-quiz[data-stage-theme="..."]` にCSS変数上書き | 各ステージの `theme` 値とCSSブロックを追加するだけ |
| シーンノードの仕組み | `STAGES[i].scene` があると `.disc-scene` でSVG表示。ロック=grayscaleフィルタ、挑戦中=`.bd-arch`要素のglow、クリア=`.bd-arch`金色化。**ただし現状 `s.scene === 'iseki'` のハードコード**（→§2.1で汎用化） | シーンSVGを登録するだけ |
| ナビキャラ「コンパス」 | SVG本体・表情4種切替 `setBuddyFace()`・命名ダイアログ・名前変更・`withName()` | 全ステージで自動的に有効。**追加作業ゼロ** |
| フィードバック演出 | 正解1020ms/不正解1920msタイムライン、針回転、パーティクル、シェイク、`prefers-reduced-motion` 対応 | 全ステージで自動的に有効。**追加作業ゼロ** |
| 導入モーダル | `STAGES[i].intro` 定義で自動発動（同日1回） | 各ステージの `intro` 文言を書くだけ |
| フレーバー問題文 | `makeKanjiGen(pool, prompt)` の第2引数 | 国語系はそのまま。**算数系とgenOppは未対応**（→§2.2/2.3） |
| 宝物演出 | 巻物の pop→開閉クロスフェード→ナビキャラ super 登場。**ただし `treasure.scene === 'scroll'` のハードコード**（→§2.1で汎用化） | 宝SVGを登録するだけ |
| ずかん発見メモ | `treasure.memo` 定義で自動表示 | 各宝の `memo` を書くだけ |
| 品質チェック体制 | jsdom通し検証、コントラスト計算、SVGのPNG化目視 | 各Phaseで同じ手順を実施 |

### 0.2 本設計書で規定するもの（残作業）

1. **仕組みの小さな拡張3点**（§2）：シーン/宝SVGのハードコード解消、算数のフレーバー対応、genOppのプロンプト対応
2. **各ステージの素材4点セット×10**（§3〜6）：パレット、シーンSVG、宝SVG、文言（intro/フレーバー/memo）
3. **マップ背景の改修**（§7）：ベタ塗りの海と島を、エリア分けの見える島イラストに
4. **ボス「さいごのとう」の特別演出**（§6.3）
5. **横断仕上げ**（§8）：確認用ショートカット削除、sw.js キャッシュ更新

### 0.3 継承する共通ルール（v2設計書 §1 より。変更なし）

- 全図形に輪郭線：`stroke:#3D3323; stroke-width:1.5〜2.5; stroke-linejoin:round`
- 単色ベタ塗り禁止：1立体につき明部・暗部の2階調（セルシェーディング）。グラデーション不使用
- 石・岩は完全な長方形にしない（四隅を数px歪ませる）
- 光源は右上45度で統一
- 文字×背景のコントラストはAA（4.5:1）以上。実装時に相対輝度計算で実測し報告に含める
- アニメーションはCSSのみ、`prefers-reduced-motion: reduce` で無効化
- シーンSVGは viewBox `0 0 120 120`、宝SVGは viewBox `0 0 100 80`
- **シーンSVGは必ず glow 対象の要素を1つ持ち、`class="bd-arch"` を付ける**
  （挑戦中glow/クリア金色化のCSSがこのクラスを対象にしているため。パイロットで確立した規約）

---

## 1. フェーズ構成と実装順序

| Phase | エリア | ステージ | 優先理由 |
|---|---|---|---|
| A | みずべエリア | すうじのもり／たしざんのはま／ひきざんのかわ | 序盤＝第一印象。マップ背景改修も同時に実施 |
| D | さんちょうエリア | 九九のやま／けいさんのしろ／さいごのとう | 目標地点の魅力でモチベーション牽引。ボス演出 |
| B | ちていエリア | くりあがりのどうくつ／くりさがりのたに | 中盤 |
| C | ことばエリア | ことばのはし／かんじのしんでん | 遺跡パレット流用で工数最小。最後に回せる |

各Phase完了ごとに：jsdom検証＋コントラスト実測＋SVGのPNG目視 → zip更新 → だい確認。
Phase間で仕様変更が入った場合は本書を改訂してから次へ進む。

---

## 2. 仕組みの拡張（先行実装。Phase Aの冒頭で行う）

### 2.1 シーン/宝SVGのレジストリ化（ハードコード解消）

現状:
- `renderMap()` 内 `s.scene === 'iseki' ? ISEKI_NODE_SVG : ...`
- `finish()` 内 `s.treasure.scene === 'scroll'` 分岐

改修後:
```js
const SCENE_SVGS = { iseki: ISEKI_NODE_SVG, mori: MORI_NODE_SVG, ... };
const TREASURE_SVGS = { scroll: SCROLL_SVG, acorn: ACORN_SVG, ... };
```
- `renderMap()`：`const discInner = SCENE_SVGS[s.scene] || (unlocked ? s.icon : '🔒');`
  （scene未定義 or 未登録なら従来の絵文字。後方互換維持）
- `finish()`：`TREASURE_SVGS[s.treasure.scene]` があればそれを表示して pop。
  **2状態（`.tr-a`→`.tr-b` クロスフェード）は、SVG内に `.tr-b` グループが存在する場合のみ**
  巻物と同じ手順（600ms後にクロスフェード）を汎用実行する。`.tr-b` が無い宝は pop のみ。
  巻物の既存クラス `sc-closed`/`sc-open` は `tr-a`/`tr-b` に**リネームして統一**する。

### 2.2 算数ステージのフレーバー（subFlavor）

算数の問題文は式そのもの（`3 ＋ 4 ＝ ？`）なので、漢字のようにtextへ前置できない。
代わりに **`STAGES[i].subFlavor`** を新設し、`renderQ()` の `#qSub`（現状は
「すうじを おして OK！」固定）を差し替える：

```js
$('#qSub').textContent = s.subFlavor || (q.input ? 'すうじを おして OK！' : 'こたえを えらんでね');
```
（`s` は現在ステージ。subFlavor未定義なら従来文言＝後方互換）

### 2.3 genOpp のプロンプト対応

`makeKanjiGen` と同様に `genOpp(prompt)` → クロージャ化 `makeOppGen(prompt)` に変更し、
「ことばの はし」でフレーバー文を使えるようにする。既存の `genOpp` 呼び出し箇所
（hashi と tou のミックス）は `makeOppGen()` に置換。プロンプト未指定時は既存文言。

---

## 3. Phase A：みずべエリア

### 3.0 エリア共通パレット

| 役割 | HEX | 用途 |
|---|---|---|
| Leaf Light | `#7FB069` | 葉・草の明部 |
| Leaf Shadow | `#4E7E3F` | 葉・草の暗部 |
| Water Light | `#7EC8DE` | 水面の明部 |
| Water Deep | `#3E8FAD` | 水の暗部 |
| Sand Warm | `#EEDFB0` | 砂浜・小道 |
| Trunk | `#8A6543` | 幹・木材 |
| Sky Fresh | `#E4F0DC` | このエリアの空 |
| Ink Line | `#3D3323` | 輪郭線（全ステージ共通） |

カード用テーマ（3ステージで共有＋アクセントのみ個別）：
`--card-bg: #ECF2E0`（本文ink `#4A3B28` とのコントラスト概算 8.5:1 前後、実装時に実測）

### 3.1 すうじの もり（id: mori / theme: mori / scene: mori）

**シーン構図**：手前に2本の木（幹＋2階調のこんもり樹冠）、木々の間の奥に光る木漏れ日
（＝`bd-arch`）、足元にどんぐりときのこ。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#E4F0DC"/>
  <rect x="0" y="92" width="120" height="28" fill="#9DBB7E"/>
  <ellipse class="bd-arch" cx="60" cy="70" rx="14" ry="20" fill="#F5C56B" opacity="0"/>
  <path d="M24 92 L30 52 L36 92 Z" fill="#8A6543" stroke="#3D3323" stroke-width="2"/>
  <ellipse cx="30" cy="42" rx="22" ry="18" fill="#7FB069" stroke="#3D3323" stroke-width="2"/>
  <path d="M14 46 A22 18 0 0 0 30 60 L30 24 A22 18 0 0 0 14 46Z" fill="#4E7E3F"/>
  <path d="M84 92 L90 46 L96 92 Z" fill="#8A6543" stroke="#3D3323" stroke-width="2"/>
  <ellipse cx="90" cy="36" rx="24" ry="20" fill="#7FB069" stroke="#3D3323" stroke-width="2"/>
  <path d="M72 40 A24 20 0 0 0 90 56 L90 16 A24 20 0 0 0 72 40Z" fill="#4E7E3F"/>
  <ellipse cx="48" cy="100" rx="5" ry="6" fill="#B07B4A" stroke="#3D3323" stroke-width="1.5"/>
  <path d="M43 97 Q48 92 53 97" fill="#8A6543" stroke="#3D3323" stroke-width="1.5"/>
  <ellipse cx="70" cy="102" rx="6" ry="4" fill="#D96A52" stroke="#3D3323" stroke-width="1.5"/>
  <rect x="68" y="102" width="4" height="6" fill="#F1E6C8" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```

**宝物**：もりの どんぐり（scene: acorn、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <ellipse cx="50" cy="48" rx="16" ry="20" fill="#B07B4A" stroke="#3D3323" stroke-width="2"/>
  <path d="M38 44 A16 20 0 0 0 50 68 L50 28 A16 20 0 0 0 38 44Z" fill="#8A5A32"/>
  <path d="M32 34 Q50 22 68 34 Q60 40 50 40 Q40 40 32 34Z" fill="#6E4A28" stroke="#3D3323" stroke-width="2"/>
  <rect x="47" y="16" width="6" height="10" rx="3" fill="#6E4A28" stroke="#3D3323" stroke-width="2"/>
  <path d="M44 50 Q47 54 44 58" fill="none" stroke="#F5C56B" stroke-width="2" stroke-linecap="round"/>
</svg>
```

**文言**：
- intro：「ようこそ、まなびの しまへ！この もりでは かずの おおきさが わかると みちが ひらけるんだ」
- subFlavor：「どっちの きのみが おおい かな？」
- memo：「もりの どうぶつたちの だいこうぶつ。ぴかぴかに みがいて ある」

### 3.2 たしざんの はま（id: hama / theme: hama / scene: hama）

**シーン構図**：上1/3が空、中央が海（波線2本）、下が砂浜。左にヤシの木、砂浜に貝殻、
海面のきらめきが `bd-arch`。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#E4F0DC"/>
  <rect x="0" y="42" width="120" height="40" fill="#7EC8DE"/>
  <path d="M0 50 Q15 46 30 50 T60 50 T90 50 T120 50" fill="none" stroke="#FFFDF7" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M0 66 Q15 62 30 66 T60 66 T90 66 T120 66" fill="none" stroke="#3E8FAD" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M0 82 Q30 76 60 82 T120 82 L120 120 L0 120 Z" fill="#EEDFB0"/>
  <ellipse class="bd-arch" cx="82" cy="54" rx="14" ry="8" fill="#F5C56B" opacity="0"/>
  <path d="M26 88 C24 66,28 52,24 40" fill="none" stroke="#8A6543" stroke-width="5" stroke-linecap="round"/>
  <g stroke="#3D3323" stroke-width="1.5">
    <path d="M24 40 Q10 34 6 42 Q16 44 24 40" fill="#7FB069"/>
    <path d="M24 40 Q38 34 42 42 Q32 44 24 40" fill="#7FB069"/>
    <path d="M24 40 Q14 26 20 22 Q26 32 24 40" fill="#4E7E3F"/>
    <path d="M24 40 Q34 26 28 22 Q22 32 24 40" fill="#4E7E3F"/>
  </g>
  <path d="M64 100 L76 100 Q70 88 64 100Z" fill="#F2C4B0" stroke="#3D3323" stroke-width="1.5"/>
  <path d="M66 98 L70 92 M70 98 L72 93" stroke="#C9622E" stroke-width="1"/>
</svg>
```

**宝物**：ひかる かいがら（scene: shell、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <path d="M50 66 L26 40 Q26 18 50 18 Q74 18 74 40 Z" fill="#F2C4B0" stroke="#3D3323" stroke-width="2"/>
  <path d="M50 66 L26 40 Q26 18 50 18 Z" fill="#E09A80"/>
  <g stroke="#3D3323" stroke-width="1.5">
    <path d="M50 66 L38 30" fill="none"/><path d="M50 66 L50 24" fill="none"/><path d="M50 66 L62 30" fill="none"/>
  </g>
  <circle cx="60" cy="34" r="4" fill="#F5C56B" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```

**文言**：
- intro：「なみの おとが きこえる はまべだ。かいがらを あつめるには、たしざんの ちからが いるみたい」
- subFlavor：「かいがらを あわせると いくつ？」
- memo：「みみに あてると うみの おとが きこえる…きが する」

### 3.3 ひきざんの かわ（id: kawa / theme: kawa / scene: kawa）

**シーン構図**：縦に流れる川（2階調＋流れ線）、両岸に草地、川の中に飛び石3つ、
川面に金の魚影のきらめき（＝`bd-arch`）。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#9DBB7E"/>
  <path d="M42 0 Q36 30 46 60 Q56 90 44 120 L78 120 Q88 88 78 58 Q70 28 76 0 Z" fill="#7EC8DE" stroke="#3D3323" stroke-width="2"/>
  <path d="M54 8 Q50 34 58 62 Q64 86 56 112" fill="none" stroke="#3E8FAD" stroke-width="3" stroke-linecap="round"/>
  <ellipse class="bd-arch" cx="62" cy="58" rx="10" ry="7" fill="#F5C56B" opacity="0"/>
  <g stroke="#3D3323" stroke-width="2">
    <ellipse cx="52" cy="30" rx="9" ry="6" fill="#A89A80"/>
    <ellipse cx="64" cy="62" rx="9" ry="6" fill="#A89A80"/>
    <ellipse cx="54" cy="94" rx="9" ry="6" fill="#A89A80"/>
  </g>
  <path d="M8 20 Q14 12 20 20 M92 40 Q98 32 104 40 M12 78 Q18 70 24 78" fill="none" stroke="#4E7E3F" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="18" cy="46" r="4" fill="#7FB069" stroke="#3D3323" stroke-width="1.5"/>
  <circle cx="100" cy="86" r="4" fill="#7FB069" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```

**宝物**：きんの さかな（scene: goldfish、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <ellipse cx="46" cy="40" rx="22" ry="13" fill="#F5C56B" stroke="#3D3323" stroke-width="2"/>
  <path d="M46 27 A22 13 0 0 0 24 40 A22 13 0 0 0 46 53 Z" fill="#D4A63C"/>
  <path d="M66 40 L84 28 L80 40 L84 52 Z" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/>
  <path d="M42 27 Q46 18 54 20 Q50 26 48 28Z" fill="#D4A63C" stroke="#3D3323" stroke-width="1.5"/>
  <circle cx="34" cy="37" r="2.5" fill="#3D3323"/>
  <path d="M50 36 Q54 40 50 44 M57 35 Q61 40 57 45" fill="none" stroke="#C9622E" stroke-width="1.5"/>
</svg>
```

**文言**：
- intro：「この かわには きんいろの さかなが すんでいる らしい。ひきざんで みずの ながれを よもう！」
- subFlavor：「さかなは なんびき のこる かな？」
- memo：「つかまえても すぐ にがして あげた。また あえる かな」

### 3.4 Phase A のテーマCSS

```css
#scr-quiz[data-stage-theme="mori"],
#scr-quiz[data-stage-theme="hama"],
#scr-quiz[data-stage-theme="kawa"]{ --card-bg:#ECF2E0; --card-frame:#4E7E3F; }
```
- カードのコーナー装飾（qcorner）：みずべ用に**木のコーナー**を新設
  （data-URIのSVG差し替え。テーマ属性でbackground-imageを上書き）：
```svg
<svg viewBox="0 0 40 40">
  <path d="M4 36 L4 12 Q4 4 12 4 L36 4 L36 12 L14 12 Q12 12 12 14 L12 36 Z"
        fill="#8A6543" stroke="#3D3323" stroke-width="2"/>
  <circle cx="12" cy="12" r="4" fill="#7FB069" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```
- サイドシルエット（qmoss相当）：葉のシルエット（Leaf Shadow単色、opacity 0.10〜0.20で調整、
  可読性を損なうなら削除可。判断は実装者委任）。

---

## 4. Phase B：ちていエリア

### 4.0 エリア共通パレット

| 役割 | HEX | 用途 |
|---|---|---|
| Cave Wall | `#5A5478` | 洞窟壁の明部 |
| Cave Deep | `#3A3654` | 洞窟壁の暗部・闇 |
| Crystal Light | `#8FD0E8` | 鉱石の明部 |
| Crystal Deep | `#4A93B8` | 鉱石の暗部 |
| Magma | `#E86A3D` | 溶岩・熱の光 |
| Magma Core | `#F5A55B` | 溶岩の明部 |
| Bone | `#EFE6D0` | 化石・骨 |
| Ink Line | `#3D3323` | 輪郭線 |

カード用テーマ：`--card-bg:#E6E4EE; --card-frame:#5A5478;`
（暗色パレットのエリアだが、**カード背景は可読性優先で明るく保つ**。雰囲気はフレーム・
コーナー・シーンで出す。本文inkとのコントラストは実装時実測、4.5:1未満なら `#ECEAF2` へ）

### 4.1 くりあがりの どうくつ（id: douk / theme: douk / scene: douk）

**シーン構図**：洞窟の断面。上から垂れる鍾乳石2本、左右の壁、中央に大きな青い鉱石の
クラスタ（明暗2面）、鉱石の光が `bd-arch`。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#3A3654"/>
  <path d="M0 0 L120 0 L120 26 Q90 34 60 26 Q30 20 0 30 Z" fill="#5A5478" stroke="#3D3323" stroke-width="2"/>
  <path d="M34 26 L40 48 L46 26 Z" fill="#5A5478" stroke="#3D3323" stroke-width="2"/>
  <path d="M74 24 L79 40 L84 24 Z" fill="#5A5478" stroke="#3D3323" stroke-width="2"/>
  <path d="M0 120 L0 84 Q22 92 30 120 Z" fill="#5A5478" stroke="#3D3323" stroke-width="2"/>
  <path d="M120 120 L120 80 Q98 90 92 120 Z" fill="#5A5478" stroke="#3D3323" stroke-width="2"/>
  <ellipse class="bd-arch" cx="60" cy="78" rx="18" ry="14" fill="#8FD0E8" opacity="0"/>
  <g stroke="#3D3323" stroke-width="2">
    <path d="M50 108 L54 70 L62 62 L66 108 Z" fill="#8FD0E8"/>
    <path d="M62 62 L66 108 L58 108 Z" fill="#4A93B8"/>
    <path d="M40 108 L44 84 L50 80 L52 108 Z" fill="#4A93B8"/>
    <path d="M68 108 L72 82 L78 86 L78 108 Z" fill="#8FD0E8"/>
  </g>
  <circle cx="24" cy="56" r="2" fill="#8FD0E8"/><circle cx="96" cy="50" r="2" fill="#8FD0E8"/>
</svg>
```

**宝物**：あおい ほうせき（scene: bluegem、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <path d="M50 12 L72 30 L50 68 L28 30 Z" fill="#8FD0E8" stroke="#3D3323" stroke-width="2"/>
  <path d="M50 12 L28 30 L50 68 Z" fill="#4A93B8"/>
  <path d="M38 30 L62 30 L50 12 Z" fill="#BCE4F2" stroke="#3D3323" stroke-width="1"/>
  <path d="M20 20 L24 24 M80 20 L76 24 M50 74 L50 78" stroke="#F5C56B" stroke-width="2" stroke-linecap="round"/>
</svg>
```

**文言**：
- intro：「くらい どうくつに はいるよ。10の かたまりを つくれば、あおい ほうせきが ひかりだすんだ！」
- subFlavor：「10の かたまりを つくって かんがえよう」
- memo：「くらい ところで そっと ひかる。よるの おともに ぴったり」

### 4.2 くりさがりの たに（id: tani / theme: tani / scene: tani）

**シーン構図**：V字の谷（両壁2階調）、谷底にマグマ帯（＝`bd-arch`はマグマの光だまり）、
壁面に埋まった恐竜の骨（肋骨のカーブ）。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#5A5478"/>
  <path d="M0 0 L46 0 L60 96 L74 0 L120 0 L120 120 L0 120 Z" fill="#3A3654" stroke="#3D3323" stroke-width="2"/>
  <path d="M46 0 L60 96 L52 96 L38 0 Z" fill="#4A4566"/>
  <path d="M48 120 L60 96 L72 120 Z" fill="#E86A3D" stroke="#3D3323" stroke-width="2"/>
  <ellipse class="bd-arch" cx="60" cy="106" rx="14" ry="8" fill="#F5A55B" opacity="0"/>
  <g stroke="#3D3323" stroke-width="1.5">
    <path d="M14 44 Q22 38 30 44" fill="none" stroke="#EFE6D0" stroke-width="3"/>
    <path d="M16 52 Q23 46 30 52" fill="none" stroke="#EFE6D0" stroke-width="3"/>
    <path d="M18 60 Q24 54 30 60" fill="none" stroke="#EFE6D0" stroke-width="3"/>
    <circle cx="12" cy="38" r="4" fill="#EFE6D0"/>
  </g>
  <circle cx="96" cy="70" r="3" fill="#E86A3D"/><circle cx="88" cy="84" r="2" fill="#F5A55B"/>
</svg>
```

**宝物**：きょうりゅうの ほね（scene: dinobone、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <path d="M24 54 Q50 30 76 54" fill="none" stroke="#EFE6D0" stroke-width="7" stroke-linecap="round"/>
  <path d="M30 60 Q50 42 70 60" fill="none" stroke="#EFE6D0" stroke-width="6" stroke-linecap="round"/>
  <path d="M24 54 Q50 30 76 54" fill="none" stroke="#3D3323" stroke-width="9" stroke-linecap="round" opacity="0.25"/>
  <circle cx="20" cy="48" r="7" fill="#EFE6D0" stroke="#3D3323" stroke-width="2"/>
  <circle cx="80" cy="48" r="7" fill="#EFE6D0" stroke="#3D3323" stroke-width="2"/>
</svg>
```

**文言**：
- intro：「ふかい たにの そこには、おおむかしの きょうりゅうが ねむって いるんだって。ひきざんで がけを おりよう！」
- subFlavor：「10から かりてくると できるよ」
- memo：「はるか むかしの いきものの ほね。さわると ちょっと つめたい」

### 4.3 Phase B のテーマCSS・装飾

```css
#scr-quiz[data-stage-theme="douk"],
#scr-quiz[data-stage-theme="tani"]{ --card-bg:#E6E4EE; --card-frame:#5A5478; }
```
- コーナー装飾：**鉱石コーナー**（岩角＋クリスタル粒）
```svg
<svg viewBox="0 0 40 40">
  <path d="M4 36 L4 12 Q4 4 12 4 L36 4 L36 12 L14 12 Q12 12 12 14 L12 36 Z"
        fill="#5A5478" stroke="#3D3323" stroke-width="2"/>
  <path d="M9 9 L12 6 L15 9 L12 15 Z" fill="#8FD0E8" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```
- サイドシルエット：鍾乳石のシルエット（Cave Deep、opacity 0.10〜0.20、削除可）。

---

## 5. Phase C：ことばエリア

### 5.0 エリア共通パレット

パイロット（かんじの いせき）の遺跡パレットを**そのまま流用**する：
Stone Light `#A89A80` / Stone Shadow `#6B5D48` / Relic Gold `#D4A63C` / Mystic Glow `#8E7BC4` /
Ruin Sky `#E9DFC4` / Moss `#7A9B5C`,`#4E6E3B` / Ink Line `#3D3323`。
追加は虹色アクセントのみ：Rainbow R `#E8705A` / Y `#F2C14E` / B `#5B9FC4`。

カード用テーマ：**パイロットの iseki テーマをそのまま共有**
（`--card-bg:#EFE7D2; --card-frame:#D4A63C;`）。コーナー装飾も石×金を共用。

```css
#scr-quiz[data-stage-theme="hashi"],
#scr-quiz[data-stage-theme="iseki2"]{ --card-bg:#EFE7D2; --card-frame:#D4A63C; }
```
（実装メモ：セレクタを iseki と並記して1ブロックに統合してよい）

### 5.1 ことばの はし（id: hashi / theme: hashi / scene: hashi）

**シーン構図**：谷にかかる吊り橋（板＋ロープ）、上空に虹のアーチ（3色帯）、
橋の中央のきらめきが `bd-arch`。羽根が1枚舞っている。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#E9DFC4"/>
  <path d="M0 120 L0 66 Q16 60 24 66 L24 120 Z" fill="#A89A80" stroke="#3D3323" stroke-width="2"/>
  <path d="M120 120 L120 66 Q104 60 96 66 L96 120 Z" fill="#A89A80" stroke="#3D3323" stroke-width="2"/>
  <path d="M10 26 A50 50 0 0 1 110 26" fill="none" stroke="#E8705A" stroke-width="6"/>
  <path d="M16 32 A44 44 0 0 1 104 32" fill="none" stroke="#F2C14E" stroke-width="6"/>
  <path d="M22 38 A38 38 0 0 1 98 38" fill="none" stroke="#5B9FC4" stroke-width="6"/>
  <path d="M24 70 Q60 84 96 70" fill="none" stroke="#8A6543" stroke-width="3"/>
  <g fill="#B07B4A" stroke="#3D3323" stroke-width="1.5">
    <rect x="30" y="72" width="10" height="6" rx="1" transform="rotate(6 35 75)"/>
    <rect x="44" y="76" width="10" height="6" rx="1" transform="rotate(3 49 79)"/>
    <rect x="58" y="77" width="10" height="6" rx="1"/>
    <rect x="72" y="75" width="10" height="6" rx="1" transform="rotate(-4 77 78)"/>
    <rect x="84" y="72" width="10" height="6" rx="1" transform="rotate(-7 89 75)"/>
  </g>
  <path d="M24 66 Q60 78 96 66" fill="none" stroke="#6E4A28" stroke-width="2"/>
  <ellipse class="bd-arch" cx="60" cy="76" rx="14" ry="8" fill="#F5C56B" opacity="0"/>
  <path d="M70 46 Q78 42 80 34 Q72 36 70 46Z" fill="#8E7BC4" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```

**宝物**：にじの はね（scene: rainbowfeather、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <path d="M30 66 Q34 30 66 14 Q64 42 40 62 Z" fill="#F2C14E" stroke="#3D3323" stroke-width="2"/>
  <path d="M30 66 Q34 30 66 14 Q52 26 42 48 Z" fill="#E8705A"/>
  <path d="M40 62 Q52 44 62 22" fill="none" stroke="#5B9FC4" stroke-width="2.5"/>
  <path d="M30 66 Q34 58 40 52" fill="none" stroke="#3D3323" stroke-width="2" stroke-linecap="round"/>
</svg>
```

**文言**：
- intro：「ことばと ことばを つなぐ はしだよ。「はんたいの ことば」が わかれば、わたって いけるさ！」
- （genOppのプロンプト）：「この ことばの はんたいがわに あるのは？」
- memo：「にじの いろが きらきら かわる ふしぎな はね」

### 5.2 かんじの しんでん（id: iseki2 / theme: iseki2 / scene: shinden）

**シーン構図**：遺跡の発展形＝神殿。三角屋根（ペディメント）＋柱3本＋黄金の扉
（＝`bd-arch`は扉の光）。パイロットの遺跡より「格上」に見える構成。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#E9DFC4"/>
  <rect x="0" y="92" width="120" height="28" fill="#C7B78E"/>
  <path d="M14 44 L60 18 L106 44 L102 52 L18 52 Z" fill="#A89A80" stroke="#3D3323" stroke-width="2"/>
  <path d="M60 18 L106 44 L102 52 L60 26 Z" fill="#6B5D48"/>
  <circle cx="60" cy="38" r="6" fill="#D4A63C" stroke="#3D3323" stroke-width="1.5"/>
  <g stroke="#3D3323" stroke-width="2">
    <path d="M22 52 L30 52 L31 92 L21 92 Z" fill="#A89A80"/>
    <path d="M55 52 L65 52 L66 92 L54 92 Z" fill="#A89A80"/>
    <path d="M90 52 L98 52 L99 92 L89 92 Z" fill="#A89A80"/>
  </g>
  <path d="M28 52 L30 52 L31 92 L29 92 Z" fill="#6B5D48"/>
  <path d="M63 52 L65 52 L66 92 L64 92 Z" fill="#6B5D48"/>
  <path d="M96 52 L98 52 L99 92 L97 92 Z" fill="#6B5D48"/>
  <rect x="72" y="64" width="14" height="28" rx="7" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/>
  <ellipse class="bd-arch" cx="79" cy="78" rx="7" ry="12" fill="#F5C56B" opacity="0"/>
  <path d="M12 92 C16 78,10 70,18 60" fill="none" stroke="#4E6E3B" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="15" cy="74" r="3.5" fill="#7A9B5C"/>
</svg>
```

**宝物**：こがねの かぎ（scene: goldkey、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <circle cx="34" cy="40" r="14" fill="none" stroke="#D4A63C" stroke-width="7"/>
  <circle cx="34" cy="40" r="14" fill="none" stroke="#3D3323" stroke-width="10" opacity="0.25"/>
  <path d="M48 40 L82 40" stroke="#D4A63C" stroke-width="7" stroke-linecap="round"/>
  <path d="M70 40 L70 52 M80 40 L80 50" stroke="#D4A63C" stroke-width="6" stroke-linecap="round"/>
  <circle cx="34" cy="40" r="4" fill="#F5C56B"/>
</svg>
```

**文言**：
- intro：「いせきの おくに あった、かんじの しんでんだ！むずかしい もじも あるけど、きみなら よめるはず」
- （makeKanjiGenのプロンプト）：「しんでんの とびらに かかれた もじは？」
- memo：「しんでんの どこかの とびらを あける かぎ。どの とびら だろう？」

---

## 6. Phase D：さんちょうエリア

### 6.0 エリア共通パレット

| 役割 | HEX | 用途 |
|---|---|---|
| Slate Light | `#8C99A6` | 山肌の明部 |
| Slate Deep | `#5C6873` | 山肌の暗部 |
| Snow | `#F7F4EC` | 冠雪・雲 |
| Flame | `#E8763D` | 炎の玉 |
| Flame Core | `#F5C56B` | 炎の中心 |
| Royal Blue | `#4A6FA8` | 城の屋根・旗 |
| Castle Cream | `#E8DCC0` | 城壁の明部 |
| Castle Shadow | `#B8A98A` | 城壁の暗部 |
| Night | `#333354` | 夜空（さいごのとう） |
| Star Gold | `#F2C14E` | 星・月 |
| Ink Line | `#3D3323` | 輪郭線 |

### 6.1 九九の やま（id: yama / theme: yama / scene: yama）

**シーン構図**：2階調の山＋冠雪、山頂に炎の玉（＝`bd-arch`）、空に雲2つ。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#DCE8F0"/>
  <path d="M8 104 L60 26 L112 104 Z" fill="#8C99A6" stroke="#3D3323" stroke-width="2"/>
  <path d="M60 26 L112 104 L60 104 Z" fill="#5C6873"/>
  <path d="M46 47 L60 26 L74 47 L66 42 L60 50 L52 42 Z" fill="#F7F4EC" stroke="#3D3323" stroke-width="2"/>
  <circle class="bd-arch" cx="60" cy="18" r="9" fill="#E8763D" opacity="0"/>
  <path d="M60 8 Q54 16 60 24 Q66 16 60 8Z" fill="#E8763D" stroke="#3D3323" stroke-width="1.5"/>
  <circle cx="60" cy="19" r="3" fill="#F5C56B"/>
  <g fill="#F7F4EC" stroke="#3D3323" stroke-width="1.5">
    <ellipse cx="24" cy="36" rx="12" ry="6"/>
    <ellipse cx="98" cy="52" rx="10" ry="5"/>
  </g>
  <rect x="0" y="104" width="120" height="16" fill="#9DBB7E"/>
</svg>
```

**宝物**：ほのおの たま（scene: flameorb、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <path d="M50 8 Q34 28 40 44 Q44 54 50 54 Q56 54 60 44 Q66 28 50 8Z" fill="#E8763D" stroke="#3D3323" stroke-width="2"/>
  <path d="M50 22 Q44 34 48 44 Q50 48 52 44 Q56 34 50 22Z" fill="#F5C56B"/>
  <circle cx="50" cy="60" r="10" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/>
  <circle cx="47" cy="57" r="3" fill="#F5C56B"/>
</svg>
```

**文言**：
- intro：「たかい やまの ちょうじょうには「ほのおの たま」が ある。九九を となえて のぼって いこう！」
- subFlavor：「九九を こえに だして いって みよう」
- memo：「もっていると からだが ぽかぽか する。ふゆに べんり」

### 6.2 けいさんの しろ（id: shiro / theme: shiro / scene: shiro）

**シーン構図**：中央に城門（＝`bd-arch`は門の光）、左右に塔＋青い三角屋根、旗。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#DCE8F0"/>
  <rect x="0" y="96" width="120" height="24" fill="#9DBB7E"/>
  <g stroke="#3D3323" stroke-width="2">
    <rect x="18" y="42" width="20" height="54" fill="#E8DCC0"/>
    <rect x="82" y="42" width="20" height="54" fill="#E8DCC0"/>
    <rect x="34" y="56" width="52" height="40" fill="#E8DCC0"/>
  </g>
  <rect x="34" y="56" width="6" height="40" fill="#B8A98A"/>
  <rect x="18" y="42" width="5" height="54" fill="#B8A98A"/>
  <rect x="82" y="42" width="5" height="54" fill="#B8A98A"/>
  <path d="M14 42 L28 24 L42 42 Z" fill="#4A6FA8" stroke="#3D3323" stroke-width="2"/>
  <path d="M78 42 L92 24 L106 42 Z" fill="#4A6FA8" stroke="#3D3323" stroke-width="2"/>
  <path d="M28 24 L28 12 L40 16 L28 20" fill="#E8763D" stroke="#3D3323" stroke-width="1.5"/>
  <path d="M52 96 L52 74 Q60 64 68 74 L68 96 Z" fill="#3D3323"/>
  <ellipse class="bd-arch" cx="60" cy="84" rx="6" ry="10" fill="#F5C56B" opacity="0"/>
  <path d="M40 60 h6 M52 60 h6 M64 60 h6 M76 60 h6" stroke="#B8A98A" stroke-width="3"/>
</svg>
```

**宝物**：おうさまの かんむり（scene: crown、1状態＋pop）
```svg
<svg viewBox="0 0 100 80">
  <path d="M26 58 L22 26 L38 42 L50 20 L62 42 L78 26 L74 58 Z" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/>
  <path d="M26 58 L22 26 L38 42 L44 32 L44 58 Z" fill="#B8892E"/>
  <rect x="24" y="56" width="52" height="9" rx="4" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/>
  <circle cx="50" cy="47" r="5" fill="#E8705A" stroke="#3D3323" stroke-width="1.5"/>
  <circle cx="34" cy="50" r="3" fill="#5B9FC4" stroke="#3D3323" stroke-width="1.5"/>
  <circle cx="66" cy="50" r="3" fill="#5B9FC4" stroke="#3D3323" stroke-width="1.5"/>
</svg>
```

**文言**：
- intro：「りっぱな おしろに とうちゃく！おおきな かずの けいさんが できたら、おうさまが むかえて くれるよ」
- subFlavor：「くらいごとに じゅんばんに けいさん しよう」
- memo：「かぶると ちょっとだけ おうさまの きぶん。にあってる？」

### 6.3 さいごの とう（id: tou / theme: tou / scene: tou）— ボスステージ特別仕様

**シーン構図**：夜空（Night）＋星＋三日月、そびえる塔（2階調）、頂上の光（＝`bd-arch`、
Mystic Glow）。他ステージと違い**背景が夜**なのが特別感の核。

```svg
<svg viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#333354"/>
  <g fill="#F2C14E">
    <circle cx="20" cy="20" r="2"/><circle cx="100" cy="14" r="1.6"/><circle cx="88" cy="38" r="2"/>
    <circle cx="14" cy="56" r="1.6"/><circle cx="106" cy="66" r="1.6"/>
  </g>
  <path d="M96 20 A10 10 0 1 0 96 38 A8 8 0 1 1 96 20Z" fill="#F2C14E" stroke="#3D3323" stroke-width="1.5"/>
  <g stroke="#3D3323" stroke-width="2">
    <path d="M46 108 L50 34 L70 34 L74 108 Z" fill="#5A5478"/>
    <path d="M62 34 L70 34 L74 108 L66 108 Z" fill="#3A3654"/>
    <path d="M44 34 L60 16 L76 34 Z" fill="#8E7BC4"/>
  </g>
  <circle class="bd-arch" cx="60" cy="24" r="8" fill="#8E7BC4" opacity="0"/>
  <rect x="55" y="62" width="10" height="14" rx="5" fill="#F2C14E" stroke="#3D3323" stroke-width="1.5"/>
  <rect x="0" y="108" width="120" height="12" fill="#2A2A44"/>
</svg>
```

**宝物**：でんせつの トロフィー（scene: trophy、**2状態**：`tr-a`（すすけた姿）→
`tr-b`（黄金に輝く姿）のクロスフェード。§2.1の汎用2状態機構を使用）

```svg
<svg viewBox="0 0 100 80">
  <g class="tr-a">
    <path d="M34 16 L66 16 L62 44 Q50 52 38 44 Z" fill="#8C8272" stroke="#3D3323" stroke-width="2"/>
    <rect x="44" y="50" width="12" height="10" fill="#8C8272" stroke="#3D3323" stroke-width="2"/>
    <rect x="36" y="60" width="28" height="8" rx="3" fill="#6B6456" stroke="#3D3323" stroke-width="2"/>
  </g>
  <g class="tr-b" style="display:none;opacity:0">
    <path d="M34 16 L66 16 L62 44 Q50 52 38 44 Z" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/>
    <path d="M34 16 L38 44 Q44 48 50 49 L50 16 Z" fill="#B8892E"/>
    <path d="M34 22 Q22 24 26 34 Q30 40 38 38 M66 22 Q78 24 74 34 Q70 40 62 38" fill="none" stroke="#D4A63C" stroke-width="4"/>
    <rect x="44" y="50" width="12" height="10" fill="#D4A63C" stroke="#3D3323" stroke-width="2"/>
    <rect x="36" y="60" width="28" height="8" rx="3" fill="#B8892E" stroke="#3D3323" stroke-width="2"/>
    <path d="M50 6 l2 4 4 .6 -3 3 .8 4.4 -3.8 -2 -3.8 2 .8 -4.4 -3 -3 4 -.6z" fill="#F2C14E"/>
  </g>
</svg>
```

**ボス特別演出（このステージのみ追加）**：
1. **クイズ画面のカードフレームを Mystic Glow×Night に**：
   `#scr-quiz[data-stage-theme="tou"]{ --card-bg:#EFEBF5; --card-frame:#8E7BC4; }`
2. **クリア時の花火**：結果画面表示時、`resCard` 上でパーティクル（§4.5の仕組みを流用、
   span数を10に増やしたボス専用 `.particles.boss` を `#resCard` 内に設置。色は
   Star Gold / Mystic Glow / Flame を巡回、`--dx` は左右±60pxまで拡大）を1回発火。
   発火条件：`s.id === 'tou' && cleared`。
3. **称号表示**：`resTitle` を「さいごの とう クリア！」ではなく
   「🎉 でんせつの たんけんか に なった！」に差し替え（このステージのみ）。
   実装：`STAGES[i].clearTitle` フィールド新設、finish()で `s.clearTitle || (s.name + ' クリア！')`。
- intro：「ついに さいごの とうに きたね。いままでの ちからを ぜんぶ つかって、てっぺんを めざそう！」
- subFlavor：（ミックス出題のため設定しない＝デフォルト文言）
- memo：「でんせつの たんけんかの あかし。きみの なまえが きざまれて いる」

---

## 7. マップ背景の改修（Phase Aと同時に実施）

### 7.1 現状の問題

`#scr-map` の背景が `--ocean` 単色、島が `#island`（ベタ塗り角丸blob）のみ。
ノードを差し替えても土台が安っぽいままだと効果が半減する。

### 7.2 改修内容

1. **海に波模様**：`#scr-map` の背景に、CSSの `repeating-linear-gradient` ではなく
   **SVG data-URIの波タイル**（白い波線、opacity 0.25）を `background-image` で敷く。
   ベース色は既存 `--ocean` を維持。
```svg
<svg viewBox="0 0 80 40"><path d="M0 20 Q10 14 20 20 T40 20 T60 20 T80 20"
 fill="none" stroke="#FFFDF7" stroke-width="2.5" opacity="0.25" stroke-linecap="round"/></svg>
```
   `background-size: 80px 40px; background-repeat: repeat;`
2. **島の輪郭を有機的に**：`#island` の `border-radius` を廃止し、SVGの `clip-path` は
   使わず（iOS Safariの互換リスク回避）、**island内の最上部に「砂浜の縁取り」を追加**：
   既存の `border:6px solid #E8D9AE` を 8px に太らせ、さらに `box-shadow: 0 0 0 4px
   rgba(255,253,247,.5)` で波打ち際の白泡を表現（実装コスト最小の近似）。
3. **エリアの雰囲気分け**：`#island` の内部に、各エリア帯の薄い色面を絶対配置の
   `<div class="zone">` ×4で敷く（みずべ=Leaf系 / ちてい=Cave系 / ことば=Stone系 /
   さんちょう=Slate系。いずれも opacity 0.12〜0.18、境界は `border-radius` で丸く曖昧に）。
   帯のY座標は STEP=132 とノード配置から算出：
   ゾーン1（ノード1〜3）: top 0〜28% / ゾーン2（4〜5）: 28〜46% /
   ゾーン3（6〜8）: 46〜73% / ゾーン4（9〜11）: 73〜100%。
   ※`renderMap()` はノードを動的生成しているため、zone divは `#island` 内に静的配置でよい。
4. **点線の道はそのまま**（機能している）。色のみ `#D8C48E` → `#C9B482` に微調整し
   新背景とのなじみを取る。

---

## 8. 横断仕上げ（最終Phase＝Phase C完了後に実施）

1. **確認用ショートカットの削除**：init内の「前5ステージ自動クリア」ブロック
   （`/* 確認用ショートカット */` コメント付き）を**必ず削除**する。
2. **sw.js キャッシュ番号**：Phaseごとに +1（A: `bouken-v4` → D: `v5` → B: `v6` → C: `v7`）。
   確認配布のたびに上げるのが目的なので、Phase内で再配布する場合もその都度+1してよい。
3. **README更新**：全面リニューアル完了の節を追記。
4. **最終検証**：全11ステージについて jsdom通し（テーマ属性・シーン表示・宝演出・
   ずかんメモ）＋全テーマのコントラスト実測表＋全シーン/宝SVGのPNGコンタクトシート出力。

---

## 9. 完了の定義（各Phase共通）

1. 対象ステージのシーンSVGがマップに表示され、ロック/挑戦中/クリアの3状態が機能する
2. テーマCSS（カード配色・コーナー装飾）が適用され、**未対象ステージに影響しない**
3. intro / フレーバー（subFlavor またはプロンプト）/ 宝memo が反映されている
4. 宝SVGが結果画面で pop（2状態持ちはクロスフェード）し、ずかんに表示される
5. jsdom検証パス、コントラスト実測AA、シーン/宝SVGのPNG目視確認
6. sw.js キャッシュ番号更新済み
7. だいへの提出物：シーン/宝のPNGコンタクトシート＋確認用HTML（該当ステージ解放済み）

## 10. 実装順チェックリスト（全体）

- [ ] §2 仕組み拡張3点（レジストリ化・subFlavor・makeOppGen）
- [ ] §7 マップ背景改修
- [ ] Phase A：mori / hama / kawa（素材4点セット×3＋テーマCSS＋木コーナー）
- [ ] Phase D：yama / shiro / tou（同×3＋ボス特別演出3点）
- [ ] Phase B：douk / tani（同×2＋鉱石コーナー）
- [ ] Phase C：hashi / iseki2（同×2、テーマ/コーナーはisekiと共用）
- [ ] §8 横断仕上げ（ショートカット削除・sw.js・README・最終検証）
