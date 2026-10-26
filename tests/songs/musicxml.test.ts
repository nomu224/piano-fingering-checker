// MusicXML → 楽曲 JSON 変換(仕様書 8.2 / F-09)のユニットテスト
// CLI とアプリが共有する変換ロジックのテスト(src/songs/musicxml.ts)
import { describe, expect, it } from "vitest";
import { convertMusicXml } from "../../src/songs/musicxml";

/** テスト用 MusicXML を組み立てるヘルパー */
function score(measures: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}

/** 単音ノートの XML(staff・運指・タイなどを差し込める) */
function noteXml(
  step: string,
  octave: number,
  opts: {
    alter?: number;
    duration?: number;
    staff?: number;
    finger?: number | string;
    chord?: boolean;
    ties?: ("start" | "stop")[];
    grace?: boolean;
  } = {},
): string {
  const { alter, duration = 1, staff, finger, chord, ties, grace } = opts;
  return `<note>
    ${grace ? "<grace/>" : ""}
    ${chord ? "<chord/>" : ""}
    <pitch><step>${step}</step>${alter !== undefined ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>
    ${grace ? "" : `<duration>${duration}</duration>`}
    ${(ties ?? []).map((t) => `<tie type="${t}"/>`).join("")}
    ${staff !== undefined ? `<staff>${staff}</staff>` : ""}
    ${finger !== undefined ? `<notations><technical><fingering>${finger}</fingering></technical></notations>` : ""}
  </note>`;
}

describe("convertMusicXml: 基本変換", () => {
  it("単音列が midi・finger・measure・posInMeasure・index つきで変換される", () => {
    const xml = score(`
      <measure number="1">
        <attributes><divisions>1</divisions></attributes>
        ${noteXml("C", 4, { staff: 1, finger: 1 })}
        ${noteXml("D", 4, { staff: 1, finger: 2 })}
      </measure>
      <measure number="2">
        ${noteXml("E", 4, { staff: 1, finger: 3 })}
      </measure>`);
    const { song, warnings } = convertMusicXml(xml, {
      id: "test",
      title: "テスト",
      difficulty: 1,
    });

    expect(song.id).toBe("test");
    expect(song.events).toHaveLength(3);
    expect(song.events[0]).toEqual({
      index: 0,
      measure: 1,
      measureIndex: 0,
      onsetQuarters: 0,
      posInMeasure: 1,
      notes: [{ midi: 60, finger: 1, hand: "R" }],
    });
    expect(song.events[1]).toMatchObject({ index: 1, measure: 1, posInMeasure: 2 });
    expect(song.events[2]).toMatchObject({
      index: 2,
      measure: 2,
      posInMeasure: 1,
      notes: [{ midi: 64, finger: 3, hand: "R" }],
    });
    expect(warnings).toHaveLength(0);
  });

  it("alter(♯)が MIDI ノート番号に反映される", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("F", 4, { alter: 1, staff: 1, finger: 2 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events[0].notes[0].midi).toBe(66); // ファ♯4
  });

  it("<chord/> の音が直前の音と同じイベントにまとまる", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1, finger: 1 })}
      ${noteXml("E", 4, { staff: 1, finger: 3, chord: true })}
      ${noteXml("D", 4, { staff: 1, finger: 2 })}
    </measure>`);
    const { song } = convertMusicXml(xml);

    expect(song.events).toHaveLength(2);
    expect(song.events[0].notes.map((n) => n.midi).sort()).toEqual([60, 64]);
    expect(song.events[1].notes[0].midi).toBe(62);
  });

  it("<backup> による両手同時(大譜表)が 1 イベントにまとまる", () => {
    // 右手(staff1)で C4 を弾き、backup で戻って左手(staff2)で C3 を弾く
    const xml = score(`<measure number="1">
      <attributes><divisions>2</divisions></attributes>
      ${noteXml("C", 4, { duration: 2, staff: 1, finger: 1 })}
      <backup><duration>2</duration></backup>
      ${noteXml("C", 3, { duration: 2, staff: 2, finger: 5 })}
    </measure>`);
    const { song } = convertMusicXml(xml);

    expect(song.events).toHaveLength(1);
    const notes = song.events[0].notes;
    expect(notes).toContainEqual({ midi: 60, finger: 1, hand: "R" });
    expect(notes).toContainEqual({ midi: 48, finger: 5, hand: "L" });
  });

  it("staff 2 が左手(L)になる", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 3, { staff: 2, finger: 5 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events[0].notes[0].hand).toBe("L");
  });
});

describe("convertMusicXml: 除外と警告", () => {
  it("運指の無い音符は finger: null になり、警告に数が出る(8.1)", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1 })}
    </measure>`);
    const { song, warnings } = convertMusicXml(xml);
    expect(song.events[0].notes[0].finger).toBeNull();
    expect(warnings.some((w) => w.includes("運指の無い音符が 1 個"))).toBe(true);
  });

  it("1〜5 以外の運指は警告して null になる", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1, finger: 6 })}
    </measure>`);
    const { song, warnings } = convertMusicXml(xml);
    expect(song.events[0].notes[0].finger).toBeNull();
    expect(warnings.some((w) => w.includes('1〜5 でない運指 "6"'))).toBe(true);
  });

  it("3 音タイの 2・3 音目が除外される(tie stop を持つ音は start があっても除外)", () => {
    const xml = score(`
      <measure number="1">
        <attributes><divisions>1</divisions></attributes>
        ${noteXml("C", 4, { staff: 1, finger: 1, ties: ["start"] })}
        ${noteXml("C", 4, { staff: 1, finger: 1, ties: ["stop", "start"] })}
      </measure>
      <measure number="2">
        ${noteXml("C", 4, { staff: 1, finger: 1, ties: ["stop"] })}
        ${noteXml("D", 4, { staff: 1, finger: 2 })}
      </measure>`);
    const { song } = convertMusicXml(xml);

    // タイの先頭 C4 と、次の D4 だけが残る
    expect(song.events).toHaveLength(2);
    expect(song.events[0].notes[0].midi).toBe(60);
    expect(song.events[1].notes[0].midi).toBe(62);
  });

  it("休符は除外されるが時刻は進む(休符の後の音が別イベントになる)", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1, finger: 1 })}
      <note><rest/><duration>1</duration></note>
      ${noteXml("D", 4, { staff: 1, finger: 2 })}
    </measure>`);
    const { song } = convertMusicXml(xml);

    expect(song.events).toHaveLength(2);
    expect(song.events.flatMap((e) => e.notes.map((n) => n.midi))).toEqual([60, 62]);
  });

  it("装飾音(grace)は除外され、警告に数が出る", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("B", 3, { staff: 1, grace: true })}
      ${noteXml("C", 4, { staff: 1, finger: 1 })}
    </measure>`);
    const { song, warnings } = convertMusicXml(xml);

    expect(song.events).toHaveLength(1);
    expect(warnings.some((w) => w.includes("装飾音を 1 個除外"))).toBe(true);
  });

  it("左右の手で同じ鍵盤を同時に弾くと警告が出る(8.1)", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1, finger: 1 })}
      <backup><duration>1</duration></backup>
      ${noteXml("C", 4, { staff: 2, finger: 5 })}
    </measure>`);
    const { warnings } = convertMusicXml(xml);
    expect(warnings.some((w) => w.includes("同じノート番号 60"))).toBe(true);
  });

  it("score-partwise でない XML はエラー", () => {
    expect(() => convertMusicXml("<foo/>")).toThrow();
  });
});

