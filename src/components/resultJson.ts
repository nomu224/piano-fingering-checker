// 判定ログのダウンロード内容とファイル名の組み立て(仕様書 F-06 / F-13)
//
// ブラウザ API(Blob / URL / document)はここに持ち込まない。
// 組み立てだけを純 TypeScript にしてユニットテストできるようにし、
// 実際のダウンロードは ResultScreen が行う。
//
// 記録のみモード(F-13)では、あとでどちらの条件のデータか分からなくなると
// 実験が成立しないため、JSON とファイル名の両方にモードと参加者 ID を入れる。

import type {
  JudgmentCounts,
  JudgmentEntry,
  PracticeSettings,
  Song,
} from "../core/types";

/** 組み立てに必要な情報 */
export interface ResultJsonInput {
  song: Song;
  counts: Readonly<JudgmentCounts>;
  log: readonly JudgmentEntry[];
  /** 設定のスナップショット(実験条件の記録) */
  settings: PracticeSettings;
  /** 完走したか(true)/ 中断か(false) */
  finished: boolean;
  /** 記録のみモード(F-13)で取ったデータか */
  recordOnly: boolean;
  /** 参加者 ID(任意。未入力なら空文字) */
  participantId: string;
  /** 書き出した日時。引数で受け取る(テストで固定できるようにするため) */
  now: Date;
}

/** ダウンロードする JSON の中身 */
export interface ResultJson {
  songId: string;
  songTitle: string;
  exportedAt: string;
  /** どちらの条件で取ったデータか(F-13) */
  mode: "recordOnly" | "normal";
  /** 参加者 ID(未入力なら空文字。キーは常に存在させる) */
  participantId: string;
  finished: boolean;
  settings: PracticeSettings;
  counts: Readonly<JudgmentCounts>;
  log: readonly JudgmentEntry[];
}

/** ファイル名に使える文字数の上限(長い ID で扱いにくいファイル名にならないように) */
const MAX_ID_LENGTH = 16;

/**
 * 参加者 ID をファイル名に使える形にする。
 * 英数字・ハイフン・アンダースコア以外は "_" に置き換える
 * (パス区切りや空白、日本語がファイル名に入ると扱いづらく、環境によっては保存に失敗するため)。
 */
export function sanitizeParticipantId(id: string): string {
  return id.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_ID_LENGTH);
}

/**
 * ダウンロードする JSON を組み立てる。
 * counts と log は**モードによって変えない**(同じ基準で 2 条件を比べるため)。
 */
export function buildResultJson(input: ResultJsonInput): ResultJson {
  return {
    songId: input.song.id,
    songTitle: input.song.title,
    exportedAt: input.now.toISOString(),
    mode: input.recordOnly ? "recordOnly" : "normal",
    participantId: input.participantId,
    finished: input.finished,
    settings: input.settings,
    counts: input.counts,
    log: input.log,
  };
}

/**
 * ダウンロードのファイル名を作る。
 * 例: practice-log_cuckoo_2026-11-23_14-05.json
 *     rec_practice-log_P01_cuckoo_2026-11-23_14-05.json(記録のみ・参加者 ID あり)
 */
export function buildResultFileName(input: ResultJsonInput): string {
  // ISO 文字列から「日付_時刻」を作る(コロンはファイル名に使えない)
  const stamp = input.now
    .toISOString()
    .slice(0, 16)
    .replaceAll(":", "-")
    .replace("T", "_");
  const id = sanitizeParticipantId(input.participantId);
  const parts = [
    // 記録のみのデータは一目で分かるように先頭に付ける(取り違え防止)
    input.recordOnly ? "rec" : null,
    "practice-log",
    id === "" ? null : id,
    input.song.id,
    stamp,
  ].filter((p): p is string => p !== null);
  return `${parts.join("_")}.json`;
}
