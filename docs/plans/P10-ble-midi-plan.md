# Bluetooth MIDI キーボードの直接接続(F-10)実装計画

## 背景・目的

Android タブレットで Bluetooth 接続したキーボード(microKEY2 Air)が、アプリの MIDI 機器一覧に現れない。
他のサイトでも「出るときと出ないとき」がある。調査の結果、原因は次のとおり。

- Android は、OS の Bluetooth 設定でペアリングしただけでは BLE-MIDI 機器を MIDI 機器として公開しない
- どこかのアプリが `MidiManager.openBluetoothDevice()` で開いている間だけ他のアプリからも見え、
  開いたアプリが閉じると「抜かれた」扱いになる
- Chrome 自身はこの操作をしないため、Web MIDI API だけでは安定して使えない

2026-09-14 に開発者の要望(「タブレットは Bluetooth で使う。Bluetooth でできるようにしてほしい」)を受け、
**仕様書 3.1 の誤った前提を訂正し、F-10 を追加**(変更履歴に記録済み)。

完了条件: **Android タブレットで「Bluetooth で接続」を押してキーボードを選ぶと、弾いた音で判定が動く**。

## 仕様書の該当章

- **F-10**: Web Bluetooth で直接接続 / BLE-MIDI パケットをアプリ内で解析 / 既存と同じ入力インターフェース /
  切断表示と再接続 / アプリを開くたびに機器選択が必要 / 非対応ブラウザでは案内 / 外部ライブラリ不使用
- 3.1(訂正後): Android では Web Bluetooth で直接接続。Windows / Mac は従来どおり Web MIDI。ガイド文は両方を表示
- 5 章: MIDI は Web MIDI API + Web Bluetooth API。ラッパーライブラリ不要
- F-01: MIDI 機器の選択に「Bluetooth で接続」を加える
- F-02: 判定エンジンは入力源を区別しない
- F-08: 参照音は Note On で即座に鳴らす(Bluetooth からの Note On でも同じ)
- 7.2: Note On の時刻に最も近いカメラフレームを使う(タイムスタンプの基準を揃える)
- 10 章: HTTPS 必須 / 権限拒否時の分かりやすいエラーと再試行

## 調べて分かった事実(実装の前提)

- BLE-MIDI の MIDI サービス UUID: `03b80e5a-ede8-4b33-a751-6ce34ec4c700`
- MIDI データのキャラクタリスティック UUID: `7772e5db-3868-4112-a1a9-f2669d106bf3`(Read / Write without response / Notify)
- **Web Bluetooth は小文字の UUID しか受け付けない**(大文字だと requestDevice が TypeError)。定数は小文字で書く
- パケット形式(BLE-MIDI 仕様):
  - 先頭はヘッダバイト: bit7 = 1、bit6 = 0、下位 6 ビットがタイムスタンプ上位
  - ステータスバイト(リアルタイム・SysEx 終端 0xF7 を含む)の前には必ずタイムスタンプバイト(bit7 = 1)が入る
  - ランニングステータス(ステータスバイトの省略)が使われることがある。その場合、タイムスタンプバイトが付くことも付かないこともある
  - System Real-Time メッセージ(0xF8〜0xFF)は、他のメッセージのデータバイトの間にも挟まることがある
  - SysEx は複数パケットにまたがることがある
- Web Bluetooth は Android / Windows の Chrome で使える。HTTPS 必須、`requestDevice` はユーザー操作が必要
- 以前許可した機器を取り出す `getDevices()` は、Chrome では実験的機能のフラグが必要(既定では使えない)
  → **アプリを開くたびに機器選択が必要**。同じページを開いている間は、切断後も `device.gatt.connect()` で選び直さずに再接続できる
- Android 12 以降は「付近のデバイス」の許可、それより前は位置情報の許可を Chrome が求める
- OS や別のアプリがキーボードに接続中だと、キーボードが電波を出さなくなり選択画面に出ないことがある
- TypeScript 5.8 の標準の型定義に Web Bluetooth は含まれない
- 音の準備(自動再生制限の解除)は App.tsx が画面のタップ・キー入力で既に行っている。
  「Bluetooth で接続」を押すこと自体がタップなので、MIDI 側に音の処理は持ち込まない

## やらないこと

