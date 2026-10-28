# ANI:LOG 話数新着・API置換 検証パッケージ（非公開）

## 目的と状態

最新版の `ANI-LOG_OFFICIAL_SOURCE_v2.4.84_COMPACT_COMPLETION_PUBLISHED_20261028.zip` を**一切上書き・変更しない**形で、TenraiのエピソードAPIが新着通知とAniList週間カレンダー置換の候補になり得るか、読み取り専用で検証します。

- **本番機能は未実装・未公開**。UIは別ファイル `PREVIEW_ONLY.html` の架空データによる画面確認です。
- 外部APIの実応答をこの生成環境から取得できませんでした。実APIでの評価・作品公式ソースでの照合・TMDB比較は未実施です。
- 個人の作品登録データ、同期、認証、WAL、Cloudflare、Vercelに触れません。
- `index.html`, `client/`, `src/`, `scripts/build.mjs` 等の元ソースは**バイト不変**です。

## 何が完成したか

1. `episode-audit-core.mjs`：応答の話数・日付・ページ欠損を検査する純粋関数。**日付経過から「公開」を断定しない**。
2. `audit-tenrai.mjs`：最大30作品の読み取り専用の少数逐次取得ツール。既定最大2ページ/作品（上限4）、1.25秒以上の間隔、429時の待機、タイムアウト、JSON/CSV/Markdownレポート作成。
3. `samples/tenrai-mal-ids.json`：初期12作品の公開MAL IDサンプル。TV/長期/映画を含み、導入前には今期放送作品・Web限定・延期作を追加して20〜30作品に拡充すること。
4. `samples/official-verification-template.json`：実際の公開事実を公式ソースURLで照合するための記録様式。
5. `PREVIEW_ONLY.html`：右カラムのステータス直下の新着・既読デザインの操作可能な独立試作。
6. `tests/test-episode-source-audit.mjs`：オフラインfixtureに対する厳密な分類と状態遷移のテスト。

## コマンド

Node.js v24以降。依存パッケージ追加なし。

```bash
node tests/test-episode-source-audit.mjs
node experiments/episode-source/audit-tenrai.mjs --help
# オフライン動作確認（API通信0）
node experiments/episode-source/audit-tenrai.mjs --sample experiments/episode-source/samples/fixture-sample.json --fixture experiments/episode-source/fixtures/mock-tenrai.json --out validation/episode-source-fixture
# 実APIに接続できる環境のみ。約1秒間隔で取得、最大2ページ/作品。
node experiments/episode-source/audit-tenrai.mjs --sample experiments/episode-source/samples/tenrai-mal-ids.json --out validation/episode-source-live
```

## 採否判定（厳格）

- `pastDatedMaximum` は**公開済み最大話数ではありません**。表示の証拠として使用しない。
- 公式放送・配信ページと、最新話数・シーズン・公開日を照合し、誤り0件を目標とする。単独のAPIを正解とみなさない。
- 初回読み込みで過去話をすべて新着としない。クリック既読か最新話までの視聴で消えるが、話数データと確認状態は別に管理する。
- 欠測・ページ未取得・遅延・誤照合・一致未確認なら表示しない。
- 必須UI制約：PC2列カードの高さを増やさず、視聴状況のすぐ下に1行表示。新着は黄色、既読は「第N話まで公開」を白。WebとTV両方に適用可能な正しい公開根拠を確保。
- カレンダーを開かなくても新着が取得できる必要があるが、既存APIの重複取得やAPI負荷を増やさない設計とする。
- 既存AniList利用の規約懸念は未解消。代替の品質が確認できるまで、単純に一括削除しない。

## Codexの役割

Codexは **作業済みコードの二重チェック、実ネットワーク上の読み取り専用試験、成果物アップロード係**。新しい機能実装をCodexに丸投げしないこと。

重要: 本ファイルはAPI品質検証用であり、新着通知の公開を承認するものではありません。実APIが正確でないと分かった場合はAPIを変更する提案のみ報告し、勝手に本番公開しないでください。