// ---- 楽譜表示(F-11)のための位置情報 ----

describe("convertMusicXml: 楽譜表示用の位置情報(仕様書 8.1)", () => {
  it("小節内の発音位置が四分音符単位で入る(3 拍子)", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1, finger: 1 })}
      ${noteXml("D", 4, { staff: 1, finger: 2 })}
      ${noteXml("E", 4, { staff: 1, finger: 3 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events.map((e) => e.onsetQuarters)).toEqual([0, 1, 2]);
  });

  it("divisions が 2 以上でも四分音符単位になる", () => {
    // divisions=4 なら duration 4 = 四分音符、duration 2 = 八分音符
    const xml = score(`<measure number="1">
      <attributes><divisions>4</divisions></attributes>
      ${noteXml("C", 4, { duration: 4, staff: 1 })}
      ${noteXml("D", 4, { duration: 2, staff: 1 })}
      ${noteXml("E", 4, { duration: 2, staff: 1 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events.map((e) => e.onsetQuarters)).toEqual([0, 1, 1.5]);
  });

  it("小節の途中で divisions が変わっても位置が狂わない", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { duration: 1, staff: 1 })}
      <attributes><divisions>4</divisions></attributes>
      ${noteXml("D", 4, { duration: 4, staff: 1 })}
      ${noteXml("E", 4, { duration: 4, staff: 1 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events.map((e) => e.onsetQuarters)).toEqual([0, 1, 2]);
  });

  it("和音(chord)の 2 音目は直前と同じ位置になり、1 つのイベントにまとまる", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1, finger: 1 })}
      ${noteXml("E", 4, { staff: 1, finger: 3, chord: true })}
      ${noteXml("G", 4, { staff: 1, finger: 5 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events).toHaveLength(2);
    expect(song.events[0].onsetQuarters).toBe(0);
    expect(song.events[0].notes).toHaveLength(2);
    expect(song.events[1].onsetQuarters).toBe(1);
  });

  it("3 連符(循環小数になる)でも和音が割れない", () => {
    // divisions=3、duration=1 の音符 3 つ = 四分音符 1 つ分の 3 連符
    const xml = score(`<measure number="1">
      <attributes><divisions>3</divisions></attributes>
      ${noteXml("C", 4, { duration: 1, staff: 1 })}
      ${noteXml("E", 4, { duration: 1, staff: 1, chord: true })}
      ${noteXml("D", 4, { duration: 1, staff: 1 })}
      ${noteXml("F", 4, { duration: 1, staff: 1, chord: true })}
      ${noteXml("E", 4, { duration: 1, staff: 1 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events).toHaveLength(3);
    expect(song.events.every((e) => e.notes.length === 1 || e.notes.length === 2)).toBe(true);
    expect(song.events[1].onsetQuarters).toBeCloseTo(0.333333, 5);
    expect(song.events[1].notes).toHaveLength(2);
  });

  it("休符・タイ・装飾音を挟んでも位置がずれない", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 4, { staff: 1 })}
      <note><rest/><duration>1</duration><staff>1</staff></note>
      ${noteXml("D", 4, { staff: 1, grace: true })}
      ${noteXml("E", 4, { staff: 1 })}
      ${noteXml("E", 4, { staff: 1, ties: ["stop"] })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    // ド(0 拍目)と ミ(2 拍目)。休符・装飾音・タイ後続は音符として出ない
    expect(song.events.map((e) => e.onsetQuarters)).toEqual([0, 2]);
  });

  it("backup を使う両手譜で、左手の位置が小節頭に戻る", () => {
    const xml = score(`<measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${noteXml("C", 5, { staff: 1 })}
      ${noteXml("D", 5, { staff: 1 })}
      <backup><duration>2</duration></backup>
      ${noteXml("C", 3, { staff: 2 })}
    </measure>`);
    const { song } = convertMusicXml(xml);
    // 右手 1 音目と左手が同じ位置 = 1 つのイベントにまとまる
    expect(song.events).toHaveLength(2);
    expect(song.events[0].onsetQuarters).toBe(0);
    expect(song.events[0].notes).toHaveLength(2);
  });

  it("出現順の小節インデックスが入る(弱起で番号が 0 でもずれない)", () => {
    const xml = score(`
      <measure number="0">
        <attributes><divisions>1</divisions></attributes>
        ${noteXml("C", 4, { staff: 1 })}
      </measure>
      <measure number="1">
        ${noteXml("D", 4, { staff: 1 })}
      </measure>`);
    const { song } = convertMusicXml(xml);
    expect(song.events.map((e) => e.measureIndex)).toEqual([0, 1]);
    // 印刷上の番号(measure)は譜面の表記を優先し、0 以下のときだけ出現順に置き換える。
    // そのため弱起では 1 小節目と 2 小節目がどちらも「1」になりうる(結果表示用の値なので許容)。
    // 楽譜との対応づけには measureIndex を使うので、この重複は影響しない
    expect(song.events.map((e) => e.measure)).toEqual([1, 1]);
  });

  it("divisions が無い譜面は 1 として扱い、警告を出す", () => {
    const xml = score(`<measure number="1">
      ${noteXml("C", 4, { duration: 1, staff: 1 })}
      ${noteXml("D", 4, { duration: 1, staff: 1 })}
    </measure>`);
    const { song, warnings } = convertMusicXml(xml);
    expect(song.events.map((e) => e.onsetQuarters)).toEqual([0, 1]);
    expect(warnings.some((w) => w.includes("divisions"))).toBe(true);
  });
});

