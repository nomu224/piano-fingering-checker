# P6 実装計画: PWA 化 + スマホ縦持ちレイアウト + GitHub Pages デプロイ + Android 確認手順書

## 目的

仕様書 11 章 P6「Android 実機検証 + PWA 化 + HTTPS デプロイ」を実装する。
完了条件: **Android Chrome 単体で全機能が動く**。

## 仕様書の該当章

- 11 章 P6: PWA 化(vite-plugin-pwa)、スマホ縦持ちレイアウト調整(9 章)、HTTPS デプロイ(10 章)
- 3 章: 配信は HTTPS 必須(GitHub Pages 等)。カメラ・MIDI とも HTTPS でないと動かない
- 5 章: vite-plugin-pwa。**オフライン動作は必須ではない。ホーム画面追加ができれば十分**
- 9 章: スマホ縦持ちを基本レイアウト、PC 開発中も崩れないレスポンシブ。練習画面は視認性優先(大きな表示)
- 10 章: 手認識 PC 20fps / Android ミドルレンジ 10fps、判定遅延 200ms 以内、
  プライバシー(カメラ映像は端末外に送信しない・画面に明記)、権限拒否時のエラーと再試行

## P6 の前提・依存(開発者に確認が必要)

- **GitHub アカウントとリポジトリ**: GitHub Pages デプロイに必須。現状 git リモート未設定。
  → デプロイ実行前に「アカウントの有無」「リポジトリ名(base パスに使う)」を確認する
- **Android スマホ**: 実機検証に必須。iPhone は Web MIDI API 非対応のため対象外(仕様 2.2)。
  → 実機がない/iPhone の場合は、コード・デプロイまで完成させ、実機検証だけ保留にする

**この計画では「コードとデプロイ設定の完成」までを主目的とし、実際の push / Pages 有効化 / 実機確認は
上記情報が揃ってから行う**(コード側は情報が無くても完成できる)。

## P6 でやらないこと

- 実 MIDI デバイス(midiInput.ts)の実装。バーチャル MIDI で全機能が動く状態は維持されており、
  実キーボードの Bluetooth 接続確認は実機入手後(仕様のフェーズ表でも P6 の実機検証に含むが、キーボード未入手)
- 開発用タブ構成(P1〜P4)の正式画面フロー S-01〜S-06 への全面再構成。
  → ただしスマホで使えるよう、タブと各画面のレイアウトはレスポンシブ対応する(9 章の要求)

## 外部ライブラリの追加(要承認)

**vite-plugin-pwa を devDependency として追加**したい。
- 理由: 仕様書 5 章が明示指定しているライブラリ。manifest 生成と Service Worker 生成を担う
- **Vite 7 対応版を明示選定**(最新の 1.x 系。install 後に peer 警告が出ないことを確認)
- Service Worker のプリキャッシュは**アプリシェル(JS/CSS/HTML)のみ**とし、
  MediaPipe の WASM(約 34MB)とモデル(約 7.5MB)は precache から除外する
  (オフライン必須ではない=5 章。巨大ファイルの precache は初回インストールを重くするため、
  `globPatterns` で除外し、通常のネットワーク取得に任せる)
- アイコンは**追加依存を避けて SVG 1 枚**で用意(any/maskable 兼用。Android Chrome は SVG アイコン対応)。
  PNG 生成ツール(sharp 等)は入れない

## 実装内容

### 1. PWA 化(vite-plugin-pwa)

- `vite.config.ts` に VitePWA プラグインを追加:
  - `registerType: "autoUpdate"`
  - `manifest`: name「ピアノ運指チェッカー」/ short_name「運指チェッカー」/ 縦向き(`orientation: "portrait"`)/
    `display: "standalone"` / テーマ色 / SVG アイコン(any/maskable)。
    **`start_url` と `scope` は base 基準にする**(vite-plugin-pwa は base から自動導出するが、
    ビルド後の dist の manifest 実値で `/<repo>/` になっていることを確認する。サブパスで 404 にならないため)
  - `workbox.globPatterns`: js/css/html のみ。`**/*.{wasm,task}` は含めない(除外)
  - **`workbox.maximumFileSizeToCacheInBytes` は下げない**。MediaPipe を import するメイン JS チャンクが
    precache から漏れると「ホーム画面追加してもアプリシェルがキャッシュされない」= PWA の意味が半減するため、
    **メインバンドルが収まる値(例 4MB)に据え置き〜引き上げ**。ビルド後の precache manifest に主要 JS が
    含まれることを確認する(レビュー指摘: 高)
  - **`workbox.navigateFallbackDenylist`** で `mediapipe/` 配下・`.wasm`・`.task` を除外。
    SPA の navigateFallback(index.html)がモデル/WASM リクエストに index.html を返す事故を防ぐ(レビュー指摘)
- アイコン: `public/icons/icon.svg`(ピアノ+指のモチーフ、512 viewBox・セーフゾーン考慮で maskable 兼用)
- `index.html` に theme-color を追加(manifest とアイコンは vite-plugin-pwa が注入)

### 2. GitHub Pages 対応の base パス

- GitHub Pages はサブパス配信(`https://<user>.github.io/<repo>/`)になるため、`vite.config.ts` の
  `base` をリポジトリ名にする。ただしリポジトリ名確定前でも動くよう、
  **環境変数 `VITE_BASE`(未設定時は "/")で切り替え**、GitHub Actions が `/<repo>/` を渡す構成にする
- P2 で MediaPipe のパスを `import.meta.env.BASE_URL` 基準にしてあるので、base 設定に自動追従する
  (ここが崩れると本番でモデルが 404 になるため、ビルド後に生成物のパスを確認する)

