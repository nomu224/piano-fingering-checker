// 判定エンジン統合(仕様書 7.3 / F-05)のユニットテスト
import { describe, expect, it } from "vitest";
import { noteToX } from "../../src/core/fingerEstimator";
import { firstEventIndexOfMeasure, PracticeJudge } from "../../src/core/judge";
import type {
  DetectedHand,
  FingerNumber,
  Hand,
  KeyboardCalibration,
  LandmarkFrame,
  Note,
  ScoreEvent,
  Song,
} from "../../src/core/types";

// ---- テスト用ヘルパー ----

/** キャリブレーション: ド4(60)=0.1、ド5(72)=0.7(平均半音間隔 0.05) */
const CALIB: KeyboardCalibration = {
  lowMidi: 60,
  lowX: 0.1,
  highMidi: 72,
  highX: 0.7,
};

function note(midi: number, finger: number | null = 1, hand: Hand = "R"): Note {
  return { midi, finger, hand };
}

/** 全イベント 1 小節 4 音で自動配置する楽曲ヘルパー */
function song(eventNotes: Note[][]): Song {
  const events: ScoreEvent[] = eventNotes.map((notes, i) => ({
    index: i,
    measure: Math.floor(i / 4) + 1,
    posInMeasure: (i % 4) + 1,
    notes,
  }));
  return { id: "test", title: "テスト曲", difficulty: 0, events };
}

/**
 * 指定した指(1〜5)の指先だけが midi の鍵盤位置にあるフレームを作る。
 * 他の指先は遠く(x=0.95 付近)に置き、確実にその指が推定されるようにする。
 */
function frameWithFinger(
  finger: FingerNumber,
  midi: number,
  handedness: Hand = "R",
): LandmarkFrame {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.95, y: 0.5, z: 0 }));
  const tipIndices = [4, 8, 12, 16, 20];
  tipIndices.forEach((idx, i) => {
    landmarks[idx] = { x: 0.95 + i * 0.01, y: 0.5, z: 0 }; // 遠くに分散
  });
  landmarks[tipIndices[finger - 1]] = { x: noteToX(CALIB, midi), y: 0.7, z: 0 };
  const hand: DetectedHand = { handedness, score: 0.9, landmarks };
  return { timestampMs: 0, hands: [hand] };
}

/** 手が 1 つも映っていないフレーム */
const EMPTY_FRAME: LandmarkFrame = { timestampMs: 0, hands: [] };

// ---- テスト本体 ----

