// MusicXML → 楽曲 JSON 変換スクリプト(仕様書 8.2)
//
// バイエルなどの運指付き MusicXML(MuseScore 等からエクスポート)を、
// 仕様書 8.1 の楽曲 JSON スキーマに変換する開発時ツール。アプリ本体には含めない。
//
// 使い方(README にも記載):
//   node tools/musicxml2json.mjs input.musicxml --id beyer-08 --title "バイエル 8番" --difficulty 1 --out src/songs/beyer-08.json
//
// 対応形式: 非圧縮 MusicXML(.musicxml / .xml)。圧縮形式(.mxl)は非対応
// (MuseScore では「エクスポート → MusicXML → 非圧縮」を選ぶこと)。
//
// 変換ルール:
// - <divisions> / <duration> / <backup> / <forward> で小節内の発音時刻を追跡し、
//   同一時刻の音を 1 イベント(同時発音)にまとめる。<chord/> は直前の音と同時刻
// - staff 1 = 右手(R)、staff 2 = 左手(L)。staff が無い場合は R として警告
// - 運指は <notations><technical><fingering>。無い音符は finger: null(運指判定スキップ)
// - 除外: 休符 / 装飾音(grace)/ タイで繋がれた音(<tie type="stop"> を持つ音は
//   start の有無によらず除外。押し直しの Note On が無いため)
// - 警告: 同一イベント内に同じノート番号が複数の手に存在(仕様書 8.1)/ 運指未指定の数 /
//   1〜5 以外の運指 / 除外した装飾音の数

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { XMLParser } from "fast-xml-parser";

// ---- preserveOrder モードの XML ノード操作ヘルパー ----
// fast-xml-parser の preserveOrder は要素の出現順を保つ代わりに
// ノードが { タグ名: 子配列, ":@": 属性 } という形になるため、小さなヘルパーで包む。
// (<note> と <backup> の並び順が時刻計算に必須なので preserveOrder が必要)

/** ノードのタグ名 */
function tagOf(node) {
  return Object.keys(node).find((k) => k !== ":@");
}

/** ノードの子ノード配列 */
function kidsOf(node) {
  const tag = tagOf(node);
  return tag ? (node[tag] ?? []) : [];
}

/** 属性値 */
function attrOf(node, name) {
  return node?.[":@"]?.[name];
}

/** 指定タグの子ノード一覧 */
function childrenByTag(node, tag) {
  return kidsOf(node).filter((c) => c[tag] !== undefined);
}

/** 指定タグの最初の子ノード */
function firstChild(node, tag) {
  return childrenByTag(node, tag)[0];
}

/** ノードのテキスト内容 */
function textOf(node) {
  if (!node) return undefined;
  const textNode = kidsOf(node).find((c) => c["#text"] !== undefined);
  return textNode?.["#text"];
}

/** 指定タグの最初の子ノードのテキスト */
function childText(node, tag) {
  return textOf(firstChild(node, tag));
}

// ---- 変換本体 ----

/** step + alter + octave → MIDI ノート番号(C4 = 60) */
const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitchToMidi(step, alter, octave) {
  const base = STEP_TO_SEMITONE[step];
  if (base === undefined) return null;
  return (octave + 1) * 12 + base + alter;
}

/**
 * MusicXML テキストを仕様書 8.1 の楽曲 JSON に変換する。
 * @param {string} xmlText 非圧縮 MusicXML の内容
 * @param {{id?: string, title?: string, difficulty?: number}} meta 曲メタ情報
 * @returns {{song: object, warnings: string[]}}
 */
