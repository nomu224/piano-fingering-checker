// 収録楽曲のレジストリ
// 楽曲 JSON(仕様書 8.1 スキーマ)をここで束ねて型を付ける。
// 曲を追加するには MusicXML→JSON 変換スクリプト(tools/musicxml2json.mjs)で JSON を作り、
// ここに import と songs への追加を 2 行足す(README「楽曲の追加方法」参照)。

import type { Song } from "../core/types";
import doremiJson from "./doremi.json";
import kakkouJson from "./kakkou.json";

// JSON import は hand が string 型に推論されるため、Song 型へキャストする。
// スキーマの正しさは変換スクリプトと手書きデータのレビューで担保する。
export const doremi = doremiJson as unknown as Song;
export const kakkou = kakkouJson as unknown as Song;

/** 収録曲一覧(楽曲選択 F-04 で使う) */
export const songs: Song[] = [doremi, kakkou];