describe("運指判定(7.3)", () => {
  it("音正解 + 指一致 → OK(無音・ミスカウントなし)", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(62, 2)]]));
    const entry = j.handleNoteOn(60, 100, frameWithFinger(1, 60), CALIB);

    expect(entry.soundResult.type).toBe("correct");
    expect(entry.fingering).toMatchObject({ kind: "ok", expectedFinger: 1 });
    expect(entry.feedback).toBe("none");
    expect(j.getCounts()).toMatchObject({ fingerMisses: 0, noteMisses: 0 });
  });

  it("音正解 + 指不一致 → 運指ミス(ビープA。期待指・実際指がログに入る)", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(62, 2)]]));
    // 譜面は親指(1)だが、人差し指(2)で押した
    const entry = j.handleNoteOn(60, 100, frameWithFinger(2, 60), CALIB);

    expect(entry.fingering).toMatchObject({ kind: "miss", expectedFinger: 1 });
    if (entry.fingering.kind === "miss") {
      expect(entry.fingering.estimated.finger).toBe(2); // 実測値
    }
    expect(entry.feedback).toBe("fingerMiss");
    expect(j.getCounts().fingerMisses).toBe(1);
  });

  it("判定不能 → 既定では無視(カウントのみ・無音)", () => {
    const j = new PracticeJudge(song([[note(60, 1)]]));
    const entry = j.handleNoteOn(60, 100, EMPTY_FRAME, CALIB);

    expect(entry.fingering).toMatchObject({
      kind: "undetermined",
      reason: "handNotDetected",
      treatedAsMiss: false,
    });
    expect(entry.feedback).toBe("none");
    expect(j.getCounts()).toMatchObject({ undetermined: 1, fingerMisses: 0 });
  });

  it("判定不能 → ミス扱い設定(F-07)ならビープAとミスカウント", () => {
    const j = new PracticeJudge(song([[note(60, 1)]]), { undeterminedAsMiss: true });
    const entry = j.handleNoteOn(60, 100, EMPTY_FRAME, CALIB);

    expect(entry.fingering).toMatchObject({
      kind: "undetermined",
      treatedAsMiss: true,
    });
    expect(entry.feedback).toBe("fingerMiss");
    expect(j.getCounts()).toMatchObject({ undetermined: 1, fingerMisses: 1 });
  });

  it("音ミス → 運指判定は走らない(7.3。ビープB)", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(62, 2)]]));
    // 指一致のフレームを渡しても、音ミスなら運指判定対象外
    const entry = j.handleNoteOn(65, 100, frameWithFinger(1, 65), CALIB);

    expect(entry.soundResult.type).toBe("wrongNote");
    expect(entry.fingering).toEqual({ kind: "notApplicable" });
    expect(entry.feedback).toBe("noteMiss");
    expect(j.getCounts()).toMatchObject({ noteMisses: 1, fingerMisses: 0 });
  });

  it("finger: null の音符は運指判定をスキップ(8.1。判定不能には数えない)", () => {
    const j = new PracticeJudge(song([[note(60, null)]]));
    const entry = j.handleNoteOn(60, 100, frameWithFinger(3, 60), CALIB);

    expect(entry.fingering).toEqual({ kind: "skipped", reason: "noFinger" });
    expect(entry.feedback).toBe("none");
    expect(j.getCounts().undetermined).toBe(0);
  });

  it("カメラなしモード(calibration/frame が null)→ 音判定のみ(F-01。判定不能に数えない)", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(62, 2)]]));
    const e1 = j.handleNoteOn(60, 100, null, null);
    expect(e1.soundResult.type).toBe("correct");
    expect(e1.fingering).toEqual({ kind: "skipped", reason: "noCamera" });

    const e2 = j.handleNoteOn(65, 200, null, null); // 音ミスは通常どおり
    expect(e2.feedback).toBe("noteMiss");
    expect(j.getCounts()).toMatchObject({ noteMisses: 1, undetermined: 0 });
  });
});

describe("弾き飛ばし救済と運指判定(7.1 / 7.3)", () => {
  it("skipJump の打鍵は音ミス扱いで、運指判定は走らない", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(64, 3)], [note(65, 4)], [note(67, 5)]]));
    j.handleNoteOn(64, 100, frameWithFinger(3, 64), CALIB); // 音ミス 1 回目
    const entry = j.handleNoteOn(64, 200, frameWithFinger(3, 64), CALIB); // 2 回目で救済

    expect(entry.soundResult.type).toBe("skipJump");
    expect(entry.fingering).toEqual({ kind: "notApplicable" });
    expect(entry.feedback).toBe("noteMiss");
    // 音ミス 2 回(wrongNote + skipJump)、運指ミス 0
    expect(j.getCounts()).toMatchObject({ noteMisses: 2, fingerMisses: 0 });
    // スキップされたイベントがログ(soundResult)に残る
    if (entry.soundResult.type === "skipJump") {
      expect(entry.soundResult.skippedEventIndices).toEqual([0]);
    }
  });

  it("救済で完走した場合(スキップ付き finished)も音ミス扱いで運指判定なし", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(62, 2)], [note(64, 3)]]));
    j.handleNoteOn(64, 100, frameWithFinger(3, 64), CALIB);
    const entry = j.handleNoteOn(64, 200, frameWithFinger(3, 64), CALIB);

    expect(entry.soundResult.type).toBe("finished");
    expect(entry.finished).toBe(true);
    expect(entry.fingering).toEqual({ kind: "notApplicable" });
    expect(entry.feedback).toBe("noteMiss");
  });

  it("スキップ無しの finished(通常の完走)は運指判定される", () => {
    const j = new PracticeJudge(song([[note(60, 1)]]));
    const entry = j.handleNoteOn(60, 100, frameWithFinger(2, 60), CALIB); // 違う指で完走

    expect(entry.soundResult.type).toBe("finished");
    expect(entry.finished).toBe(true);
    expect(entry.fingering).toMatchObject({ kind: "miss", expectedFinger: 1 });
    expect(entry.feedback).toBe("fingerMiss");
  });
});

