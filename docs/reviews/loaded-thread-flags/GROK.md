## Design-delta review（read-only・独立）

**Verdict: Conditionally GO** — 方針は制約とユーザー合意（loaded-only・hosted 非変更）に整合。実装前に下記を設計文へ固定すれば進めてよい。
**未検証:** リポジトリ／`8d644c70`／RQ 版の実コードは見ていない。根拠は本依頼文の Evidence と一般的な React Query 挙動のみ。不確実な点は uncertainty と明記。

---

### Finding 1 — Shared query の options 衝突
**Severity:** High
**Location:** ThreadFlags を `channelMessagesKey(channel.id)` の `enabled: false` observer に差し替える設計箇所（query 登録方法）
**Evidence / uncertainty:** Evidence では `useChannelMessagesQuery(channel)` が window fetch・staleTime/gc・live reconcile を**その key で所有**とある。同じ key に別 observer が別 `queryFn` / `staleTime` / `gcTime` / `queryKey` 派生を渡すと、RQ は observer をマージし、**先勝ち／後勝ちでソース query の既定を書き換えうる**（版依存・未検コード）。`enabled: false` は「自動 fetch しない」であって「options を安全に上書きしない」保証ではない。
**Smallest correction:** Observer は **競合 options を一切渡さない**と明記する。推奨は次のいずれか一つに固定:
1. `queryClient.getQueryData` + cache subscribe（`useSyncExternalStore` 等）のみ、または
2. ChannelScreen と同じ options 工場／同一 hook を共有し、sidebar 側は `queryFn` を定義しない。
受け入れに「observer 追加前後でソース query の `queryFn`／stale／gc／fetch 回数が不変」をテストで縛る（実 `QueryClient`）。

---

### Finding 2 — 行選定は formatter 出力だけ（並列 status ロジック禁止）
**Severity:** High（Acceptance の completion / removal / deletion / edit に直結）
**Location:** 「committed kind9 depth0 roots…」選定ルール、および body／search の入力
**Evidence / uncertainty:** Evidence では `formatTimelineMessages` が active reactions・deletion・authorized edit overlay・root フィールドを集約するとある。raw events から kind/depth/parent や reaction を再判定すると、メイン timeline とずれる。削除後の tombstone 残存有無は**コード未確認**。
**Smallest correction:**
- 入力は常に `formatTimelineMessages(events, channel, currentPubkey, null)` の戻りだけ。
- 行 = formatter 後の root（`kind === 9`・`depth === 0`・parent/root 参照なし・**timeline と同じ「表示対象／非削除」述語**・`pending !== true` を committed と定義）。
- フラグ判定は **その行の `reactions` のみ**（FE0E/FE0F 正規化 → 除去済みは来ない前提 → 両方残る稀例は completion wins → 1 行）。
- body／search も同じ `TimelineMessage` の現行 body。Huddle `resolvedMessages` は使わない（設計どおり）。

---

### Finding 3 — error 時に RQ が残す `data` を行に使わない
**Severity:** Medium
**Location:** 「underlying query error では cached rows ではなく error/pending」「cache reset で clear」
**Evidence / uncertainty:** RQ は `isError` でも前回 `data` を保持しがち。設計意図は正しいが、実装が `data?.map` を先に書くと Acceptance（error で行を残さない）に落ちる。background reconcile 中の `isFetching && data` は行維持が正しいはずで、未指定。
**Smallest correction:** 表示優先順位を設計に書く:
1. mount 条件外 → 非表示
2. `status === 'pending'` かつ data なし → pending UI（行なし）
3. `isError`（または同等）→ error UI（**data があっても行を描かない**）
4. それ以外 → rows
`isFetching` 単独では行を消さない。cache remove/reset 後は data なしで空。subtree を `relay/account/channel` で `key`。

---

