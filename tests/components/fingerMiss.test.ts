// 運指ミスの取り出し(仕様書 F-12)のユニットテスト
import { describe, expect, it } from "vitest";
import { collectLastFingerMisses } from "../../src/components/fingerMiss";
import type { FingerNumber, Hand, JudgmentEntry, Note } from "../../src/core/types";

/** 判定ログ 1 件を作るヘルパー(必要な項目だけ指定する) */
function entry(over: {
  eventIndex: number;
  midi: number;
  hand?: Hand;
  /** 運指ミス: [譜面の指, 実際の指] */
  miss?: [FingerNumber, FingerNumber];
  /** 運指は正解 */
  ok?: FingerNumber;
  /** 判定不能(ミス扱いにするかも指定) */
  undetermined?: boolean;
  treatedAsMiss?: boolean;
  /** 音ミス */
  wrongNote?: boolean;
  /** 運指判定をしていない */
  skipped?: boolean;
}): JudgmentEntry {
  const hand: Hand = over.hand ?? "R";
  const note: Note = { midi: over.midi, finger: over.ok ?? over.miss?.[0] ?? 1, hand };

  const soundResult: JudgmentEntry["soundResult"] = over.wrongNote
    ? { type: "wrongNote", eventIndex: over.eventIndex, playedMidi: over.midi }
    : { type: "correct", eventIndex: over.eventIndex, note, eventCompleted: false };

  let fingering: JudgmentEntry["fingering"];
  if (over.miss) {
    fingering = {
      kind: "miss",
      expectedFinger: over.miss[0],
      estimated: {
        status: "estimated",
        finger: over.miss[1],
        distanceSemitones: 0.1,
        marginSemitones: 0.5,
        usedYTieBreak: false,
      },
    };
  } else if (over.ok) {
    fingering = {
      kind: "ok",
      expectedFinger: over.ok,
      estimated: {
        status: "estimated",
        finger: over.ok,
        distanceSemitones: 0.1,
        marginSemitones: 0.5,
        usedYTieBreak: false,
      },
    };
  } else if (over.undetermined) {
    fingering = {
      kind: "undetermined",
      expectedFinger: 1,
      reason: "handNotDetected",
      treatedAsMiss: over.treatedAsMiss ?? false,
    };
  } else if (over.skipped) {
    fingering = { kind: "skipped", reason: "noCamera" };
  } else {
    fingering = { kind: "notApplicable" };
  }

  return {
    timestampMs: 0,
    playedMidi: over.midi,
    eventIndex: over.eventIndex,
    measure: 1,
    posInMeasure: 1,
    expectedNotes: [note],
    soundResult,
    fingering,
    feedback: over.miss ? "fingerMiss" : "correct",
    finished: false,
  };
}

describe("collectLastFingerMisses", () => {
  it("ログが空なら null", () => {
    expect(collectLastFingerMisses([])).toBeNull();
  });

  it("運指ミスが 1 件なら、その手・音・正解の指・実際の指を返す", () => {
    const log = [entry({ eventIndex: 0, midi: 60, miss: [1, 3] })];
    expect(collectLastFingerMisses(log)).toEqual([
      { hand: "R", misses: [{ midi: 60, expectedFinger: 1, actualFinger: 3 }] },
    ]);
  });

  it("和音で 1 音目がミス・2 音目が正解でも、ミスが残る(F-12 の主目的)", () => {
    const log = [
      entry({ eventIndex: 0, midi: 60, miss: [1, 2] }),
      entry({ eventIndex: 0, midi: 64, ok: 3 }),
    ];
    expect(collectLastFingerMisses(log)).toEqual([
      { hand: "R", misses: [{ midi: 60, expectedFinger: 1, actualFinger: 2 }] },
    ]);
  });

  it("同じイベントで 2 本ミスしたら 2 件とも返る", () => {
    const log = [
      entry({ eventIndex: 2, midi: 60, miss: [1, 2] }),
      entry({ eventIndex: 2, midi: 64, miss: [3, 4] }),
    ];
    expect(collectLastFingerMisses(log)?.[0].misses).toHaveLength(2);
  });

  it("指の入れ替わり(2 と 3 を逆に弾く)も両方返る", () => {
    const log = [
      entry({ eventIndex: 1, midi: 62, miss: [2, 3] }),
      entry({ eventIndex: 1, midi: 64, miss: [3, 2] }),
    ];
    const r = collectLastFingerMisses(log);
    expect(r?.[0].misses).toEqual([
      { midi: 62, expectedFinger: 2, actualFinger: 3 },
      { midi: 64, expectedFinger: 3, actualFinger: 2 },
    ]);
  });

  it("両手同時のミスは手ごとに分かれる(右手が先)", () => {
    const log = [
      entry({ eventIndex: 4, midi: 48, hand: "L", miss: [5, 4] }),
      entry({ eventIndex: 4, midi: 72, hand: "R", miss: [1, 2] }),
    ];
    const r = collectLastFingerMisses(log);
    expect(r?.map((h) => h.hand)).toEqual(["R", "L"]);
    expect(r?.find((h) => h.hand === "L")?.misses[0].actualFinger).toBe(4);
  });

  it("あとで正解の打鍵が続いても、最後にミスしたイベントを返し続ける", () => {
    const log = [
      entry({ eventIndex: 0, midi: 60, miss: [1, 3] }),
      entry({ eventIndex: 1, midi: 62, ok: 2 }),
      entry({ eventIndex: 2, midi: 64, ok: 3 }),
    ];
    expect(collectLastFingerMisses(log)?.[0].misses[0].midi).toBe(60);
  });

  it("新しいミスが出たら、そちらに入れ替わる", () => {
    const log = [
      entry({ eventIndex: 0, midi: 60, miss: [1, 3] }),
      entry({ eventIndex: 5, midi: 67, miss: [4, 5] }),
    ];
    expect(collectLastFingerMisses(log)?.[0].misses).toEqual([
      { midi: 67, expectedFinger: 4, actualFinger: 5 },
    ]);
  });

  it("判定不能は対象外(ミス扱いの設定でも図は出さない)", () => {
    const log = [
      entry({ eventIndex: 0, midi: 60, undetermined: true, treatedAsMiss: true }),
    ];
    expect(collectLastFingerMisses(log)).toBeNull();
  });

  it("運指判定をしていない打鍵(カメラなし等)は対象外", () => {
    expect(collectLastFingerMisses([entry({ eventIndex: 0, midi: 60, skipped: true })])).toBeNull();
  });

  it("音ミスは対象外(運指以前の問題)", () => {
    expect(
      collectLastFingerMisses([entry({ eventIndex: 0, midi: 61, wrongNote: true })]),
    ).toBeNull();
  });
});