### 3. スマホ縦持ちレイアウト(9 章)

- グローバル CSS(index.css)にレスポンシブ調整:
  - `#root` の max-width/padding をスマホで詰める。横スクロールが出ないように
  - タブバーを狭幅で折り返し/横スクロール可能に(4 タブが縦持ちで潰れないように)
- 練習画面(S-04):
  - カメラプレビューとバーチャル鍵盤が縦に並ぶ縦持ち前提のレイアウト。プレビューは横幅 100%
  - 「次に弾く音」の大表示は維持(9 章: 遠目でも分かる視認性優先)
  - バーチャル鍵盤の鍵盤幅・ボタンをタップしやすいサイズに(タッチターゲット確保)
- キャリブレーション・カメラ確認画面も横幅 100% で崩れないことを確認
- `index.html` の viewport は設定済み(`width=device-width, initial-scale=1.0`)。
  必要なら `user-scalable` の調整(鍵盤の誤ズーム防止に `touch-action` は設定済み)

### 4. GitHub Pages デプロイ設定(GitHub Actions)

- `.github/workflows/deploy.yml` を追加:
  - **発火は `branches: [main, master]` の両対応 + `workflow_dispatch`(手動実行)を併記**。
    ブランチ名不一致でワークフローが無言で発火しない事故を防ぐ(レビュー指摘)
  - Node セットアップ → `npm ci` → `VITE_BASE=/<repo>/ npm run build` → `actions/upload-pages-artifact` →
    `actions/deploy-pages`
  - `permissions: pages: write, id-token: write` を設定
- リポジトリの Settings → Pages で「GitHub Actions」をソースに設定する手順は確認手順書に記載
- `.nojekyll` 相当は Actions の Pages デプロイでは不要(artifact をそのまま配信するため)

### 5. Android Chrome 確認手順書

`docs/android-check.md` を新規作成:
- 前提: Android + Chrome、HTTPS URL(GitHub Pages)
- 手順: URL を開く → ホーム画面に追加(PWA)→ 起動 → カメラ権限許可 → キャリブレーション →
  バーチャル鍵盤で練習 → 結果画面 → JSON ダウンロード
- チェックリスト(仕様 10 章): 手認識 10fps 以上出るか / 権限拒否時のエラーと再試行導線 /
  カメラ映像非送信の明記が見えるか / 縦持ちで崩れないか / タップ操作が効くか
- トラブルシュート: カメラが出ない(HTTPS か・権限か)/ 動作が重い(解像度)/ MIDI キーボード接続(将来)

### 6. 練習ログ等の Git 除外

- 結果画面からダウンロードした `practice-log_*.json` がリポジトリ直下に出力されている。
  `.gitignore` に `practice-log_*.json` を追加(実験データはリポジトリに含めない)
- 既に置かれているファイルは開発者のデータなので削除しない(追跡対象から外すのみ)

## 実装手順(作業単位ごとに commit)

1. 本計画を commit
2. `.gitignore` に練習ログ追加 → commit
3. vite-plugin-pwa 追加 + manifest + アイコン + base 環境変数対応 → `npm run build` で生成物確認 → commit
4. スマホ縦持ちレイアウト調整 → ブラウザのモバイル幅で確認 → commit
5. GitHub Actions ワークフロー + 確認手順書 → commit
6. README(P6: PWA・デプロイ・スマホ確認)+ CLAUDE.md 進捗ログ → commit
7. (情報が揃い次第)リモート設定 → push → Pages 有効化 → Android 実機確認

## 完了条件と検証

- `npm run test` 全件パス(P6 はロジック変更なしなので既存 83 件が通ること)
- `npm run build` 成功。生成物 `dist/` に manifest・Service Worker が出力され:
  - `VITE_BASE=/test-repo/` でビルドし、**manifest の `start_url`/`scope` と MediaPipe パスが
    `/test-repo/` 基準**になっていること
  - Service Worker の **precache manifest に主要 JS チャンクが含まれ**、`.wasm`/`.task` が含まれないこと
- ブラウザのモバイル幅(例 390×844)で各画面が横スクロールせず崩れないこと(browser で確認)
- (実機)Android Chrome で HTTPS URL を開き、ホーム画面追加 → カメラ → 練習 → 結果まで通ること

## 仕様上の解釈・判断(レビュー観点)

- **オフライン非対応の割り切り**: 5 章「オフライン動作は必須ではない」に従い、巨大な WASM/モデルは
  precache しない。PWA の主目的は「ホーム画面追加」と「HTTPS 配信の受け皿」
- **base パスの環境変数化**: リポジトリ名が未確定でも開発を止めないため。ローカル("/")と本番("/<repo>/")を切替
- **master/main ブランチ**: 現在 master。ワークフローは両対応 + 手動実行にして、どちらでも動くようにする
- **完了条件「全機能が動く」の握り直し(開発者に共有・承認前提)**:
  バーチャル MIDI + スマホカメラでキャリブレーション〜練習〜結果〜JSON ダウンロードまで動く状態を
  「全機能が動く」とみなす。**実 MIDI キーボード(KORG)の Bluetooth 接続確認は機材未入手のため残件**
  (仕様 1.3 のバーチャル MIDI 方針に沿う)。正式画面フロー S-01〜S-06 への再構成は P6 スコープ外(タブ UI 維持)。
  → この解釈で P6 完了とみなすことを、実装完了報告時に開発者へ明示確認する
- **実機検証・実 MIDI は情報/機材待ち**: コードとデプロイ設定を完成させ、実行と実機確認は段階を分ける
