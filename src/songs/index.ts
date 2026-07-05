// 収録楽曲のレジストリ
// 楽曲 JSON(仕様書 8.1 スキーマ)をここで束ねて型を付ける。
// P5 で MusicXML→JSON 変換スクリプト(tools/)により曲を追加していく。

import type { Song } from "../core/types";
import doremiJson from "./doremi.json";

// JSON import は hand が string 型に推論されるため、Song 型へキャストする。
// スキーマの正しさは変換スクリプト(P5)と手書きデータのレビューで担保する。
export const doremi = doremiJson as unknown as Song;

/** 収録曲一覧(楽曲選択 F-04 で使う) */
export const songs: Song[] = [doremi];
