// 追加した楽曲の保存(仕様書 F-09)
//
// アプリから読み込んだ楽譜を localStorage に保存し、次回起動時も選べるようにする。
// 保存先は端末内のみで、外部には一切送信しない(仕様書 10 章)。
//
// 【注意】localStorage の中身はユーザーが書き換えられるため、読み込み時に必ず形を検証する。
// hand や finger が壊れていると判定エンジン(運指判定)が静かに誤動作するため。

import type { Hand, Note, ScoreEvent, Song } from "../core/types";

const STORAGE_KEY = "piano-fingering-checker:user-songs";

/** 追加曲に付ける id の接頭辞(内蔵曲と区別するため) */
const USER_SONG_ID_PREFIX = "user-";

/** 追加された曲かどうか(削除ボタンの出し分けに使う) */
export function isUserSong(song: Song): boolean {
  return song.id.startsWith(USER_SONG_ID_PREFIX);
}

/**
 * localStorage を安全に取得する。
 * プライバシーモードやストレージ無効設定では**アクセス自体が例外になる**ため、
 * モジュール読み込み時ではなく使うときに取得し、失敗したら null を返す。
 */
function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// ---- 検証(壊れたデータを判定エンジンに渡さないための関門) ----

function isValidNote(value: unknown): value is Note {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  if (!Number.isInteger(n.midi) || (n.midi as number) < 0 || (n.midi as number) > 127) {
    return false;
  }
  // finger は null(運指指定なし)か 1〜5
  if (n.finger !== null) {
    if (!Number.isInteger(n.finger)) return false;
    const f = n.finger as number;
    if (f < 1 || f > 5) return false;
  }
  return n.hand === "L" || n.hand === "R";
}

function isValidEvent(value: unknown): value is ScoreEvent {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  if (!Number.isInteger(e.index)) return false;
  if (!Number.isInteger(e.measure)) return false;
  if (!Number.isInteger(e.posInMeasure)) return false;
  if (!Array.isArray(e.notes) || e.notes.length === 0) return false;
  return e.notes.every(isValidNote);
}

/** 保存されている曲データが仕様書 8.1 のスキーマとして妥当か */
export function isValidSong(value: unknown): value is Song {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.length === 0) return false;
  if (typeof s.title !== "string") return false;
  if (typeof s.difficulty !== "number") return false;
  if (!Array.isArray(s.events) || s.events.length === 0) return false;
  return s.events.every(isValidEvent);
}

// ---- 読み書き ----

/**
 * 保存された曲を読み込む。
 * 壊れている曲は**その 1 曲だけ捨てて残りは活かす**(全部消さない)。
 */
export function loadUserSongs(): Song[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSong);
  } catch {
    // JSON が壊れている場合など。アプリを止めずに「曲なし」として扱う
    return [];
  }
}

/** 保存(容量超過などは呼び出し側で扱えるようエラーを投げる) */
function saveUserSongs(songs: Song[]): void {
  const storage = getStorage();
  if (!storage) {
    throw new Error(
      "このブラウザではデータを保存できません(プライベートモードの可能性があります)",
    );
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      throw new Error(
        "保存容量がいっぱいです。不要な曲を削除してから、もう一度お試しください",
      );
    }
    throw new Error(`曲の保存に失敗しました: ${String(e)}`);
  }
}

/**
 * 追加曲の id を一意にする。
 * 【重要】ここで一意にしないと、読み込むたびに同じ id になり前の曲を上書きしてしまう。
 */
export function makeUniqueId(existingIds: readonly string[]): string {
  const base = `${USER_SONG_ID_PREFIX}${Date.now()}`;
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** 曲名の重複を避ける(同名があれば「(2)」を付ける) */
export function makeUniqueTitle(title: string, existingTitles: readonly string[]): string {
  if (!existingTitles.includes(title)) return title;
  let n = 2;
  while (existingTitles.includes(`${title} (${n})`)) n++;
  return `${title} (${n})`;
}

/** 曲を追加して保存し、保存後の一覧を返す */
export function addUserSong(song: Song): Song[] {
  const songs = [...loadUserSongs(), song];
  saveUserSongs(songs);
  return songs;
}

/** 曲を削除して保存し、保存後の一覧を返す */
export function removeUserSong(id: string): Song[] {
  const songs = loadUserSongs().filter((s) => s.id !== id);
  saveUserSongs(songs);
  return songs;
}