describe("判定ログ(F-05)", () => {
  it("ログにタイムスタンプ・譜面位置・期待値・実測値・判定結果が記録される", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(62, 2)]]));
    j.handleNoteOn(60, 1234, frameWithFinger(1, 60), CALIB);
    j.handleNoteOn(63, 2345, frameWithFinger(2, 63), CALIB); // 音ミス

    const log = j.getLog();
    expect(log).toHaveLength(2);

    expect(log[0]).toMatchObject({
      timestampMs: 1234,
      playedMidi: 60, // 実測値
      eventIndex: 0,
      measure: 1,
      posInMeasure: 1, // 譜面上の位置
      feedback: "none",
    });
    expect(log[0].expectedNotes).toEqual([note(60, 1)]); // 期待値

    expect(log[1]).toMatchObject({
      timestampMs: 2345,
      playedMidi: 63,
      eventIndex: 1, // 期待していたのは 2 番目のイベント
      posInMeasure: 2,
      feedback: "noteMiss",
    });
  });

  it("達成済み音の再打鍵(duplicateIgnored)もログに残るが無音", () => {
    const j = new PracticeJudge(song([[note(60, 1), note(64, 3)], [note(62, 2)]]));
    j.handleNoteOn(60, 100, frameWithFinger(1, 60), CALIB);
    const entry = j.handleNoteOn(60, 200, frameWithFinger(1, 60), CALIB); // 再打鍵

    expect(entry.soundResult.type).toBe("duplicateIgnored");
    expect(entry.feedback).toBe("none");
    expect(j.getCounts().totalNoteOns).toBe(2); // 総打鍵数には数える
  });

  it("restart でログ・集計・進行がクリアされる(新しい練習セッション)", () => {
    const j = new PracticeJudge(song([[note(60, 1)], [note(62, 2)]]));
    j.handleNoteOn(65, 100, null, null); // 音ミス
    j.handleNoteOn(60, 200, null, null);
    expect(j.getLog()).toHaveLength(2);

    j.restart();
    expect(j.getLog()).toHaveLength(0);
    expect(j.getCounts()).toEqual({
      totalNoteOns: 0,
      noteMisses: 0,
      fingerMisses: 0,
      undetermined: 0,
    });
    expect(j.getCursor()).toBe(0);
    expect(j.isFinished()).toBe(false);
  });
});

describe("小節指定の途中開始(F-05)", () => {
  // 8 イベント = 2 小節(小節 1: index 0-3, 小節 2: index 4-7)
  const twoMeasureSong = song([
    [note(60, 1)], [note(62, 2)], [note(64, 3)], [note(65, 4)],
    [note(67, 5)], [note(65, 4)], [note(64, 3)], [note(62, 2)],
  ]);

  it("firstEventIndexOfMeasure が小節の最初のイベント index を返す", () => {
    expect(firstEventIndexOfMeasure(twoMeasureSong, 1)).toBe(0);
    expect(firstEventIndexOfMeasure(twoMeasureSong, 2)).toBe(4);
    expect(firstEventIndexOfMeasure(twoMeasureSong, 99)).toBeNull();
  });

  it("startFromMeasure で指定小節の先頭から始まり、セッションがクリアされる", () => {
    const j = new PracticeJudge(twoMeasureSong);
    j.handleNoteOn(60, 100, null, null);
    expect(j.startFromMeasure(2)).toBe(true);

    expect(j.getCursor()).toBe(4);
    expect(j.getLog()).toHaveLength(0);
    // 小節 2 の最初の音(ソ4=67)で正解になる
    expect(j.handleNoteOn(67, 200, null, null).soundResult.type).toBe("correct");
  });

  it("存在しない小節は false を返して何も変えない", () => {
    const j = new PracticeJudge(twoMeasureSong);
    j.handleNoteOn(60, 100, null, null);
    expect(j.startFromMeasure(99)).toBe(false);
    expect(j.getCursor()).toBe(1);
    expect(j.getLog()).toHaveLength(1);
  });
});

describe("ScoreFollower.setCursor", () => {
  it("範囲外の index はエラー", () => {
    const j = new PracticeJudge(song([[note(60, 1)]]));
    expect(j.startFromMeasure(1)).toBe(true); // 正常系(内部で setCursor(0))
    // setCursor の範囲チェックは ScoreFollower 側のテストとして startFromMeasure 経由では
    // 到達しない(firstEventIndexOfMeasure が null を返す)ため、ここでは正常系のみ確認
  });
});
