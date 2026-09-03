// 判定エンジンのパラメータ集約ファイル
//
// ※ ここにある値はすべて仮の初期値であり、実機(実カメラ・実キーボード)での
//    予備実験で調整するパラメータ(仕様書 7.1 / 7.2)。
//    P3 で追加する指特定の閾値(0.6 半音間隔・0.25 半音間隔など)もここに集約する。

import type { PracticeSettings } from "./types";

/**
 * 弾き飛ばし救済(仕様書 7.1)の探索範囲 N。
 * 同一カーソル位置で 2 回連続音ミスが発生したとき、
 * 直後何イベントまで「直近のミス音と一致する単音イベント」を探すか。
 */
export const SKIP_SEARCH_RANGE = 2;

/**
 * ランドマーク履歴リングバッファの保持フレーム数(仕様書 7.2 の重要注記「直近 5 フレーム程度」)。
 * カメラフレームと MIDI の時刻ズレ対策。Note On の時刻に最も近いフレームを選ぶ。
 */
export const LANDMARK_HISTORY_SIZE = 5;

/**
 * MediaPipe の handedness ラベルを左右読み替えるか(仕様書 7.2 の注意書き)。
 * handedness はセルフィービュー前提のラベル付けのため、非反転映像では
 * Left/Right を読み替える必要がある可能性がある。
 *
 * 【検証済み 2026-07-06】実カメラ(非反転映像)で左手=L(水色)/右手=R(オレンジ)と
 * 正しく表示されることを開発者が確認 → 読み替え不要(false のまま)。
 * カメラ環境を大きく変えた場合は P2 カメラ確認画面で再確認すること。
 */
export const SWAP_HANDEDNESS = false;

// ---- 指特定(仕様書 7.2)の閾値。単位は「平均半音間隔」(オクターブ幅の 1/12)比 ----

/**
 * 最小距離がこれを超えたら「どの指も鍵盤に十分近くない」として判定不能(仕様書 7.2)。
 */
export const FINGER_MAX_DISTANCE_SEMITONES = 0.6;

/**
 * 1 位と 2 位の距離差がこれ未満なら拮抗とみなし、y 座標を第 2 の判定材料に使う(仕様書 7.2)。
 */
export const FINGER_AMBIGUOUS_MARGIN_SEMITONES = 0.25;

/**
 * 拮抗時の y 座標差がこれ未満(画像高さの 2%。正規化座標なので 0.02)なら判定不能(仕様書 7.2)。
 */
export const FINGER_Y_TIEBREAK_MIN_DIFF = 0.02;

// ---- キャリブレーション(仕様書 F-03)のパラメータ ----

/**
 * 確認ステップ(F-03 手順 5)で、ズレがこれ(平均半音間隔比)を超えた打鍵が
 * 1 回でもあれば再キャリブレーションを促す(強制はしない)。
 * 0.5 = おおよそ隣の鍵盤と取り違えるレベル。
 */
export const CALIBRATION_MAX_DEVIATION_SEMITONES = 0.5;

/**
 * 基準 2 鍵の推奨距離(半音)。1 オクターブ(12)以上離すようガイドに明記する(F-03 手順 2)。
 * 未満でも続行は可能(警告のみ。仕様は「ガイドに明記」までを要求)。
 */
export const CALIBRATION_RECOMMENDED_REF_DISTANCE = 12;

// ---- 練習・フィードバックの既定値(F-07 の設定 UI は P5。それまでの既定値) ----

/**
 * 指特定が判定不能だったとき「ミス扱い」にするか(仕様書 7.3 / F-07「判定の厳しさ」)。
 * 既定は false =「無視(カウントのみ)」(12 章: 判定不能カテゴリを設けて無理にミス判定しない)。
 */
export const DEFAULT_UNDETERMINED_AS_MISS = false;

/** フィードバック音の音量(0〜1)の既定値 */
export const FEEDBACK_VOLUME = 0.3;

/**
 * 実 MIDI デバイスのタイムスタンプの妥当範囲(**単位: ミリ秒**)。
 *
 * MIDIMessageEvent.timeStamp は performance.now() と同一基準のはずだが、
 * 万一かけ離れた値が届くと、ランドマーク履歴の最近傍検索(仕様書 7.2)が
 * 常に最古フレームを掴み、エラーも出さずに指特定が誤り続ける。
 * 現在時刻との差がこの値を超えたら異常とみなし、現在時刻で代用する。
 *
 * ランドマーク履歴は 5 フレーム(20〜30fps で 170〜250ms 相当)なので 1000ms なら十分な余裕がある。
 */
export const MIDI_TIMESTAMP_SANITY_MS = 1000;

/** 練習の設定(F-07)の既定値。設定画面 S-06 で変更できる */
export const DEFAULT_SETTINGS: PracticeSettings = {
  feedbackEnabled: true,
  feedbackVolume: FEEDBACK_VOLUME,
  clickOnCorrect: false,
  undeterminedAsMiss: DEFAULT_UNDETERMINED_AS_MISS,
  targetHands: "both",
};
