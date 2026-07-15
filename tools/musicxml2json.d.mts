// musicxml2json.mjs の型宣言(テストから import するため)
import type { Song } from "../src/core/types";

export interface ConvertMeta {
  id?: string;
  title?: string;
  difficulty?: number;
}

export interface ConvertResult {
  song: Song;
  warnings: string[];
}

/** MusicXML テキストを仕様書 8.1 の楽曲 JSON に変換する */
export declare function convertMusicXml(
  xmlText: string,
  meta?: ConvertMeta,
): ConvertResult;
