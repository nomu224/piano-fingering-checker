// 判定ログのダウンロード内容とファイル名(仕様書 F-06 / F-13)のユニットテスト
import { describe, expect, it } from "vitest";
import {
  buildResultFileName,
  buildResultJson,
  sanitizeParticipantId,
  type ResultJsonInput,
} from "../../src/components/resultJson";
import { DEFAULT_SETTINGS } from "../../src/core/constants";
import type { JudgmentCounts, JudgmentEntry, Song } from "../../src/core/types";

const song: Song = {
  id: "cuckoo",
  title: "かっこう",
  difficulty: 1,
  events: [
    {
      index: 0,
      measure: 1,
      posInMeasure: 1,
      notes: [{ midi: 67, finger: 5, hand: "R" }],
    },
  ],
};

const counts: JudgmentCounts = {
  totalNoteOns: 10,
  noteMisses: 1,
  fingerMisses: 2,
  undetermined: 0,
};

const log: JudgmentEntry[] = [
  {
    timestampMs: 1234,
    playedMidi: 67,
    eventIndex: 0,
    measure: 1,
    posInMeasure: 1,
    expectedNotes: song.events[0].notes,
    soundResult: {
      type: "correct",
      eventIndex: 0,
      note: song.events[0].notes[0],
      eventCompleted: true,
    },
    fingering: { kind: "notApplicable" },
    feedback: "correct",
    finished: false,
  },
];

/** 入力を作るヘルパー(変えたい項目だけ指定する) */
function input(over: Partial<ResultJsonInput> = {}): ResultJsonInput {
  return {
    song,
    counts,
    log,
    settings: DEFAULT_SETTINGS,
    finished: true,
    recordOnly: false,
    participantId: "",
    // 2026-11-23 14:05 UTC に固定(日時がテストのたびに変わらないようにする)
    now: new Date("2026-11-23T14:05:30.000Z"),
    ...over,
  };
}

describe("buildResultJson", () => {
  it("通常モードは mode: normal になる", () => {
    expect(buildResultJson(input()).mode).toBe("normal");
  });

  it("記録のみモードは mode: recordOnly になる(F-13: あとで条件を判別するため)", () => {
    expect(buildResultJson(input({ recordOnly: true })).mode).toBe("recordOnly");
  });

  it("集計とログはモードによって変わらない(同じ基準で 2 条件を比べるため)", () => {
    const normal = buildResultJson(input({ recordOnly: false }));
    const record = buildResultJson(input({ recordOnly: true }));
    expect(record.counts).toEqual(normal.counts);
    expect(record.log).toEqual(normal.log);
    expect(record.log).toHaveLength(1);
  });

  it("参加者 ID が入る", () => {
    expect(buildResultJson(input({ participantId: "P01" })).participantId).toBe("P01");
  });

  it("参加者 ID が未入力なら空文字で入る(キーは常に存在させる)", () => {
    const json = buildResultJson(input());
    expect(json.participantId).toBe("");
    expect("participantId" in json).toBe(true);
  });

  it("曲・設定・完走フラグと日時が入る", () => {
    const json = buildResultJson(input({ finished: false }));
    expect(json.songId).toBe("cuckoo");
    expect(json.songTitle).toBe("かっこう");
    expect(json.finished).toBe(false);
    expect(json.settings).toEqual(DEFAULT_SETTINGS);
    expect(json.exportedAt).toBe("2026-11-23T14:05:30.000Z");
  });
});

describe("buildResultFileName", () => {
  it("通常モードは従来どおりのファイル名(曲 ID と日時)", () => {
    expect(buildResultFileName(input())).toBe("practice-log_cuckoo_2026-11-23_14-05.json");
  });

  it("記録のみモードは rec_ で始まる(取り違え防止)", () => {
    expect(buildResultFileName(input({ recordOnly: true }))).toBe(
      "rec_practice-log_cuckoo_2026-11-23_14-05.json",
    );
  });

  it("参加者 ID がファイル名に入る", () => {
    expect(buildResultFileName(input({ recordOnly: true, participantId: "P01" }))).toBe(
      "rec_practice-log_P01_cuckoo_2026-11-23_14-05.json",
    );
  });

  it("ファイル名に使えない文字は _ に置き換える", () => {
    expect(buildResultFileName(input({ participantId: "../etc" }))).toContain("___etc");
    expect(buildResultFileName(input({ participantId: "P 01" }))).toContain("P_01");
    expect(buildResultFileName(input({ participantId: "参加者" }))).toContain("___");
    expect(buildResultFileName(input({ participantId: "a/b" }))).not.toContain("/");
  });

  it("長い参加者 ID は 16 文字で切る", () => {
    const name = buildResultFileName(input({ participantId: "A".repeat(30) }));
    expect(name).toContain(`_${"A".repeat(16)}_`);
    expect(name).not.toContain("A".repeat(17));
  });

  it("日時は引数の now から作る(テストで固定できる)", () => {
    const name = buildResultFileName(input({ now: new Date("2025-01-02T03:04:05.000Z") }));
    expect(name).toBe("practice-log_cuckoo_2025-01-02_03-04.json");
  });
});

describe("sanitizeParticipantId", () => {
  it("前後の空白を落とす", () => {
    expect(sanitizeParticipantId("  P01  ")).toBe("P01");
  });

  it("英数字・ハイフン・アンダースコアはそのまま残す", () => {
    expect(sanitizeParticipantId("P-01_a9")).toBe("P-01_a9");
  });

  it("空文字は空文字のまま", () => {
    expect(sanitizeParticipantId("")).toBe("");
    expect(sanitizeParticipantId("   ")).toBe("");
  });
});
