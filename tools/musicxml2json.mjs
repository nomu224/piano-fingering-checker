// MusicXML → 楽曲 JSON 変換スクリプト(仕様書 8.2)
//
// 【変換ロジックはこのファイルには無い】
// 仕様書 F-09 が「変換ロジックは 8.2 の変換スクリプトと同一のものを共有する」と定めているため、
// 変換本体は src/songs/musicxml.ts にあり、CLI とアプリの両方がそれを呼ぶ。
// このファイルは引数処理・ファイル IO・警告出力だけを担当する CLI ラッパー。
// (依存の向きは tools/ → src/ の一方向。src/ は tools/ を参照しない)
//
// 使い方(README にも記載):
//   node tools/musicxml2json.mjs input.musicxml --id beyer-08 --title "バイエル 8番" --difficulty 1 --out src/songs/beyer-08.json
//
// ※ Node 22.18 以上が必要(TypeScript を直接 import するため。package.json の engines 参照)

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
// 値の import なので .ts 拡張子まで明記する(Node の型ストリップの仕様)
import { convertMusicXml } from "../src/songs/musicxml.ts";

// アプリ側と同じ関数をそのまま再エクスポートする(既存テストの import 先を変えないため)
export { convertMusicXml };

// ---- CLI ----

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--id" || a === "--title" || a === "--out") {
      args[a.slice(2)] = argv[++i];
    } else if (a === "--difficulty") {
      args.difficulty = Number(argv[++i]);
    } else {
      args._.push(a);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  if (!input) {
    console.error(
      "使い方: node tools/musicxml2json.mjs <input.musicxml> --id <曲ID> --title <曲名> --difficulty <難易度> --out <出力先.json>",
    );
    process.exit(1);
  }

  const xmlText = readFileSync(input, "utf-8");
  const { song, warnings } = convertMusicXml(xmlText, {
    id: args.id,
    title: args.title,
    difficulty: args.difficulty,
  });

  for (const w of warnings) {
    console.error(`[警告] ${w}`);
  }

  const json = JSON.stringify(song, null, 2) + "\n";
  if (args.out) {
    writeFileSync(args.out, json);
    console.error(
      `変換完了: ${song.title}(イベント ${song.events.length} 件)→ ${args.out}`,
    );
    console.error(
      "src/songs/index.ts のレジストリに追加すると曲選択に表示されます(README 参照)",
    );
  } else {
    process.stdout.write(json);
  }
}

// CLI として直接実行された場合のみ main を呼ぶ(テストからは convertMusicXml を import する)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
