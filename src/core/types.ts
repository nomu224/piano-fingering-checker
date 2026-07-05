// 判定エンジンの型定義(仕様書 8.1 の楽曲スキーマ + Note On 処理結果)
// このファイルを含む src/core/ は UI・ブラウザ API に依存しない純 TypeScript とする。

/** 手の別(L=左手, R=右手) */
export type Hand = "L" | "R";

/** 譜面上の 1 音(和音の場合はイベント内に複数持つ) */
export interface Note {
  /** MIDI ノート番号(60 = 中央のド) */
  midi: number;
  /** 指番号 1〜5(親指=1〜小指=5)。運指未指定の音符は null とし、運指判定をスキップする */
  finger: number | null;
  hand: Hand;
}

/** 譜面イベント(単音、または同時発音の集合=和音。両手同時を含む) */
export interface ScoreEvent {
  /** 演奏順の通し番号(0 始まり) */
  index: number;
  /** 小節番号(1 始まり)。結果表示用 */
  measure: number;
  /** 小節内の通し番号(1 始まり)。結果表示「◯小節目の◯番目の音」に使う */
  posInMeasure: number;
  notes: Note[];
}

/** 楽曲データ */
export interface Song {
  id: string;
  title: string;
  difficulty: number;
  /** 演奏順のイベント列。タイミング情報は持たない(仕様書 8.1) */
  events: ScoreEvent[];
}

/**
 * Note On 1 回ごとの処理結果(仕様書 7.1)。
 * 判定はイベント単位ではなく Note On 1 回ごとに独立して行う(仕様書 7.2 の原則)。
 */
export type NoteOnResult =
  | CorrectResult
  | WrongNoteResult
  | DuplicateIgnoredResult
  | SkipJumpResult
  | FinishedResult;

/** 正解: 期待音と一致し、構成音を達成した */
export interface CorrectResult {
  type: "correct";
  /** 達成した構成音が属するイベントの index */
  eventIndex: number;
  /** 達成した構成音(P4 の運指判定でこの note の finger/hand を使う) */
  note: Note;
  /** このイベントの全構成音が達成され、カーソルが次へ進んだか */
  eventCompleted: boolean;
}

/** 音ミス: 期待音と不一致。カーソルは進めない(弾き直しを待つ) */
export interface WrongNoteResult {
  type: "wrongNote";
  /** 期待していたイベントの index */
  eventIndex: number;
  /** 実際に押されたノート番号 */
  playedMidi: number;
}

/** 達成済みの構成音と同じ音の再打鍵 → 無視(ミスにしない) */
export interface DuplicateIgnoredResult {
  type: "duplicateIgnored";
  eventIndex: number;
  playedMidi: number;
}

/**
 * 弾き飛ばし救済(仕様書 7.1)。
 * 同一カーソル位置で 2 回連続音ミスが発生し、直後 N イベント以内に
 * ミス音と一致する単音イベントがあった場合、そこへジャンプする。
 * 注意: この打鍵自体は仕様の文言どおり「音ミスとして記録」される
 * (集計時は skipJump も音ミス 1 回として数えること)。
 */
export interface SkipJumpResult {
  type: "skipJump";
  /** 実際に押されたノート番号(=ジャンプ先イベントの音) */
  playedMidi: number;
  /** 音ミスとして記録される位置(詰まっていたイベントの index) */
  missEventIndex: number;
  /** ジャンプ先イベントの index(この打鍵で達成済み扱いになる) */
  jumpedToEventIndex: number;
  /** スキップ(未演奏)になったイベントの index 一覧(詰まっていたイベント自身を含む) */
  skippedEventIndices: number[];
  /** ジャンプ先イベントで達成した音 */
  note: Note;
}

/**
 * 演奏終了: この打鍵で最終イベントが達成された(仕様書 7.1「曲の終了」)。
 * 通常の正解による達成と、弾き飛ばし救済ジャンプによる達成の両方があり得る
 * (後者は skippedEventIndices が非 undefined)。
 */
export interface FinishedResult {
  type: "finished";
  eventIndex: number;
  note: Note;
  /** 救済ジャンプで終了した場合のみ: スキップされたイベントの index 一覧 */
  skippedEventIndices?: number[];
}