- 外部ライブラリの追加(`@types/web-bluetooth` も入れない。使う部分だけの型定義を自前で書く)
- アプリを開いたときの自動再接続(`getDevices()` が既定で使えないため)
- BLE-MIDI での送信(このアプリは受信のみ)
- 複数の Bluetooth キーボードの同時接続(1 台のみ)
- 利用者向けの「Bluetooth 切断」ボタン(仕様にないため。画面を離れたときの後始末としてのみ切断する)
- Web MIDI API による接続の廃止(PC の USB 接続などで引き続き使う)
- アプリのコードに偽の Bluetooth 機器を入れること(PC での確認は開発者ツールに貼るコード片で行う)

## ディレクトリ構成(追加・変更分)

```
src/
  midi/
    bleMidiPacket.ts       # 【新規】BLE-MIDI パケット → MIDI バイト列 → Note On/Off(純TS・テスト対象)
    bleMidiInput.ts        # 【新規】Web Bluetooth で接続し Note On/Off を配る(MidiSource 実装)
    bleMidiErrors.ts       # 【新規】Web Bluetooth のエラー → 日本語メッセージ(純TS・テスト対象)
    compositeMidiSource.ts # 【新規】複数の入力源をまとめて 1 つの MidiSource に見せる(純TS・テスト対象)
    timestamp.ts           # 【新規】タイムスタンプ健全性チェック(midiInput.ts から切り出し。純TS・テスト対象)
    webBluetooth.d.ts      # 【新規】使う部分だけの Web Bluetooth 型定義
    midiInput.ts           # (変更)切り出したチェック関数を使う。冒頭コメントの 3.1 の記述を更新
    types.ts               # (変更)コメントに Bluetooth 入力も追記
  components/
    useMidiDevices.ts      # (変更)Bluetooth の接続状態と操作を追加。返す入力源を「まとめた入力源」にする
    MidiDeviceSelector.tsx # (変更)「Bluetooth で接続」ボタン・状態表示・再接続・エラー表示・ガイド文
tests/
  midi/
    bleMidiPacket.test.ts
    bleMidiErrors.test.ts
    bleMidiInput.test.ts
    compositeMidiSource.test.ts
    timestamp.test.ts
```

## 実装内容

### 1. `midi/bleMidiPacket.ts`(パケット解析・純TS)

レビューの指摘を受け、Android 標準の BLE-MIDI 解読と同じ **2 段構成** にする。

```ts
unwrapBleMidiPacket(packet: Uint8Array): number[]   // 段 1: BLE の包みをはがす
class MidiStreamParser { push(bytes: number[]): ParsedMidiMessage[] }  // 段 2: MIDI バイト列の組み立て
class BleMidiPacketParser { parse(packet: Uint8Array): ParsedMidiMessage[] }  // 1 と 2 をつなぐ(接続ごとに 1 個)
toBytes(view: DataView): Uint8Array  // DataView → バイト列(byteOffset を考慮)
```

**段 1: BLE の包みをはがす**

- 長さ 0 のパケット、ヘッダが不正(bit7 ≠ 1 または bit6 ≠ 0)なパケットは空配列を返す
- ヘッダの次から 1 バイトずつ見て、「**直前のバイトがタイムスタンプではない、かつ bit7 = 1**」のバイトだけを
  タイムスタンプとして捨てる。それ以外はすべて MIDI のバイトとして残す
  - ヘッダの直後は「直前がタイムスタンプではない」扱い(ヘッダの次の bit7 = 1 はタイムスタンプ)
  - こうすると、タイムスタンプの値が 0x90 や 0xF7 に見えても取り違えない
  - SysEx の続きのパケット(ヘッダの次が bit7 = 0)もそのまま MIDI バイトとして残る
- タイムスタンプの値は使わない(受信時刻は Web Bluetooth のイベント時刻を使う)

**段 2: MIDI バイト列の組み立て**(状態はパケットをまたいで保つ)

