// スコアフォロー(仕様書 7.1)のユニットテスト
import { describe, expect, it } from "vitest";
import { ScoreFollower } from "../../src/core/scoreFollower";
import type { Note, ScoreEvent, Song } from "../../src/core/types";

/** テスト用の単音 note を作るヘルパー */
function note(midi: number, finger: number | null = 1, hand: "L" | "R" = "R"): Note {
  return { midi, finger, hand };
}

/** テスト用の楽曲を作るヘルパー(全イベント 1 小節目扱いで簡略化) */
function song(eventNotes: Note[][]): Song {
  const events: ScoreEvent[] = eventNotes.map((notes, i) => ({
    index: i,
    measure: 1,
    posInMeasure: i + 1,
    notes,
  }));
  return { id: "test", title: "テスト曲", difficulty: 0, events };
}

describe("正しい演奏", () => {
  it("正しい順で弾くと全イベントが達成され、最後に finished になる", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)], [note(64)]]));

    expect(f.processNoteOn(60)).toMatchObject({
      type: "correct",
      eventIndex: 0,
      eventCompleted: true,
    });
    expect(f.getCursor()).toBe(1);

    expect(f.processNoteOn(62)).toMatchObject({ type: "correct", eventIndex: 1 });

    // 最終イベントの達成をもって演奏終了(仕様書 7.1「曲の終了」)
    expect(f.processNoteOn(64)).toMatchObject({ type: "finished", eventIndex: 2 });
    expect(f.isFinished()).toBe(true);
  });

  it("正解結果には達成した note(指番号・手つき)が含まれる", () => {
    const f = new ScoreFollower(song([[note(60, 1, "R")], [note(48, 5, "L")]]));
    const r = f.processNoteOn(60);
    expect(r.type).toBe("correct");
    if (r.type === "correct") {
      expect(r.note).toEqual({ midi: 60, finger: 1, hand: "R" });
    }
  });
});

describe("音ミス", () => {
  it("違う音を弾くと wrongNote になり、カーソルは進まない", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)]]));

    expect(f.processNoteOn(61)).toMatchObject({
      type: "wrongNote",
      eventIndex: 0,
      playedMidi: 61,
    });
    expect(f.getCursor()).toBe(0);
  });

  it("音ミスの後、弾き直せば正解として回復する", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)]]));

    f.processNoteOn(61); // 音ミス
    expect(f.processNoteOn(60)).toMatchObject({ type: "correct", eventIndex: 0 });
    expect(f.getCursor()).toBe(1);
  });
});

describe("同音連打(仕様書 7.1 で必須のテストケース)", () => {
  it("連続する同じ音のイベントは、Note On のたびに 1 つずつ進む", () => {
    // ド・ド・ド の 3 連打
    const f = new ScoreFollower(song([[note(60)], [note(60)], [note(60)]]));

    expect(f.processNoteOn(60)).toMatchObject({ type: "correct", eventIndex: 0 });
    expect(f.getCursor()).toBe(1);
    expect(f.processNoteOn(60)).toMatchObject({ type: "correct", eventIndex: 1 });
    expect(f.getCursor()).toBe(2);
    expect(f.processNoteOn(60)).toMatchObject({ type: "finished", eventIndex: 2 });
  });
});

describe("和音(複数 notes のイベント)", () => {
  it("構成音を順不同で押しても、全構成音が揃った時点でカーソルが進む", () => {
    const chord = [note(60, 1, "R"), note(64, 3, "R"), note(48, 5, "L")];
    const f = new ScoreFollower(song([chord, [note(62)]]));

    // 譜面と逆順で押す
    expect(f.processNoteOn(48)).toMatchObject({
      type: "correct",
      eventCompleted: false,
    });
    expect(f.processNoteOn(64)).toMatchObject({
      type: "correct",
      eventCompleted: false,
    });
    expect(f.getCursor()).toBe(0); // まだ揃っていない

    expect(f.processNoteOn(60)).toMatchObject({
      type: "correct",
      eventCompleted: true,
    });
    expect(f.getCursor()).toBe(1); // 全構成音達成で前進
  });

  it("構成音以外の音は音ミスになるが、達成済みマークはリセットされない", () => {
    const f = new ScoreFollower(song([[note(60), note(64)], [note(62)]]));

    f.processNoteOn(60); // 構成音 1 つ達成
    expect(f.processNoteOn(59)).toMatchObject({ type: "wrongNote" }); // 構成音以外

    // 達成マークが残っているので、残り 1 音でイベント完了する
    expect(f.processNoteOn(64)).toMatchObject({
      type: "correct",
      eventCompleted: true,
    });
  });

  it("達成済みの構成音と同じ音の再打鍵は無視される(ミスにしない)", () => {
    const f = new ScoreFollower(song([[note(60), note(64)], [note(62)]]));

    f.processNoteOn(60);
    expect(f.processNoteOn(60)).toMatchObject({
      type: "duplicateIgnored",
      playedMidi: 60,
    });
    expect(f.getCursor()).toBe(0); // 影響なし
  });
});