// ---- 実ファイルでの回帰テスト(F-09: CLI とアプリで結果が食い違わないことの確認) ----

describe("実ファイル(かっこう)の変換", () => {
  it("CLI で作った kakkou.json と events が一致する", async () => {
    // 開発者が MuseScore で作った実際の楽譜。CLI 経由で作った JSON と突き合わせることで、
    // 共有ロジックが同じ結果を出していることを確認する(id/title は CLI 引数由来なので対象外)
    const fs = await import("node:fs");
    const xml = fs.readFileSync("gakufu/kakkou.musicxml", "utf-8");
    const expected = JSON.parse(fs.readFileSync("src/songs/kakkou.json", "utf-8"));

    const { song } = convertMusicXml(xml, { id: "kakkou", title: "かっこう", difficulty: 1 });

    expect(song.events).toEqual(expected.events);
    expect(song).toEqual(expected);
  });
});

describe("実ファイル(ロンドン橋)の変換", () => {
  it("内蔵曲 london-bridge.json と一致する(元の楽譜と JSON のずれを検出)", async () => {
    const fs = await import("node:fs");
    const xml = fs.readFileSync("gakufu/ロンドン橋.musicxml", "utf-8");
    const expected = JSON.parse(fs.readFileSync("src/songs/london-bridge.json", "utf-8"));

    const { song, warnings } = convertMusicXml(xml, {
      id: "london-bridge",
      title: "ロンドン橋",
      difficulty: 1,
    });

    expect(song).toEqual(expected);
    // すべての音符に運指が付いている楽譜なので警告は出ない
    expect(warnings).toEqual([]);
  });
});
