/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite + Vitest の設定
export default defineConfig({
  plugins: [react()],
  test: {
    // テスト対象: tests/ 配下(src/core/ の判定エンジンをテストする)
    include: ["tests/**/*.test.ts"],
  },
});