describe("弾き飛ばし救済(仕様書 7.1)", () => {
  it("同一位置で 2 回連続同じ音ミス → 直後のイベントと一致すればジャンプする", () => {
    // 期待: ド(60)。実際は次イベントのミ(64)を 2 回弾いてしまった
    const f = new ScoreFollower(song([[note(60)], [note(64)], [note(65)], [note(67)]]));

    expect(f.processNoteOn(64)).toMatchObject({ type: "wrongNote" }); // 1 回目はまだ救済しない
    const r = f.processNoteOn(64); // 2 回目で救済発動
    expect(r).toMatchObject({
      type: "skipJump",
      playedMidi: 64,
      missEventIndex: 0,
      jumpedToEventIndex: 1,
      skippedEventIndices: [0], // 詰まっていたイベント自身がスキップ記録に含まれる
    });
    // ジャンプ先イベントはこの打鍵で達成済み。次は index 2
    expect(f.getCursor()).toBe(2);
  });

  it("探索範囲 N=2 の端(2 つ先)でも一致すればジャンプし、中間もスキップ記録される", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)], [note(64)], [note(65)]]));

    f.processNoteOn(64);
    const r = f.processNoteOn(64);
    expect(r).toMatchObject({
      type: "skipJump",
      jumpedToEventIndex: 2,
      skippedEventIndices: [0, 1], // 詰まっていた 0 と中間の 1
    });
    expect(f.getCursor()).toBe(3);
  });

  it("探索範囲外(3 つ先)の音では救済されず wrongNote のまま", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)], [note(64)], [note(65)]]));

    f.processNoteOn(65);
    expect(f.processNoteOn(65)).toMatchObject({ type: "wrongNote" });
    expect(f.getCursor()).toBe(0);
  });

  it("2 回のミス音が違っても、直近のミス音で探索する", () => {
    const f = new ScoreFollower(song([[note(60)], [note(64)], [note(65)]]));

    f.processNoteOn(59); // 1 回目のミス(どこにも一致しない音)
    const r = f.processNoteOn(64); // 2 回目のミス = 直近のミス音として探索に使う
    expect(r).toMatchObject({ type: "skipJump", jumpedToEventIndex: 1 });
  });

  it("間に正解を挟むと連続ミスにならず、救済は発動しない", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)], [note(64)], [note(65)]]));

    f.processNoteOn(64); // ミス 1 回目
    f.processNoteOn(60); // 正解(連続ミスがリセットされる)
    // カーソルは 1(期待: 62)。64 は 1 つ先だが、ミスはまだ 1 回目なので救済しない
    expect(f.processNoteOn(64)).toMatchObject({ type: "wrongNote", eventIndex: 1 });
  });

  it("ジャンプ先候補に和音イベントは含めない", () => {
    // index1 が和音(60+64)。ミス音 64 は和音の構成音だが、単音イベントではないので対象外
    const f = new ScoreFollower(song([[note(60)], [note(60), note(64)], [note(65)]]));

    f.processNoteOn(64);
    expect(f.processNoteOn(64)).toMatchObject({ type: "wrongNote" });
    expect(f.getCursor()).toBe(0);
  });

  it("現在カーソルが和音イベントのときは救済を発動しない", () => {
    // 現在イベントが和音(部分達成中)。次の単音イベントと一致するミスを 2 回しても発動しない
    const f = new ScoreFollower(song([[note(60), note(64)], [note(67)], [note(69)]]));

    f.processNoteOn(60); // 和音を部分達成
    f.processNoteOn(67); // 構成音以外 → 音ミス 1 回目
    expect(f.processNoteOn(67)).toMatchObject({ type: "wrongNote" }); // 2 回目でも救済しない
    expect(f.getCursor()).toBe(0);
  });

  it("救済ジャンプ先が最終イベントなら finished になり、スキップ記録も付く", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)], [note(64)]]));

    f.processNoteOn(64);
    const r = f.processNoteOn(64);
    expect(r).toMatchObject({
      type: "finished",
      eventIndex: 2,
      skippedEventIndices: [0, 1],
    });
    expect(f.isFinished()).toBe(true);
  });
});

describe("その他", () => {
  it("イベントが空の楽曲はエラーになる", () => {
    expect(() => new ScoreFollower(song([]))).toThrow();
  });

  it("演奏終了後の打鍵は無視される", () => {
    const f = new ScoreFollower(song([[note(60)]]));
    f.processNoteOn(60);
    expect(f.processNoteOn(60)).toMatchObject({ type: "duplicateIgnored" });
    expect(f.processNoteOn(62)).toMatchObject({ type: "duplicateIgnored" });
  });

  it("setCursor で指定イベントから開始できる(途中開始用)", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)], [note(64)]]));
    f.processNoteOn(60); // 少し進めてから
    f.setCursor(2);

    expect(f.getCursor()).toBe(2);
    expect(f.processNoteOn(64)).toMatchObject({ type: "finished", eventIndex: 2 });
  });

  it("setCursor の範囲外はエラー", () => {
    const f = new ScoreFollower(song([[note(60)]]));
    expect(() => f.setCursor(-1)).toThrow();
    expect(() => f.setCursor(1)).toThrow();
  });

  it("reset で最初からやり直せる", () => {
    const f = new ScoreFollower(song([[note(60)], [note(62)]]));
    f.processNoteOn(60);
    f.processNoteOn(62);
    expect(f.isFinished()).toBe(true);

    f.reset();
    expect(f.isFinished()).toBe(false);
    expect(f.getCursor()).toBe(0);
    expect(f.processNoteOn(60)).toMatchObject({ type: "correct", eventIndex: 0 });
  });
});
