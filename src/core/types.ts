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

// ---- 手認識(仕様書 7.2 の入力)の型 ----
// MediaPipe から得たデータを純データ型に変換したもの。
// P3 の指特定(fingerEstimator)の入力になるため、vision/ ではなく core/ に置く
// (core は UI・ブラウザ API に依存しないという方針を守るための依存方向)。

/** 手の 1 ランドマーク(MediaPipe の正規化座標。x, y は 0〜1、z は手首基準の奥行き) */
export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

/**
 * 検出された 1 つの手。
 * handedness は生映像基準に正規化済みの値(SWAP_HANDEDNESS 定数を通した後)。
 * 楽曲データの hand("L"/"R")との対応は Left=L, Right=R。
 */
export interface DetectedHand {
  handedness: Hand;
  /** handedness の信頼度(0〜1) */
  score: number;
  /** 21 点のランドマーク(仕様書 7.2。指先は index 4, 8, 12, 16, 20) */
  landmarks: HandLandmark[];
}

/**
 * 1 フレーム分の検出結果。
 * timestampMs は performance.now() 基準(MIDI 側 NoteMessage.timestampMs と同一時計)。
 * Note On の時刻に最も近いフレームを選ぶために使う(仕様書 7.2 の重要注記)。
 */
export interface LandmarkFrame {
  timestampMs: number;
  hands: DetectedHand[];
}

// ---- キャリブレーション(仕様書 F-03)と指特定(仕様書 7.2)の型 ----

/**
 * キャリブレーション結果: 基準 2 鍵による実鍵盤ジオメトリ上の線形補間(F-03 手順 4)。
 * x は映像の正規化座標(0〜1、生映像基準)。
 * セッションごとにメモリ内でのみ保持する(F-03: 保存しない)。
 */
export interface KeyboardCalibration {
  /** 低い方の基準鍵盤のノート番号 */
  lowMidi: number;
  /** 低い方の基準鍵盤の x 座標 */
  lowX: number;
  /** 高い方の基準鍵盤のノート番号 */
  highMidi: number;
  /** 高い方の基準鍵盤の x 座標 */
  highX: number;
}

/** 指番号(親指=1, 人差し指=2, 中指=3, 薬指=4, 小指=5) */
export type FingerNumber = 1 | 2 | 3 | 4 | 5;

/**
 * 指特定の結果(仕様書 7.2)。
 * 距離・マージンの単位はすべて「平均半音間隔」比
 * (キャリブレーションで得たオクターブ幅の 1/12 を 1.0 とする。解像度に依存させないため)。
 */
export type FingerEstimateResult =
  | {
      status: "estimated";
      finger: FingerNumber;
      /** 採用した指先と鍵盤位置の距離(平均半音間隔比)。小さいほど信頼できる */
      distanceSemitones: number;
      /** 1 位と 2 位の距離差(平均半音間隔比)。大きいほど信頼できる */
      marginSemitones: number;
      /** 拮抗のため y 座標による第 2 判定を使ったか */
      usedYTieBreak: boolean;
    }
  | {
      status: "undetermined";
      /**
       * 判定不能の理由:
       * - handNotDetected: 対象の手が検出されていない(フレーム無しも含む)
       * - tooFar: どの指も鍵盤に十分近くない(最小距離 > 閾値)
       * - ambiguous: 1 位と 2 位が拮抗し、y 座標でも判別できない
       */
      reason: "handNotDetected" | "tooFar" | "ambiguous";
    };

// ---- 練習の判定ログ(仕様書 F-05 / 7.3)----

/**
 * 運指判定の結果(音判定と別に記録する)。
 * - ok / miss: 推定が成立した場合(実測値=推定結果を含む)
 * - undetermined: 判定不能(7.2)。treatedAsMiss は「判定の厳しさ」設定(F-07。P4 は既定値)による
 * - skipped: 運指判定そのものを行わなかった場合。
 *   noFinger = 譜面に指番号が無い(8.1 の finger: null)/ noCamera = カメラなしモード(F-01)。
 *   ※ undetermined(判定不能数に数える)とは区別する
 * - notApplicable: 音ミス・弾き飛ばし救済・重複打鍵など、運指判定の対象外(7.3)
 */
export type FingeringJudgment =
  | {
      kind: "ok" | "miss";
      expectedFinger: FingerNumber;
      estimated: Extract<FingerEstimateResult, { status: "estimated" }>;
    }
  | {
      kind: "undetermined";
      expectedFinger: FingerNumber;
      reason: "handNotDetected" | "tooFar" | "ambiguous";
      treatedAsMiss: boolean;
    }
  | { kind: "skipped"; reason: "noFinger" | "noCamera" }
  | { kind: "notApplicable" };

/**
 * 判定ログの 1 エントリ(仕様書 F-05:
 * タイムスタンプ、譜面上の位置、期待値、実測値、判定結果)。
 */
export interface JudgmentEntry {
  /** 打鍵時刻(performance.now() 基準) */
  timestampMs: number;
  /** 実測値: 押されたノート番号 */
  playedMidi: number;
  /** 譜面上の位置(打鍵時点で期待していたイベント) */
  eventIndex: number;
  measure: number;
  posInMeasure: number;
  /** 期待値: 打鍵時点のイベントの構成音 */
  expectedNotes: Note[];
  /** 音判定の結果(スコアフォローの生結果。実測値・スキップ情報を含む) */
  soundResult: NoteOnResult;
  /** 運指判定の結果(実測値=推定指番号と信頼度を含む) */
  fingering: FingeringJudgment;
  /** この打鍵で UI が鳴らすべきフィードバック音(F-05。core は音を出さない) */
  feedback: "none" | "noteMiss" | "fingerMiss";
  /** この打鍵で演奏が終了したか */
  finished: boolean;
}

/** 練習中の集計(画面表示用。結果サマリー F-06 の本実装は P5) */
export interface JudgmentCounts {
  /** 総打鍵数 */
  totalNoteOns: number;
  /** 音ミス数(wrongNote + 弾き飛ばし救済) */
  noteMisses: number;
  /** 運指ミス数(指の不一致 + ミス扱いにした判定不能) */
  fingerMisses: number;
  /** 指特定の判定不能数(無視した分も含む) */
  undetermined: number;
}