- 状態: ランニングステータス / SysEx 中か / 組み立て中のデータバイト
- 0xF8〜0xFF(リアルタイム): どこに挟まっても 1 バイトで読み飛ばす。ランニングステータスも組み立て中のデータも保つ
- 0xF0(SysEx 開始): SysEx 中にする。ランニングステータスを解除
- 0xF7(SysEx 終端): SysEx 中を終える
- SysEx 中の bit7 = 0: 読み飛ばす
- **SysEx 中にリアルタイム以外のステータスが来たら、そこで SysEx を打ち切る**(パケット欠けからの復帰)
- 0xF1〜0xF6(システムコモン): ランニングステータスを解除し、データバイトは読み飛ばす
- 0x80〜0xEF(チャンネルメッセージ): ランニングステータスにして、データの組み立てを始める
  - データ長: 0x8n / 0x9n / 0xAn / 0xBn / 0xEn は 2 バイト、0xCn / 0xDn は 1 バイト
- bit7 = 0(データ): ランニングステータスがあれば組み立てに加える。揃ったら 1 メッセージ完成、組み立てをリセット
  (ランニングステータスは保つ)。ランニングステータスが無ければ読み飛ばす
- 完成したメッセージは**既存の `parseMidiMessage` を通して** Note On / Note Off だけを返す
  (velocity 0 の Note On を Note Off とみなす規則を 1 か所に保つ)

### 2. `midi/timestamp.ts`(タイムスタンプ健全性チェック・純TS)

```ts
sanitizeTimestamp(raw: number, now: number): { timestampMs: number; delta: number }
```

- 今の `MidiDeviceInput.sanitizeTimestamp` の中身をそのまま移す(`now` を引数にしてテストできるようにする)
- `MidiDeviceInput` は `performance.now()` を渡して使う。`getLastTimestampDelta` の動きは変えない
- `BleMidiInput` も同じ関数を使う(7.2 のフレーム選択の精度を保つ)

### 3. `midi/webBluetooth.d.ts`(型定義)

- `import` / `export` を書かない**グローバル宣言**にする(`interface Navigator { bluetooth?: Bluetooth }`)
- 宣言するもの: `Bluetooth.requestDevice({ filters: [{ services: string[] }] })`、
  `BluetoothDevice`(`id`, `name`, `gatt`, `gattserverdisconnected` イベント)、
  `BluetoothRemoteGATTServer`(`connect`, `disconnect`, `connected`, `getPrimaryService`)、
  `BluetoothRemoteGATTService`(`getCharacteristic`)、
  `BluetoothRemoteGATTCharacteristic`(`startNotifications`, `stopNotifications`, `value: DataView | undefined`, `characteristicvaluechanged` イベント)
- tsconfig の include(`src`)に入っているので設定変更は不要

### 4. `midi/bleMidiErrors.ts`(エラーの日本語化・純TS)

```ts
type BleConnectStage = "choose" | "connect"  // 機器選択中 / 選択後の接続手順中
toBleErrorMessage(error: unknown, stage: BleConnectStage): string | null  // null = エラー表示しない
```

- `choose` 段階の `NotFoundError`: 利用者が選択画面を閉じた → `null`(エラーにしない)。
  ただしメッセージに Bluetooth アダプタが無い旨が含まれる場合は「この端末では Bluetooth が使えません」
- `connect` 段階の `NotFoundError`: 「この機器は Bluetooth MIDI に対応していません」
- `SecurityError` / `NotAllowedError`: 「Bluetooth の使用が許可されていません。付近のデバイス(または位置情報)の許可を確認してください」
- `NetworkError`: 「キーボードに接続できませんでした。電源と距離を確認して、もう一度お試しください。ほかのアプリがキーボードにつながっていないかも確認してください」
- それ以外: 「Bluetooth での接続に失敗しました: (内容)」

### 5. `midi/bleMidiInput.ts`(接続と配信)

- `BleMidiInput implements MidiSource`(既存インターフェース。判定エンジンは無変更)
- `erasableSyntaxOnly` に従い、enum やコンストラクタ引数の `private x` は使わない
- 状態: `idle` / `connecting` / `connected` / `disconnected` / `error`、機器名、エラーメッセージ。
  状態が変わるたびに購読者(`subscribe(listener)`)へ知らせる
- `static isSupported()`: `navigator.bluetooth?.requestDevice` があるか
- `connect()`(ボタンから呼ぶ):
  - **`requestDevice` の前に `await` を挟まない**(ユーザー操作の有効期限が切れるため)
  - `requestDevice({ filters: [{ services: [MIDI サービス UUID] }] })` → 機器を保持 → 接続手順へ
  - 別の機器を選び直したら、古い機器の `gattserverdisconnected` リスナーを外し、古い接続を切る
  - `gattserverdisconnected` リスナーは機器を選んだときに 1 回だけ登録する
