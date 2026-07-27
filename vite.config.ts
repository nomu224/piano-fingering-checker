/// <reference types="vitest/config" />
/// <reference types="node" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";

// GitHub Pages はサブパス配信(https://<user>.github.io/<repo>/)になるため、
// base をリポジトリ名にする。ローカルや未設定時は "/"。
// GitHub Actions が VITE_BASE=/<repo>/ を渡す(前後スラッシュ付き)。
// MediaPipe のパス(handTracker.ts)は import.meta.env.BASE_URL 基準なので base に自動追従する。
const base = process.env.VITE_BASE ?? "/";

// スマホ実機確認用: 同じ Wi-Fi のタブレットから HTTPS でアクセスするためのモード。
// `VITE_HTTPS=true npm run dev` で有効化(自己署名証明書 + LAN 公開)。
// カメラは HTTPS でないと動かないため。普段の開発(http/localhost)には影響しない。
const useHttps = process.env.VITE_HTTPS === "true";

// Vite + Vitest + PWA の設定
export default defineConfig({
  base,
  // HTTPS モードのときだけ LAN の全インターフェースに公開(タブレットからアクセスできるように)
  server: useHttps ? { host: true } : undefined,
  plugins: [
    react(),
    // HTTPS モードのときだけ自己署名証明書を有効化
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
      registerType: "autoUpdate",
      // PWA の主目的は「ホーム画面追加」と HTTPS 配信(仕様書 5 章: オフライン動作は必須ではない)
      manifest: {
        name: "ピアノ運指チェッカー",
        short_name: "運指チェッカー",
        description: "カメラで指を認識し、MIDI 入力と譜面を照合して運指の正誤を知らせる練習アプリ",
        lang: "ja",
        theme_color: "#1e1e2e",
        background_color: "#1e1e2e",
        display: "standalone",
        // スマホ縦持ちを基本レイアウトとする(仕様書 9 章)
        orientation: "portrait",
        icons: [
          {
            src: "icons/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // アプリシェル(JS/CSS/HTML)のみ precache。MediaPipe の WASM/モデルは含めない
        globPatterns: ["**/*.{js,css,html}"],
        // MediaPipe を import するメイン JS チャンクが precache から漏れないよう上限を確保する
        // (下げると「ホーム画面追加してもアプリシェルがキャッシュされない」= PWA の意味が半減)
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // SPA の navigateFallback(index.html)が WASM/モデルのリクエストに index.html を返す事故を防ぐ
        navigateFallbackDenylist: [/mediapipe\//, /\.wasm$/, /\.task$/],
      },
    }),
  ],
  test: {
    // テスト対象: tests/ 配下(src/core/ の判定エンジンをテストする)
    include: ["tests/**/*.test.ts"],
  },
});
