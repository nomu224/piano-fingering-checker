// 折りたたみセクション(仕様書 9 章)
//
// タブレット横持ちでは画面の高さが足りないため、練習中に操作しないもの
// (曲選択・楽譜追加・MIDI 機器選択・バーチャル鍵盤・判定ログ)を畳んで隠す。
//
// 【重要】中身は閉じていても DOM に残す(条件レンダリングにしない)。
// バーチャル鍵盤は window の keydown を購読して PC キー入力を受けているため、
// アンマウントすると閉じている間キー入力が効かなくなり、
// 「バーチャル MIDI は常に動く状態に保つ」(仕様書 F-02)に反する。
// <details> は閉じていても子要素を DOM に残すので、この用途に合っている。

import { useState } from "react";

interface Props {
  /** 見出し */
  title: string;
  /** 畳んだままでも分かるように出す補足(曲名・接続中の機器名など) */
  summary?: string;
  /** 最初に開いた状態にするか */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, summary, defaultOpen = false, children }: Props) {
  // 【重要】初回の値だけを使い、以後 open を React から書き換えない。
  // 変化する値(例: MIDI の接続状態)をそのまま open に渡すと、
  // 練習中に接続状態が変わった瞬間に、利用者が開いたセクションが勝手に閉じてしまう。
  const [initialOpen] = useState(defaultOpen);

  return (
    <details className="collapsible" open={initialOpen}>
      <summary>
        {title}
        {summary && <span className="collapsible-note">{summary}</span>}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