- 接続手順(`connect()` と `reconnect()` で共通):
  - 接続の**世代番号**を 1 増やし、各 `await` の後で世代が変わっていたら(途中で切断・再接続された)結果を捨てる
  - `gatt.connect()` → `getPrimaryService` → `getCharacteristic` → 通知の処理関数を登録 → `startNotifications()`
  - 前のキャラクタリスティックがあれば、先に処理関数を外す(`stopNotifications()` は切断後だと例外になるので try/catch)
  - 解析器(`BleMidiPacketParser`)は接続ごとに作り直す
- `reconnect()`: 保持している機器で接続手順だけやり直す(機器選択は出ない)
- `disconnect()`(画面を離れたときの後始末): 「自分で切った」フラグを立ててから GATT を切り、状態を `idle` にする
- `gattserverdisconnected`: 自分で切った場合は無視。そうでなければ状態を `disconnected`(「切断中」)にする
- 通知の処理関数はクラスのフィールドに固定の参照で持つ(重複登録と外し忘れを防ぐ)
  - `toBytes(value)` → `parser.parse()` → 各 Note On / Off を、`sanitizeTimestamp(event.timeStamp, performance.now())` の時刻で配る

### 6. `midi/compositeMidiSource.ts`(入力源をまとめる・純TS)

- 複数の `MidiSource` を受け取り、`addNoteOnListener` / `addNoteOffListener` を全部に登録し、解除も全部から行う
- 画面側(練習・キャリブレーション)は今の `midi.midiInput` を購読したまま、Web MIDI と Bluetooth の両方を受け取れる
  → **画面のコードは変更しない**(画面側は `midiInput` の固有メソッドを使っていないことを確認済み)

### 7. `components/useMidiDevices.ts`

- `BleMidiInput` を ref で 1 つだけ作り、返す `midiInput` を「Web MIDI 入力 + Bluetooth 入力」をまとめた入力源にする(参照は固定)
- Bluetooth の状態を購読して state に写し、`bluetooth: { supported, status, deviceName, errorMessage, connect, reconnect }` を返す
- 画面離脱時(フックの後始末)に `disconnect()` と購読解除
- 既存の Web MIDI の一覧・選択・再検索はそのまま残す

### 8. `components/MidiDeviceSelector.tsx`

- **Bluetooth の部分は Web MIDI の許可状態(`status`)と関係なく表示する**(Android では Web MIDI の許可を求めずに使うため)
- 「Bluetooth で接続」ボタン(対応ブラウザのみ。「接続中…」の間は押せない = 二重押し防止)
- 状態表示: 「Bluetooth: ◯◯ に接続中」/「切断中」+「再接続」ボタン(+「別の機器を選ぶ」として「Bluetooth で接続」)/「接続中…」/ エラー文 + 「Bluetooth で接続」で再試行
- 非対応ブラウザでは「このブラウザは Bluetooth での接続に対応していません(Chrome をお使いください)」
- ガイド文(仕様書 3.1 訂正後):
  - 常に表示: 「Android タブレットでは『Bluetooth で接続』を押し、一覧からキーボードを選んでください(アプリを開くたびに選び直しが必要です)。一覧に出ないときは、キーボードの電源と、ほかのアプリ・端末につながっていないかを確認してください」
  - Web MIDI 許可後に表示(従来の文を整理): 「Windows / Mac でキーボードが一覧に出ない場合は、『再検索』を押すか、OS の Bluetooth 設定でペアリングを確認してください。Windows では Bluetooth が不安定なことがあるため USB ケーブル接続を推奨します」
- 冒頭コメントの「ペアリング自体は OS 側で行う」を更新

## テスト

