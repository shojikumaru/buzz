## モデル同一性

- **実際 (actual)**: `claude-opus-5`（Opus 5）— 本セッションの環境が明示している値。
- **要求 (requested)**: 供給されたコンテキストに露出していません。どの席モデルを指定して発注したかは私からは確認できないため、「Opus 席を要求した」ことの照合は発注側で `actual:` を突合してください（profile fallback で黙って別モデルになる既知の罠があるため）。

---

## 先に「確認できた」こと（再検証の重複を避けるため）

- **`formatTimelineMessages` の位置引数は 9 個で正しく整列**。`events, channel, pubkey, null(avatar), profiles, memberData, undefined(persona), undefined(respondTo), relayIdentity` で、`ownerProfiles` のみ省略。オフバイワンなし。
- **`EMPTY_EVENTS` / `EMPTY_AGENTS` / `EMPTY_RELAY_AGENTS` のモジュール定数化は機能上必須**（レンダごとに新配列だと `useMemo`→`keys`→`useSyncExternalStore` の getSnapshot 同一性が毎回変わる）。正しく効いています。
- **`["profile"]` / `["managed-agents"]` のような非名前空間キーの prefix 誤マッチは起きない**。テストが `gcTime` を使っていることから TanStack Query v5 系であり、v5 の `getQueryState` は queryHash による完全一致。v4 の partial match 問題は該当しません。
- **受動性の証明が成立**。`setup(null)` 時点で `getQueryCache().getAll().length === 0` を主張しており、これは messages / members / relaySelf / profile / managed-agents の 5 経路すべてが「読むだけでクエリを作らない」ことを一度に押さえています。加えて `queryFn`/`staleTime`/`gcTime` 不変・observer 0・invalidate/focus/online で fetch 0。
- **新規のネットワーク・クエリ・タイマー・永続化は無し**（`setTimeout`/`setInterval`/storage 参照なし）。
- **スコープ再マウントによる状態リセット**（mode/query/limit）はテストで実証済み。
- **所有権テストの敵対系が良質**。relaySelf 除去で「actor タグを持つだけの未信頼イベントは actor にならない」を押さえ、キャッシュ欠落・偽署名者はいずれも fail-closed（元本文に戻る）。

---

## 指摘

### F1 — 検証未了（Blocker: merge 不可、コードの欠陥ではない）
- **場所**: 検証申告
- **根拠**: 「Full Desktop + final E2E are RUNNING, not counted as passed」。直前の `just ci` はこの新規テストヘルパーで赤、修正版は未実行。
- **最小の是正**: 3 本（Desktop 全体 / 最終 E2E / `just ci`）の完走と exit code を PR 本文に添付。RUNNING のまま GO を出さない。

### F2 — 本番側の書き手が未実証（Major・ただし fail-closed）
- **場所**: `useLoadedProfiles.ts`（`usersBatchEntryKey` 読み出し）
- **根拠**: 所有権テストはすべて自前の `setQueryData(usersBatchEntryKey(agent), …)` で種を撒いています。本番の `useUsersBatchQuery` が実際に **per-user エントリを、しかも同じ正規化キーで** 書いている証拠は、供給された木の中に一つもありません。読み手は `collectMessageAuthorPubkeys` の正規化済み pubkey で引き、`identity.ts` の `getResolvedProfile` も `normalizePubkey` で引くので、書き手が非正規化キーで書いていると恒久ミス。
- **影響**: 外れても「owner edit が反映されない」だけで、承認されていない編集が通ることはない（許容済み制約に縮退）。ただし本デルタの価値そのものが未証明。
- **最小の是正**: `useUsersBatchQuery` の書き込み行を読み、キー生成と `{summary, fetchedAt}` 形状を PR 本文に引用。

### F3 — 共有キー採用側が未提示（Major・証拠欠落）
- **場所**: `channelMembersKey.ts` は提示されたが、`useChannelMembersQuery` 側は未提示
- **根拠**: 「owner が同じキーを使い、shape/key 変更なし」は申告のみ。型チェックは import の存在しか保証しません。
- **最小の是正**: owner 側の `queryKey:` 行を 1 行引用。

### F4 — root 判定の `rootId` 項が未検証（Minor）
- **場所**: `loadedFlags.ts` の `depth !== 0 || parentId || rootId`
- **根拠**: 正規フォーマッタが「reply 以外の `e` タグ（引用・mention）を持つ root」に `rootId` を付けるかどうかが供給ソースから確認できません。付けるなら、フラグ付きの引用ルートが黙って一覧から消えます（false negative）。テストの orphan/reply ケースはこの分岐を区別しません。
- **最小の是正**: フォーマッタの `rootId` 付与規則を確認し、`depth`/`parentId` で root 性が決まるなら該当項を落とす。**確認前に消さない**。

### F5 — フィルタ網羅の穴（Minor）
- **場所**: `ThreadFlags.test.mjs`
- **根拠**: 5 モードのうち `coordinate` と `all` が一度も選択されておらず、`complete` モード内での検索（要件「searchable completed」）も未主張。
- **最小の是正**: 既存テストに `selectOption("coordinate")` / `("all")` と、complete モードでの検索 1 件を追加（新規ファイル不要、3〜5 行）。

