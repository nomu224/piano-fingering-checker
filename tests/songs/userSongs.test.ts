// 追加曲の保存(仕様書 F-09)のユニットテスト
import { beforeEach, describe, expect, it } from "vitest";
import {
  addUserSong,
  isUserSong,
  isValidSong,
  loadUserSongs,
  makeUniqueId,
  makeUniqueTitle,
  removeUserSong,
} from "../../src/songs/userSongs";
import type { Song } from "../../src/core/types";

// テスト環境(node)には localStorage が無いので最小のモックを用意する
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const KEY = "piano-fingering-checker:user-songs";
let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});

function song(id: string, title = "テスト曲"): Song {
  return {
    id,
    title,
    difficulty: 1,
    events: [
      {
        index: 0,
        measure: 1,
        posInMeasure: 1,
        notes: [{ midi: 60, finger: 1, hand: "R" }],
      },
    ],
  };
}

describe("保存・読み込み・削除", () => {
  it("何も保存していなければ空", () => {
    expect(loadUserSongs()).toEqual([]);
  });

  it("追加した曲を読み込める", () => {
    addUserSong(song("user-1", "かっこう"));
    const loaded = loadUserSongs();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe("かっこう");
  });

  it("複数追加しても前の曲が消えない", () => {
    addUserSong(song("user-1", "1曲目"));
    addUserSong(song("user-2", "2曲目"));
    expect(loadUserSongs().map((s) => s.title)).toEqual(["1曲目", "2曲目"]);
  });

  it("削除すると一覧から消える", () => {
    addUserSong(song("user-1"));
    addUserSong(song("user-2"));
    const rest = removeUserSong("user-1");
    expect(rest.map((s) => s.id)).toEqual(["user-2"]);
    expect(loadUserSongs().map((s) => s.id)).toEqual(["user-2"]);
  });
});

describe("壊れたデータの扱い(判定エンジンを守る)", () => {
  it("JSON が壊れていてもアプリが落ちず空を返す", () => {
    storage.setItem(KEY, "{壊れた");
    expect(loadUserSongs()).toEqual([]);
  });

  it("配列でない場合も空を返す", () => {
    storage.setItem(KEY, '{"foo":1}');
    expect(loadUserSongs()).toEqual([]);
  });

  it("壊れた曲だけを捨てて、正常な曲は残す", () => {
    const broken = { id: "x", title: "壊れ", difficulty: 1, events: "配列でない" };
    storage.setItem(KEY, JSON.stringify([song("user-1", "正常"), broken]));
    const loaded = loadUserSongs();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe("正常");
  });

  it("hand が不正な曲は読み込まない(運指判定が壊れるため)", () => {
    const bad = song("user-1");
    (bad.events[0].notes[0] as { hand: string }).hand = "X";
    storage.setItem(KEY, JSON.stringify([bad]));
    expect(loadUserSongs()).toEqual([]);
  });

  it("finger が範囲外(0 や 6)の曲は読み込まない", () => {
    const bad = song("user-1");
    (bad.events[0].notes[0] as { finger: number | null }).finger = 6;
    storage.setItem(KEY, JSON.stringify([bad]));
    expect(loadUserSongs()).toEqual([]);
  });

  it("finger が null(運指指定なし)は正常として扱う", () => {
    const ok = song("user-1");
    ok.events[0].notes[0].finger = null;
    expect(isValidSong(ok)).toBe(true);
  });

  it("midi が範囲外の曲は読み込まない", () => {
    const bad = song("user-1");
    bad.events[0].notes[0].midi = 200;
    storage.setItem(KEY, JSON.stringify([bad]));
    expect(loadUserSongs()).toEqual([]);
  });
});

describe("ID と曲名の重複回避", () => {
  it("既存と衝突しない id を作る", () => {
    const id = makeUniqueId([]);
    expect(id.startsWith("user-")).toBe(true);
    // 同じ id が既にある場合は連番が付く
    expect(makeUniqueId([id])).not.toBe(id);
  });

  it("同名の曲には (2) が付く", () => {
    expect(makeUniqueTitle("かっこう", [])).toBe("かっこう");
    expect(makeUniqueTitle("かっこう", ["かっこう"])).toBe("かっこう (2)");
    expect(makeUniqueTitle("かっこう", ["かっこう", "かっこう (2)"])).toBe("かっこう (3)");
  });

  it("追加曲かどうかを id で判別できる", () => {
    expect(isUserSong(song("user-123"))).toBe(true);
    expect(isUserSong(song("kakkou"))).toBe(false);
  });
});

describe("localStorage が使えない環境", () => {
  it("読み込みは空を返して落ちない", () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(loadUserSongs()).toEqual([]);
  });

  it("保存は分かりやすいエラーになる", () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(() => addUserSong(song("user-1"))).toThrow(/保存できません/);
  });
});
