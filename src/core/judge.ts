// 判定エンジンの統合(仕様書 7.3 / F-05)
//
// Note On 1 回を受けて、音判定(スコアフォロー 7.1)→ 運指判定(指特定 7.2 + 比較 7.3)を
// 一気通貫で行い、判定ログ(F-05)を記録する。
// UI・ブラウザ API に依存しない純 TypeScript(テスト対象)。
// ビープ音は鳴らさない(entry.feedback を見て UI 側が鳴らす)。
//
// 運指判定のルール(仕様書 7.3):
// - 音が正解だった note についてのみ、推定指番号と譜面の指番号を比較する
// - 音ミスの打鍵は運指判定の対象外(音を直すのが先)
// - 弾き飛ばし救済(skipJump / スキップ付き finished)の打鍵は仕様 7.1 の文言どおり
//   「音ミスとして記録」されるため、これも運指判定の対象外
// - 判定不能は設定に従い「無視(カウントのみ)」または「ミス扱い」(F-07。P4 は既定値)

import { DEFAULT_UNDETERMINED_AS_MISS } from "./constants";
import { estimateFinger } from "./fingerEstimator";
import { ScoreFollower } from "./scoreFollower";
import type {
  FingeringJudgment,
  FingerNumber,
  JudgmentCounts,
  JudgmentEntry,
  KeyboardCalibration,
  LandmarkFrame,
  Note,
  NoteOnResult,
  ScoreEvent,
  Song,
} from "./types";

export interface PracticeJudgeOptions {
  /** 判定不能をミス扱いにするか(F-07「判定の厳しさ」。省略時は既定値) */
  undeterminedAsMiss?: boolean;
}

/**
 * 小節番号 → その小節の最初のイベント index(F-05: 小節番号で指定して途中から開始)。
 * 該当する小節が無ければ null。
 */
export function firstEventIndexOfMeasure(song: Song, measure: number): number | null {
  const event = song.events.find((e) => e.measure === measure);
  return event ? event.index : null;
}

export class PracticeJudge {
  private readonly follower: ScoreFollower;
  private readonly undeterminedAsMiss: boolean;

  /** 判定ログ(F-05)。やり直し・途中開始で新しい練習セッションとしてクリアされる */
  private log: JudgmentEntry[] = [];

  private counts: JudgmentCounts = {
    totalNoteOns: 0,
    noteMisses: 0,
    fingerMisses: 0,
    undetermined: 0,
  };

  constructor(song: Song, options: PracticeJudgeOptions = {}) {
    this.follower = new ScoreFollower(song);
    this.undeterminedAsMiss =
      options.undeterminedAsMiss ?? DEFAULT_UNDETERMINED_AS_MISS;
  }

  /**
   * Note On 1 回を処理し、判定ログエントリを返す(ログにも記録する)。
   *
   * @param midi 押されたノート番号
   * @param timestampMs 打鍵時刻(performance.now() 基準)
   * @param frame Note On 時刻に最も近いフレーム(リングバッファの getNearestFrame で取得)。
   *              カメラなしモードでは null
   * @param calibration キャリブレーション結果。カメラなしモードでは null
   */
  handleNoteOn(
    midi: number,
    timestampMs: number,
    frame: LandmarkFrame | null,
    calibration: KeyboardCalibration | null,
  ): JudgmentEntry {
    // 打鍵時点で期待していたイベント(音ミス時の「譜面上の位置」「期待値」の記録用)
    const expectedEvent = this.follower.getCurrentEvent();
    const soundResult = this.follower.processNoteOn(midi, timestampMs);

    this.counts.totalNoteOns++;

    const { fingering, feedback } = this.judgeFingering(
      soundResult,
      midi,
      frame,
      calibration,
    );

    const entry: JudgmentEntry = {
      timestampMs,
      playedMidi: midi,
      eventIndex: expectedEvent.index,
      measure: expectedEvent.measure,
      posInMeasure: expectedEvent.posInMeasure,
      expectedNotes: expectedEvent.notes,
      soundResult,
      fingering,
      feedback,
      finished: soundResult.type === "finished",
    };
    this.log.push(entry);
    return entry;
  }

