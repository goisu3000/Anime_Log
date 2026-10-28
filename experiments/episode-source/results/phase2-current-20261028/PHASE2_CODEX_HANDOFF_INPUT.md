# ANI:LOG / Tenrai話数API 第2段階（2026-10-28）

## 基準・目的
- 正本はユーザー報告の実験ブランチ `experiments/tenrai-episode-audit-20261028` コミット `28f31a2fa4cda81ae3a158aa4e6257b965ff7b53`。
- v3はCodex独立テスト12/12 PASS。**v3コードは変更しない**。今回追加するものは試験入力と参考資料のみ。
- 主目的: 2026年10月の *現行放送中TV／続編／全話一括配信ONA* の3ケースに対し、Tenraiで各話・日時が返るか実測する。
- 副目的: 出典に照らしてデータ欠測や矛盾を観測する。「第〇話まで公開」の機能実装やAPI採用の判定はしない。

## 実測サンプル
1. MAL 63337 `FX Senshi Kurumi-chan`（毎週配信・TV、配信先による日差あり）
2. MAL 61987 `Kusuriya no Hitorigoto 3rd Season`（続編・TV・シーズン区切り）
3. MAL 61990 `Cyberpunk: Edgerunners 2`（ONA・2026-10-20 全10話一括公開の制作元発表）

MAL ID/英字タイトルは公開メディア情報から取得。Tenraiが返すタイトルと不一致の場合、ツールの照合を無効化せず、不一致として報告する。`expectedType`が異なる場合も同様。実APIの話数・日付の正確性はまだ不明。

## 実行手順（Codex担当、読み取り専用）
1. 実験ブランチの対象コミットと、既存v3コード3ファイルのSHA256・テスト結果を照合。
2. `PHASE2_CURRENT_SAMPLE.json` を `experiments/episode-source/samples/phase2-current-20261028.json` に追加。既存のサンプルを置換しない。
3. すべての固定テストを**オフライン**で再実行。
4. スクリプト引数を再確認し、以下を一度だけ実行。実HTTP上限は**9件**、開始間隔は**1.5秒以上**、1作品あたり最大2ページ、429/ネットワークエラーで**再試行せず停止**。

```bash
node experiments/episode-source/audit-tenrai.mjs \
  --sample experiments/episode-source/samples/phase2-current-20261028.json \
  --max-pages 2 --max-requests 9 \
  --out experiments/episode-source/results/phase2-current-20261028
```

5. `RESULTS.json` / `RESULTS.csv` / `REVIEW.md` の数値と本文が一致するか二重チェック。とくにID、タイトル、`requestedPages`、`complete`、`lastIndexedEpisode`、`missingDate`、`notRequested`、`stoppedReason`、HTTP試行回数を確認。
6. 3作品の公式参照URLを読み取り、実際の情報源が保証している事実だけを比較表へ記載。**制作元が全10話公開を明示したケースと、単に週次スケジュールが公開されているケースを区別すること。**
7. 無理に成功にしない。`publishedThrough` が `null` のままなのは正しい。`aired` 日付が過去でも実配信済みの証拠とはしない。
8. 結果のレポートとサンプル、参照資料だけを実験ブランチにcommit/push。**main・Vercel・index.html・保存・同期関連ファイルは変更しない。**

### 公式の参照資料
- FX戦士くるみちゃん: https://fxkurumi-info.com/onair/ （放送と配信サービスごとの予定に時差）
- 薬屋のひとりごと3期: https://kusuriyanohitorigoto.jp/season3/onair/ （金曜放送、土曜順次配信）
- Cyberpunk: Edgerunners 2: https://www.cdprojekt.com/en/media/news/cyberpunk-edgerunners-2-premieres-on-netflix-new-update-announced-for-cyberpunk-2077/ （2026-10-20にNetflix全10話公開と明記）

## 成功・失敗の判定
- `HTTP 200` やページ取得成功は**通信の成功**。話数の公開精度の成功ではない。
- `ID_TITLE_MATCH`、`complete`、欠測・日付、公式参照の整合性を分けて報告。
- **正しい「公開済み」の推論ができると決めつけない**。各話の正確な公開保証については別判断。
- 9件を使い切ったらそこで終了。未取得の作品は `notRequested` に残してよい。追加通信・リトライは**事前相談なしに実施しない**。
- 公式サイト側に今の公開済み話数の記載がない場合は `未確認`。推測で埋めない。

## Codexの作業範囲
Codexは、**監査コードを修正しない**。コードに欠陥を発見したらpushを保留し、再現条件をChatGPTへ返す。通信が安全に完了した場合だけ、実験ブランチに結果を保存する。

## 終了報告フォーマット
- 最新実験ブランチコミットID・変更ファイル一覧
- 実Tenrai API HTTP試行回数・429数・失敗数・最小開始間隔
- 作品ごとの MAL ID一致 / 総取得話数 / 最大話数 / 日付欠損 / ページング完結 / 公式照合内容
- 未取得・不一致・実APIの制約
- `第〇話まで公開` の判定に**十分か／不十分か**（不足理由を明示）
- 本番・既存コードの変更はなかったことの確認
