# ANI TenraiエピソードAPI 二重チェック結果・ChatGPT引き継ぎ

## 結論

実験の取得・CSV/JSON/Markdown出力は動作しました。ただし、公開済み話数や新着通知の根拠として採用できる状態ではありません。日付から公開済みを断定しません。新着通知もAniList置換も未実装・未公開です。

## 正本・不変確認

- GitHub main基準: 6c406e9d5ea116f70457b0e57b7671b4be49d368
- 添付元の正式ソースZIP368エントリすべてバイト一致、新規11ファイルのSHA-256/サイズ全一致。公開59ファイル不変。
- 提供された実験コードは編集していません。修正はChatGPT側へ戻します。
- Build --verify-published / 対象固定テスト / 固定fixture CSV・JSON・Markdown / JS構文: PASS。無関係な全面回帰は未実施。

## 実通信（読み取り専用）

- 3作品、計7 GET（作品照合3、エピソード4）、すべてHTTP200。429=0、失敗=0。最短開始間隔1500ms。追加取得なし。
- 通信の実数: ../episode-source-live/HTTP_TELEMETRY.json。RESULTSのrequestCount=4はエピソード取得だけの値です。
- 元の12作品のうち残り9作品は低頻度・少数検証のため未実施。今期/Web限定/延期/分割クールは未検証。

|作品/MAL ID|取得結果|不足・解釈|
|---|---|---|
|鋼の錬金術師 FULLMETAL ALCHEMIST /5114|1ページ64話、1〜64連続、日付欠測0|APIメタデータ64話と一致。実公開の公式裏付けは未照合|
|ONE PIECE /21|2ページ200話、1〜200連続、日付欠測0|全12ページ中2ページのみ。残り10ページ未取得、最新話数は不明|
|千と千尋の神隠し /199|HTTP200、エピソード一覧0件|作品メタデータは映画・1話。映画の空一覧を、HTTP失敗や誤作品と断定しない|

3件とも要求ID・返却ID・日本語タイトル一致。シーズン単位の誤照合を一般的に防ぐ仕組みはCLIにありません。作品公式放送/配信ページ照合は0件（未実施）。公開済み確認も0件です。

取得できた264行の範囲では日付欠測0・話数番号欠測0。ただし、未取得のONE PIECE後半と映画の空一覧を「欠測なし」と扱いません。

API根拠: [5114作品](https://api.tenrai.org/v1/anime/5114)、[5114話数](https://api.tenrai.org/v1/anime/5114/episodes?page=1)、[21作品](https://api.tenrai.org/v1/anime/21)、[21話数ページ2](https://api.tenrai.org/v1/anime/21/episodes?page=2)、[199作品](https://api.tenrai.org/v1/anime/199)、[199話数](https://api.tenrai.org/v1/anime/199/episodes?page=1)。いずれも作品公式の公開証明ではありません。

## ChatGPTへ返すコード上の問題（未修正）

1. audit-tenrai.mjs / runAudit: 429→成功の2回通信でもrequestCountは1。再試行回数や429回数を別途数える必要があります。
2. fetchTenrai: Retry-After=0で直ちに再試行でき、作品/ページ間の1250ms間隔を迂回します。
3. retryAfterMs: 120秒指定を60秒に短縮し、HTTP-date形式は5秒へフォールバック。指定待機を守るか再試行せず停止する設計が必要です。
4. episode-audit-core.mjs / assessEpisodes: duplicates>0やmissingNumber>0でもSCHEDULE_ONLYになり得ます。品質の判定・注意表示を見直してください。
5. runAuditはサンプルのtitleをそのまま使い、作品ID/タイトル/シーズンの照合を行いません。今回3作品は別途メタデータGETで照合しました。
6. 映画の空配列がNONCONSECUTIVE_EPISODESになります。正当な空応答・対象外・取得不足を区別する検討が必要です。

再現結果: SAFETY_PROBES.json（すべて偽応答、追加実通信0）。今回の実通信は変更しない提供モジュールのfetchFn差し込み口を利用し、外側の監視で1500ms間隔・最大8回・失敗時停止を保証しました。この保護は元ツールに実装済みであるという意味ではありません。

## アップロード

- ブランチ: experiments/tenrai-episode-audit-20261028
- 対象: 提供されたexperiments/episode-source、対象テスト、新規ファイルマニフェスト、validation配下の固定/実通信/監査成果物のみ。元の公開ファイルはすべて不変。
- 本番mainへのpush、本番Vercelデプロイ、Worker/D1/KV・実記録・資格情報の操作は行いません。
- コミットIDはアップロード結果票・Git履歴を参照してください。