  /** 音判定の結果を受けて運指判定(7.3)を行う */
  private judgeFingering(
    soundResult: NoteOnResult,
    midi: number,
    frame: LandmarkFrame | null,
    calibration: KeyboardCalibration | null,
  ): { fingering: FingeringJudgment; feedback: JudgmentEntry["feedback"] } {
    switch (soundResult.type) {
      // 音ミス → 運指判定の対象外(7.3)。ビープ B
      case "wrongNote":
        this.counts.noteMisses++;
        return { fingering: { kind: "notApplicable" }, feedback: "noteMiss" };

      // 弾き飛ばし救済 → この打鍵は音ミスとして記録(7.1)。運指判定の対象外。ビープ B
      case "skipJump":
        this.counts.noteMisses++;
        return { fingering: { kind: "notApplicable" }, feedback: "noteMiss" };

      // 達成済み音の再打鍵 → 無視(判定なし・無音)
      case "duplicateIgnored":
        return { fingering: { kind: "notApplicable" }, feedback: "none" };

      case "correct":
      case "finished": {
        // 救済ジャンプで完走した場合(スキップ付き finished)も音ミス扱い(7.1 / 7.3)
        if (soundResult.type === "finished" && soundResult.skippedEventIndices) {
          this.counts.noteMisses++;
          return { fingering: { kind: "notApplicable" }, feedback: "noteMiss" };
        }
        return this.judgeFingerForNote(soundResult.note, midi, frame, calibration);
      }
    }
  }

  /** 音が正解だった note について、推定指番号と譜面の指番号を比較する(7.3) */
  private judgeFingerForNote(
    note: Note,
    midi: number,
    frame: LandmarkFrame | null,
    calibration: KeyboardCalibration | null,
  ): { fingering: FingeringJudgment; feedback: JudgmentEntry["feedback"] } {
    // 譜面に指番号が無い音符は運指判定をスキップ(8.1 の finger: null)
    if (note.finger === null) {
      return { fingering: { kind: "skipped", reason: "noFinger" }, feedback: "none" };
    }
    // 楽曲データの finger は 1〜5(仕様書 8.1)。変換スクリプト側で保証される
    const expectedFinger = note.finger as FingerNumber;

    // カメラなしモード(F-01)= キャリブレーション or フレームが無い → 音判定のみ。
    // 判定不能(handNotDetected)とは区別し、判定不能数にも数えない
    if (calibration === null || frame === null) {
      return { fingering: { kind: "skipped", reason: "noCamera" }, feedback: "none" };
    }

    const estimated = estimateFinger(frame, note.hand, midi, calibration);

    if (estimated.status === "undetermined") {
      this.counts.undetermined++;
      if (this.undeterminedAsMiss) {
        // 「ミス扱い」設定(F-07)ではミスとして数え、ビープ A を鳴らす
        this.counts.fingerMisses++;
        return {
          fingering: {
            kind: "undetermined",
            expectedFinger,
            reason: estimated.reason,
            treatedAsMiss: true,
          },
          feedback: "fingerMiss",
        };
      }
      // 既定は「無視(カウントのみ)」(12 章: 無理にミス判定しない)
      return {
        fingering: {
          kind: "undetermined",
          expectedFinger,
          reason: estimated.reason,
          treatedAsMiss: false,
        },
        feedback: "none",
      };
    }

    if (estimated.finger === expectedFinger) {
      // 運指 OK → 無音(正解のクリック音は F-07 の設定機能。P5)
      return {
        fingering: { kind: "ok", expectedFinger, estimated },
        feedback: "none",
      };
    }

    // 運指ミス → ビープ A +「指番号: 正解 X / 実際 Y」表示(F-05)
    this.counts.fingerMisses++;
    return {
      fingering: { kind: "miss", expectedFinger, estimated },
      feedback: "fingerMiss",
    };
  }

  /** 最初からやり直す(新しい練習セッションとしてログ・集計もクリア) */
  restart(): void {
    this.follower.reset();
    this.clearSession();
  }

  /**
   * 指定した小節の最初のイベントから開始する(F-05)。
   * 新しい練習セッションとしてログ・集計もクリアする。
   * @returns 開始できたか(小節が存在しなければ false)
   */
  startFromMeasure(measure: number): boolean {
    const index = firstEventIndexOfMeasure(this.follower.getSong(), measure);
    if (index === null) return false;
    this.follower.setCursor(index);
    this.clearSession();
    return true;
  }

  private clearSession(): void {
    this.log = [];
    this.counts = {
      totalNoteOns: 0,
      noteMisses: 0,
      fingerMisses: 0,
      undetermined: 0,
    };
  }

  /** 判定ログ(F-05)。JSON ダウンロード(F-06)は P5 で実装 */
  getLog(): readonly JudgmentEntry[] {
    return this.log;
  }

  getCounts(): Readonly<JudgmentCounts> {
    return this.counts;
  }

  isFinished(): boolean {
    return this.follower.isFinished();
  }

  getCurrentEvent(): ScoreEvent {
    return this.follower.getCurrentEvent();
  }

  getCursor(): number {
    return this.follower.getCursor();
  }

  getSong(): Song {
    return this.follower.getSong();
  }
}