export function convertMusicXml(xmlText, meta = {}) {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
  });
  const doc = parser.parse(xmlText);

  const root = doc.find((n) => n["score-partwise"] !== undefined);
  if (!root) {
    throw new Error(
      "score-partwise が見つかりません(対応形式は非圧縮 MusicXML。.mxl は非対応)",
    );
  }

  const warnings = [];
  const parts = childrenByTag(root, "part");
  if (parts.length === 0) {
    throw new Error("part がありません");
  }
  if (parts.length > 1) {
    warnings.push(
      `パートが ${parts.length} 個あります。最初のパートのみ変換します(ピアノ独奏を想定)`,
    );
  }
  const part = parts[0];

  // 曲タイトルの自動取得(--title 未指定時のフォールバック)
  const work = firstChild(root, "work");
  const autoTitle = work ? childText(work, "work-title") : undefined;

  let divisions = 1; // 四分音符あたりの時間単位(<attributes><divisions>)
  let graceSkipped = 0;
  let noFingerCount = 0;
  let noStaffSeen = false;

  /** 収集した音: { measureSeq, measureNumber, startTime, midi, finger, hand } */
  const collected = [];

  const measures = childrenByTag(part, "measure");
  measures.forEach((measure, measureIdx) => {
    // 小節番号は譜面の表記を優先(整数でなければ連番)
    const numberAttr = Number(attrOf(measure, "number"));
    const measureNumber =
      Number.isInteger(numberAttr) && numberAttr >= 1 ? numberAttr : measureIdx + 1;

    let time = 0; // 小節内の現在時刻(divisions 単位)
    let lastNoteStart = 0; // <chord/> 用: 直前の音の開始時刻

    for (const el of kidsOf(measure)) {
      const tag = tagOf(el);

      if (tag === "attributes") {
        const d = Number(childText(el, "divisions"));
        if (Number.isFinite(d) && d > 0) divisions = d;
        continue;
      }
      if (tag === "backup") {
        time -= Number(childText(el, "duration") ?? 0);
        continue;
      }
      if (tag === "forward") {
        time += Number(childText(el, "duration") ?? 0);
        continue;
      }
      if (tag !== "note") continue;

      // 装飾音は除外(実演奏で弾くと音ミス判定になるため警告で気づけるように数える)
      if (firstChild(el, "grace")) {
        graceSkipped++;
        continue;
      }

      const isChord = firstChild(el, "chord") !== undefined;
      const duration = Number(childText(el, "duration") ?? 0);

      // 発音時刻: <chord/> は直前の音と同時刻。それ以外は現在時刻から duration ぶん進める
      const startTime = isChord ? lastNoteStart : time;
      if (!isChord) {
        lastNoteStart = time;
        time += duration;
      }

      // 休符は時刻だけ進めて除外
      if (firstChild(el, "rest")) continue;

      // タイで繋がれた音(tie stop を持つ)は除外: 新しい Note On が無い
      // (3 音以上のタイ連鎖の中間音は stop と start を両方持つが、stop があれば除外)
      const hasTieStop = childrenByTag(el, "tie").some(
        (t) => attrOf(t, "type") === "stop",
      );
      if (hasTieStop) continue;

      // 音高 → MIDI ノート番号
      const pitch = firstChild(el, "pitch");
      if (!pitch) continue;
      const midi = pitchToMidi(
        childText(pitch, "step"),
        Number(childText(pitch, "alter") ?? 0),
        Number(childText(pitch, "octave")),
      );
      if (midi === null) {
        warnings.push(`不明な音高があるためスキップしました(${measureNumber} 小節目)`);
        continue;
      }

      // staff → hand(ピアノ譜: staff 1 = 右手, staff 2 = 左手)
      const staffText = childText(el, "staff");
      let hand;
      if (staffText === undefined) {
        hand = "R";
        noStaffSeen = true;
      } else {
        hand = Number(staffText) === 1 ? "R" : "L";
      }

      // 運指(<notations><technical><fingering>)
      let finger = null;
      let fingerFound = false;
      for (const notations of childrenByTag(el, "notations")) {
        for (const technical of childrenByTag(notations, "technical")) {
          const f = firstChild(technical, "fingering");
          if (!f) continue;
          fingerFound = true;
          const value = Number(textOf(f));
          if (Number.isInteger(value) && value >= 1 && value <= 5) {
            finger = value;
          } else {
            warnings.push(
              `1〜5 でない運指 "${textOf(f)}" を無視しました(${measureNumber} 小節目)`,
            );
          }
        }
      }
      if (!fingerFound) noFingerCount++;

      collected.push({ measureSeq: measureIdx, measureNumber, startTime, midi, finger, hand });
    }
  });

  // 同一時刻の音を 1 イベントにまとめる(小節順 → 時刻順)
  const groups = new Map();
  for (const n of collected) {
    const key = `${n.measureSeq}:${n.startTime}`;
    if (!groups.has(key)) {
      groups.set(key, {
        measureSeq: n.measureSeq,
        measureNumber: n.measureNumber,
        startTime: n.startTime,
        notes: [],
      });
    }
    groups.get(key).notes.push({ midi: n.midi, finger: n.finger, hand: n.hand });
  }
  const sortedGroups = [...groups.values()].sort(
    (a, b) => a.measureSeq - b.measureSeq || a.startTime - b.startTime,
  );

  // イベント列を組み立て(index は演奏順の通し番号、posInMeasure は小節内で自動採番: 仕様書 8.1)
  const events = [];
  const posCounter = new Map();
  for (const g of sortedGroups) {
    // 同一イベント内の重複チェック
    const seen = new Map(); // midi → hands
    const notes = [];
    for (const note of g.notes) {
      const hands = seen.get(note.midi) ?? new Set();
      if (hands.has(note.hand)) {
        // 同じ手の完全重複(声部の重なり)は 1 つにまとめる
        continue;
      }
      if (hands.size > 0) {
        // 左右の手で同じ鍵盤を同時に弾くケース(仕様書 8.1: 警告を出す)
        warnings.push(
          `同一イベント内に同じノート番号 ${note.midi} が複数の手に存在します(${g.measureNumber} 小節目。初期収録曲では非対応)`,
        );
      }
      hands.add(note.hand);
      seen.set(note.midi, hands);
      notes.push(note);
    }

    const pos = (posCounter.get(g.measureSeq) ?? 0) + 1;
    posCounter.set(g.measureSeq, pos);
    events.push({
      index: events.length,
      measure: g.measureNumber,
      posInMeasure: pos,
      notes,
    });
  }

  if (events.length === 0) {
    throw new Error("音符が 1 つも見つかりませんでした");
  }
  if (graceSkipped > 0) {
    warnings.push(
      `装飾音を ${graceSkipped} 個除外しました(実演奏で装飾音を弾くと音ミス判定になります)`,
    );
  }
  if (noFingerCount > 0) {
    warnings.push(
      `運指の無い音符が ${noFingerCount} 個あります(finger: null として運指判定をスキップします)`,
    );
  }
  if (noStaffSeen) {
    warnings.push("staff の無い音符があります(右手として扱いました)");
  }

  const song = {
    id: meta.id ?? "converted-song",
    title: meta.title ?? autoTitle ?? "(無題)",
    difficulty: meta.difficulty ?? 1,
    events,
  };
  return { song, warnings };
}

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
