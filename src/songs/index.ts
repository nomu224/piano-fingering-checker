// 収録楽曲のレジストリ
// 楽曲 JSON(仕様書 8.1 スキーマ)をここで束ねて型を付ける。
//
// 曲は 2 種類ある:
// - 内蔵曲: このファイルに書かれた JSON(変換スクリプトで作ってリポジトリに入れたもの)
// - 追加曲: アプリから読み込んでブラウザに保存したもの(F-09。userSongs.ts が管理)

import type { Song } from "../core/types";
import doremiJson from "./doremi.json";
import kakkouJson from "./kakkou.json";
import { loadUserSongs } from "./userSongs";

// JSON import は hand が string 型に推論されるため、Song 型へキャストする。
// スキーマの正しさは変換スクリプトと手書きデータのレビューで担保する。
export const doremi = doremiJson as unknown as Song;
export const kakkou = kakkouJson as unknown as Song;

/** 内蔵曲(リポジトリに含まれる曲) */
export const builtinSongs: Song[] = [doremi, kakkou];

/**
 * 内蔵曲 + 追加曲をまとめて返す(楽曲選択 F-04 / F-09)。
 *
 * 【注意】呼び出すたびに新しい配列と、追加曲は新しいオブジェクトになる。
 * 練習画面は選択中の曲を参照で比較して判定エンジンを作り直すため、
 * **毎回の再描画で呼ばず、追加・削除のタイミングだけで呼ぶこと**
 * (毎回呼ぶと判定エンジンが作り直されて練習の進行が消える)。
 */
export function getAllSongs(): Song[] {
  return [...builtinSongs, ...loadUserSongs()];
}
