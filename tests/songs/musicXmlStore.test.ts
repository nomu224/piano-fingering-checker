// 楽譜(MusicXML)の保管(仕様書 F-11)のユニットテスト
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanUpOrphanMusicXml,
  getSongMusicXml,
  hasSongMusicXml,
  MAX_MUSIC_XML_LENGTH,
  removeUserSongMusicXml,
  saveUserSongMusicXml,
} from "../../src/songs/musicXmlStore";

// 内蔵曲の楽譜は Vite の ?raw で読み込むため、テスト環境では中身を差し替える
vi.mock("../../gakufu/kakkou.musicxml?raw", () => ({ default: "<score-partwise>かっこう</score-partwise>" }));
vi.mock("../../gakufu/ロンドン橋.musicxml?raw", () => ({
  default: "<score-partwise>ロンドン橋</score-partwise>",
}));

/** localStorage の代わり(node 環境には無いため) */
function createFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createFakeStorage());
});

describe("内蔵曲の楽譜", () => {
  it("内蔵曲は楽譜を持っている", () => {
    expect(getSongMusicXml("kakkou")).toContain("score-partwise");
    expect(hasSongMusicXml("london-bridge")).toBe(true);
  });

  it("MusicXML が無いテスト曲(doremi)は楽譜なしとして扱う", () => {
    expect(getSongMusicXml("doremi")).toBeNull();
    expect(hasSongMusicXml("doremi")).toBe(false);
  });
});

describe("追加曲の楽譜の保存", () => {
  it("保存した楽譜を取り出せる", () => {
    expect(saveUserSongMusicXml("user-1", "<score/>")).toBe(true);
    expect(getSongMusicXml("user-1")).toBe("<score/>");
  });

  it("大きすぎる楽譜は保存しない(練習はできる状態を優先する)", () => {
    const tooBig = "x".repeat(MAX_MUSIC_XML_LENGTH + 1);
    expect(saveUserSongMusicXml("user-2", tooBig)).toBe(false);
    expect(getSongMusicXml("user-2")).toBeNull();
  });

  it("保存できない環境でも例外を投げない", () => {
    vi.stubGlobal("localStorage", {
      ...createFakeStorage(),
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    expect(saveUserSongMusicXml("user-3", "<score/>")).toBe(false);
  });

  it("削除すると取り出せなくなる", () => {
    saveUserSongMusicXml("user-4", "<score/>");
    removeUserSongMusicXml("user-4");
    expect(getSongMusicXml("user-4")).toBeNull();
  });
});

describe("消し残しの掃除", () => {
  it("曲一覧に無い楽譜だけを消す", () => {
    saveUserSongMusicXml("user-keep", "<a/>");
    saveUserSongMusicXml("user-gone", "<b/>");

    cleanUpOrphanMusicXml(["user-keep"]);

    expect(getSongMusicXml("user-keep")).toBe("<a/>");
    expect(getSongMusicXml("user-gone")).toBeNull();
  });

  it("localStorage が使えなくても落ちない", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => cleanUpOrphanMusicXml(["user-1"])).not.toThrow();
    expect(getSongMusicXml("user-1")).toBeNull();
  });
});