### Finding 4 — 旧 ThreadFlags の fetch／timer の残骸
**Severity:** Medium
**Location:** 置換対象の ThreadFlags パネル（pagination／polling／refetch UI／`get_thread_flag_page` 呼び出し）
**Evidence / uncertainty:** ネイティブ拡張は merged だが未 deploy・本パネルからは unused とある。UI 側に旧 poll／page fetch／refetch が残ると Acceptance「no get_thread_flag_page / no extra fetch or timer」に反する。サーバ／command を残す方針自体は可。
**Smallest correction:** パネル経路から page fetch・polling・refetch ボタンを除去（または死コード化）。サーバ／command は互換のため残し、**dormant／not required** と文書化。テストで当該 invoke ゼロを明示。

---

### Finding 5 — loaded-only コピーと 50＋Show more の意味
**Severity:** Low（ユーザー合意済みリスクの文言固定）
**Location:** filter モード文言、リスト上限、Show more
**Evidence / uncertainty:** ユーザーは「ロード済みのみ・全履歴不要」を明示受け入れ。ウィンドウ外の削除／編集／反応は反映されないのは仕様。
**Smallest correction:** UI は「このチャンネルでいま読み込み済みのメッセージ範囲」に限定と明記。件数・「すべて」「履歴全体」を言わない。Show more = **既にメモリ上にある行の表示上限を上げるだけ**（fetch なし）。上限 50 は「表示」であり「フラグ総数」ではない。

---

### Finding 6 — mount／アクセス判定は既存ヘルパに寄せる
**Severity:** Low
**Location:** 「selected nonarchived stream + membership OR open visibility」
**Evidence / uncertainty:** 具体ヘルパ名は依頼文になし（未検）。新ロジックを書くと権限判定が分岐する。
**Smallest correction:** ChannelScreen／sidebar が既に使う membership／visibility／archived／stream 判定をそのまま再利用。desktop-only はエントリ非表示（空パネルをモバイルに出さない）。

---

### Finding 7 — テスト方針（設計として不足している受け入れの足場）
**Severity:** Low（設計欠落というより受け入れの具体化）
**Location:** 検証計画
**Evidence / uncertainty:** 「実 QueryClient の cache 更新」「mocked live message/reaction」「native bundle build」は依頼にあり妥当。
**Smallest correction:** 最低ケースを設計に列挙: cache set で行出現／reaction 追加・除去・completion 優先／削除で行消滅／edit 後 body・search／`isError` で行クリア／key 変更（channel・account・relay）で行非保持／`get_thread_flag_page` 非呼び出し／observer 追加でネットワーク増なし。Huddle 経路非使用。desktop suite + `tsc`/check + sidebar E2E + native bundle。

---

## 制約との整合（問題なし）

| 制約 | 判定 |
|------|------|
| Hosted relay／credentials 非変更 | 適合（クライアントの既存 query 観察のみ） |
| 全履歴サーバ受理の置換 | 適合（ユーザー明示で superseded） |
| 小・可逆・既存 UI・依存追加なし | 適合（旧 native は dormant 残置） |
| ChannelScreen が query／live の権威 | 適合（Finding 1 を守れば） |
| 新 persistent cache／provider／store なし | 適合 |

---

## 実装前に設計へ書き足す一文セット（最小）

1. Passive observer は **shared `channelMessagesKey` の query 定義を変更・再登録しない**。
2. 行・body・search・削除／未完了は **`formatTimelineMessages(..., null)` のみ**；timeline と同じ deleted/pending 述語。
3. **`isError` 時は data 保持中でも行を描かない**；background fetch では消さない。
4. パネルから **fetch/poll/refetch/`get_thread_flag_page` を除去**；server command は dormant 文書化。
5. コピーは **loaded range only**；Show more はローカル表示上限のみ。

---

## 不確実性（このレビューが主張しないこと）

- `enabled: false` が当該プロジェクトの RQ 版で「完全にリクエストゼロ」かの実測
- 削除メッセージが formatter 後にリストから消えるか tombstone か
- community remount／account・relay 切替が常に shared cache を clear するか（設計は「既存 remount に委任」＋ subtree `key` で行保持を防ぐ、で足りる想定）
- `8d644c70` の実差分内容

以上はコード未検のため **uncertainty**。Finding 1–3 を設計に固定したうえで、受け入れテストで実測するのが最小の次手です。