### F6 — テストクライアントの取りこぼし（Minor・衛生）
- **場所**: 「channel changes and community/account QueryClient remounts」テスト内の `new app.QueryClient()` 2 箇所
- **根拠**: `clients` に push されないため `afterEach` の `client.clear()` を素通りします。現状は当該クライアントにクエリが一つも作られないため無害ですが、GC タイマー掃除の意図が将来 seed を足した瞬間に破れます。
- **最小の是正**: `const next = new app.QueryClient(); clients.push(next);` に置換。

### F7 — 「不在キーを読んでも生成しない」の主張が 1 段弱い（Minor）
- **場所**: 所有権テストの `removeQueries(usersBatchEntryKey(agent), exact)` 直後
- **根拠**: 直後の主張は「元本文に戻る」と末尾の observer 0 のみで、`useCachedQueries` が不在キーを読んだ結果クエリを再生成していないことは明示されていません。
- **最小の是正**: `assert.equal(app.client.getQueryCache().find({ queryKey: usersBatchEntryKey(agent), exact: true }), undefined)` を 1 行追加。

### F8 — 継承挙動（Nit・**変更しないことを推奨**）
- **場所**: `mergeAgentNamesIntoProfiles` の `ownerPubkey: merged[key]?.ownerPubkey ?? currentPubkey ?? null`
- **根拠**: `ownsAuthorAgent` の doc コメント自身が「ローカル managed-agents はサーバ側所有権と乖離しうるので所有判定に使うな」と警告している一方、この merge はローカル一覧に載っているだけの agent に現在ユーザを owner として付与します。結果、その agent 作の root に対する自分署名の編集がサイドバーで採用されうる。
- **判断**: これは ChannelScreen が通す正規パスと同一であり、**サイドバーだけ挙動を変えると本文がタイムラインと食い違うほうが害が大きい**。デルタ由来の欠陥ではありません。是正不要。将来のレビュアが「サイドバー側だけ直す」ことを防ぐため記録として残します。

### F9 — 計算コスト（Nit）
- **場所**: `ThreadFlags.tsx` の `timeline` memo、`useCachedQuery*` の `cache.subscribe`
- **根拠**: アクティブチャンネルのロード済み全件に対して `formatTimelineMessages` が ChannelScreen と二重に走ります。また subscribe が無フィルタなので、アプリ内の**任意の**クエリ更新ごとに著者数 N 件の `getQueryState`（毎回キーのハッシュ化）が回ります。スナップショット比較で再レンダは抑止されており、ネットワーク影響はゼロ。
- **最小の是正**: 実測でホットなら `cache.subscribe` 内で対象 queryHash に絞る。現時点で必須ではありません。

### F10 — 意図の明文化漏れ（Nit）
- **場所**: `useLoadedProfiles.ts` の `EMPTY_RELAY_AGENTS`
- **根拠**: ChannelScreen と入力が意図的に食い違う箇所ですが理由が無記名。relayAgents の merge は `ownerPubkey` を設定しない（表示名と `isAgent` のみ）ため編集認可には影響せず、パネルは本文しか読まないので安全 — という判断が読み手に見えません。
- **最小の是正**: 1 行コメント。

### F11 — E2E の当該アサーションは空証明（Nit）
- **場所**: `thread-flags.spec.ts` の `__FLAGS_EXTENSION_CALLS__ === 0`
- **根拠**: frontend `api.ts` を削除し呼び出し元が存在しない以上、パネルが壊れていても 0 になります。回帰ガードとしては有用ですが、「loaded-only である」ことの証拠には数えないでください。実質の証拠はリアクション追加/削除・完了非表示・削除反映・返信除外の各主張です。
- **最小の是正**: なし（証拠の重み付けの申し送りのみ）。

### 補足（欠陥ではない観察）
- E2E 末尾の削除は `__BUZZ_E2E_EMIT_MOCK_MESSAGE__` に `kind` / `extraTags` を渡していますが、`installMockBridge` 側が未提示のため両引数の対応は未確認です。仮に無視されても root ボタンは消えず **アサーションが落ちる**（偽陽性にならない）方向なので、リスクは低い。
- `{pages: []}` を不正形状として alert に落とす guard は、将来 messages クエリが infinite 化した際に静かに空表示になるのを防いでおり、良い設計です。

---

## 判定

**CONDITIONAL GO**（コードは GO、証拠が未了）

- 供給範囲において、目標（アクティブチャンネルのロード済みのみ・root フラグ・☑ で active から隠す・completed を検索可・追加のネットワーク/クエリ/タイマー/永続化なし・クエリオプション不変・既存キャッシュと正規フォーマッタの利用）に反する**ブロッキング欠陥は見つかりませんでした**。前回懸念（共有 member キー、所有権メタデータ、エラー data 無視、ヘルパーの spread 順、E2E の削除経路、ID 衝突）はいずれも供給コード上で解消を確認できます。
- **merge の条件は 3 点**: ①F1（Desktop / 最終 E2E / `just ci` の完走と緑）、②F2（`useUsersBatchQuery` の書き込み行の引用）、③F3（`useChannelMembersQuery` の queryKey 行の引用）。
- F4 は merge 前に 1 回ソースを読んで白黒つけることを推奨（読むだけ・コード変更を伴わない可能性が高い）。F5〜F7 は同一 PR 内の数行で閉じられるので同梱推奨、F8〜F11 は据え置きで構いません。
- 私は独立レビュー 1 席であり、self-approve にはなりません。最終 GO は他席の指摘と併せて証拠で裁定してください。
