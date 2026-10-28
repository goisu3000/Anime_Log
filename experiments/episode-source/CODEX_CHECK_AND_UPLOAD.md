# Codex向け：二重チェックと成果物アップロードのみ

## 指示の優先順位

1. **添付元ZIP `ANI-LOG_OFFICIAL_SOURCE_v2.4.84_COMPACT_COMPLETION_PUBLISHED_20261028.zip` が正本。** 現在のGitHub mainに後続変更があれば、差分・経緯を確認し、古いファイルで上書きしない。
2. 今回ChatGPTが新規制作したのは `experiments/episode-source/` と `tests/test-episode-source-audit.mjs` だけ。**index.htmlその他の公開用ファイルには一切変更なし。**
3. Codexには**新機能の実装を頼まない**。二重チェック・API実通信での読み取り検査・結果の保存・アップロードのみ。
4. **本番のVercel画面を変更しない。** 正確な公開話数は未検証なので新着通知は導入禁止。アップロード先はリポジトリの実験用ブランチ・テスト成果物。利用者の個人データには触れない。

## 確認手順

```bash
node scripts/build.mjs --verify-published
node tests/test-episode-source-audit.mjs
node experiments/episode-source/audit-tenrai.mjs --sample experiments/episode-source/samples/fixture-sample.json --fixture experiments/episode-source/fixtures/mock-tenrai.json --out validation/episode-source-fixture
node experiments/episode-source/audit-tenrai.mjs --sample experiments/episode-source/samples/tenrai-mal-ids.json --max-pages 2 --out validation/episode-source-live
```

- Node 24以上を推奨（元のpackage.jsonに合わせる）。
- `audit-tenrai` は**読み取り専用**。最大30作品、1.25秒以上の逐次取得、1作品当たり既定最大2ページ（上限4）。429時はRetry-Afterで待機し、過剰なリトライは行わない。
- API接続が失敗した場合、`RESULTS` を失敗として残し、成功したと偽らない。既存本番APIをリトライで叩き続けない。
- 公式作品ページによる検証はテスト結果とは別の工程。`aired` と現在日時だけで実際の配信開始や公開済みを確定しない。
- **現行のAniList週間カレンダーを消さない。** この実験は置換を承認するものではない。
- 旧テスト一式は既存59公開ファイルの完全一致により非回帰が確認できるが、可能ならフル回帰も実行。失敗・時間制限があれば正直に報告。

## CodexからChatGPTへ返す報告

- 完成検証結果（ビルド、fixture、API実通信、JSONスキーマ、429対策）
- `validation/episode-source-live/RESULTS.csv`, `RESULTS.json`, `REVIEW.md`
- 実行時のAPI通信数、429/失敗数、最終ページに達しなかった作品
- 公式公開情報との照合ができた作品と出典URL（未照合は未照合とする）
- 書き換わったファイル一覧と元正本とのSHA256相違（公開ソース改変0件が期待値）
- GitHub実験用ブランチ名、コミットID、アップロードした成果物の場所
- **本番公開・本番データ変更を行っていないこと**

最終的に話数の精度と規約上の要件が満たせたら、次段階でChatGPTが `index.html` の新着表示や週間カレンダーの統合作業を行う。Codexにその新規実装を任せない。