- `tests/midi/bleMidiPacket.test.ts`
  - 単音の Note On(ヘッダ + タイムスタンプ + 0x90 60 100)
  - 1 パケットに複数メッセージ(Note On と Note Off、それぞれタイムスタンプ付き)
  - velocity 0 の Note On → Note Off
  - ランニングステータス: タイムスタンプ付き / タイムスタンプなし / 1 パケットに複数タイムスタンプ
  - パケットをまたいでランニングステータスが続く
  - **タイムスタンプの値がステータスに見える**(タイムスタンプ 0x90)
  - リアルタイム(0xF8)がメッセージの前 / **データバイトの間**に挟まる
  - SysEx を読み飛ばす: 1 パケット内 / 複数パケットにまたがる / **終端前のタイムスタンプが 0xF7** / SysEx 中にリアルタイム
  - SysEx の途中に通常のステータスが来たら打ち切って、そのメッセージを読む
  - システムコモン(0xF1〜0xF6)でランニングステータスが解除される
  - ヘッダが不正 / 空 / ヘッダだけ / 末尾がタイムスタンプだけ のパケットで落ちない
  - コントロールチェンジ(0xB0)・プログラムチェンジ(0xC0、1 バイト)は返さず、後続の Note On は正しく読める
  - `toBytes`: byteOffset のある DataView を正しく変換する
- `tests/midi/timestamp.test.ts`: 範囲内はそのまま / 範囲外・0 以下・NaN は now にフォールバック / delta の値
- `tests/midi/bleMidiErrors.test.ts`: 段階ごとの NotFoundError の見分け / 権限 / ネットワーク / その他
- `tests/midi/bleMidiInput.test.ts`(偽の device / server / characteristic オブジェクト。EventTarget で作る)
  - 接続 → 通知でパケットを送ると Note On / Off が届く
  - 再接続してもリスナーが重複しない(1 回の通知で 1 回だけ届く)
  - 自分で切断すると `idle`、機器側の切断イベントで `disconnected`
  - 選択画面を閉じた(choose 段階の NotFoundError)ときは状態が元に戻り、エラーを出さない
- `tests/midi/compositeMidiSource.test.ts`
  - どの入力源からの Note On / Off も購読者に届く
  - 解除すると、どの入力源からも届かなくなる

## 実装手順(作業単位ごとに commit)

1. 仕様書の訂正と本計画を commit
2. `bleMidiPacket.ts` + テスト → commit
3. `timestamp.ts` の切り出し + テスト → commit
4. `compositeMidiSource.ts` + テスト → commit
5. `webBluetooth.d.ts` + `bleMidiErrors.ts` + `bleMidiInput.ts` + テスト → commit
6. `useMidiDevices.ts` / `MidiDeviceSelector.tsx` の組み込み → ブラウザで確認 → commit
7. README(190〜200 行目付近)/ docs/android-check.md(63 行目付近の手順)/ CLAUDE.md 進捗ログ /
   LESSONS.md(前提を実機で確かめずに仕様に書いた失敗)→ commit
8. push(開発者の承認を得てから)→ タブレットで確認を依頼

## 完了条件と検証

- `npm run test` 全件パス / `npx tsc --noEmit` / `npm run build` 成功
- PC ブラウザ(開発者ツールのコンソールに、偽の `navigator.bluetooth` を作るコード片を貼って確認。アプリのコードには入れない):
  1. 「Bluetooth で接続」→ 「接続中」表示
  2. 偽の BLE-MIDI パケット(単音・ランニングステータス)を送ると、判定と参照音が動く
  3. 切断イベントで「切断中」になり、「再接続」で戻る
  4. 既存の Web MIDI の接続とバーチャル鍵盤がこれまでどおり動く
- PC の Chrome で実機のキーボードに接続(開発者に依頼。Windows の Chrome も Web Bluetooth に対応)
- Android タブレット(開発者に依頼):
  1. 「Bluetooth で接続」でキーボードが一覧に出て、選ぶと接続できる
  2. 弾くと音が鳴り、判定が進む
  3. キャリブレーション → 練習で運指判定まで動く
  4. キーボードの電源を切ると「切断中」、電源を入れて「再接続」で戻る
  5. 練習中に切断しても音が鳴りっぱなしにならない
  6. ホーム画面に追加したアプリ(PWA)から開いても接続できる
  7. 別のアプリに切り替えて戻ったときの接続状態

## 技術的な注意点

- 機器側が OS のペアリング済みでも Web Bluetooth で接続できる想定だが、実機で確認する。
  一覧に出ない場合の案内(Android の Bluetooth 設定でペアリングを解除する、など)は実機の結果を見て決める
