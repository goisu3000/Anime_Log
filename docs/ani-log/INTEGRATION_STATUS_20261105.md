# 保守ルール導入候補の照合記録

担当：Codex。2026-11-05（日本時間）。本資料はローカル別ブランチの準備記録であり、push・mainへのマージ・Vercel配備の承認ではありません。

## 正本と変更範囲

- 基準main：`de5b11a0b98061b2dc3d26513d5a4b110693e536`（v2.4.86、コピーボタンの幅だけを変更した公開版）。
- ブランチ：`codex/maintenance-rules-20261105`。
- 既存のAGENTS.md・docs・.vercelignoreはなし。同名の既存資料を上書きしていません。
- 製品66ファイル（vercel.jsonを含む）のGit内容は不変。製品コード、CSS、保存・同期、公開設定のvercel.jsonは変更しません。
- FILE_MAP.csvの66件は基準GitコミットのSHA-256と全件一致。台帳はこのコミットのスナップショットです。将来のmainを文書に合わせて戻さないでください。
- 提供元のZIPとハッシュ一覧はリポジトリへ追加せず、外側の作業領域に保管。

## 資料だけの補正

- STARTUP_AND_RELEASE_CHECKLIST.mdの旧ファイル名2件を、実在するDESIGN_GUIDELINES.mdとMAINTENANCE_AND_RELEASE.mdへ修正。
- DESIGN_GUIDELINES.mdの旧表記「不一致を解消」を、現行formal-simple-page.mjsの文言「不一致を確認」に修正。実製品のUI文言は変更していません。
- 原則の追加・包括的な作業許可はしていません。現在のユーザー指示、正規権限、システム制約を優先します。

## Codexの参照

AGENTS.mdをGitルートへ配置し、この作業で読み取りました。文書サイズ3569 bytes、参照先7ファイルは全件実在・可読です。ルートにAGENTS.override.mdはありません。

公式の探索方式では、セッション開始時にGitルートから作業ディレクトリまでのAGENTS.mdを読み込みます。次回はこのworktree（または正式導入後のリポジトリ）を作業フォルダとして開いてください。既に開始済みの別フォルダのチャットへ自動で追加済みとは扱いません。別のCodexプロセスを起動した読込み試験は実施していません。

参考：https://learn.chatgpt.com/docs/agent-configuration/agents-md

## Vercel配信除外

新規.vercelignoreで、AGENTS.md、docs/、ルートtests/、.vercelignore自身を除外します。`client/*test-only*.mjs`等の製品依存ファイルを名前で除外しません。

PRODUCT_RELEASE_ALLOWLIST.jsonには基準コミットの製品66ファイルとGit原本SHA-256を記録。Windowsのチェックアウト時の改行変換とは区別します。

公式の除外ファイル仕様と同じパターンを使い、ローカルではGit ignore構文を利用して製品66件を全て残し、保守資料を全て除外することを検査します。ただし、Vercelの現行Git連携に新ブランチを配備した確認ではありません。本番で除外済みとは報告しません。

参考：https://vercel.com/docs/deployments/vercel-ignore

## 正式導入前の操作

1. この文書差分と.vercelignoreを承認する。
2. ブランチpushを別途承認する。VercelのGit連携によりPreviewが生成される可能性も含めて扱う。
3. Previewの配信物が製品許可リストと一致し、/AGENTS.md、/docs/ani-log/MAINTENANCE_AND_RELEASE.md等が404になり、/client/と/notice/と既存Rewriteが正常であることを確認する。除外されなければマージをSTOPする。
4. mainへのマージと、自動Production配備の承認を得る。merge直前にmainの追加変更を再確認する。
5. 配備後にも資料非公開と製品内容の不変を読み戻す。

今回の準備ではpush・merge・deploy・Cloudflare変更・個人データ操作を行いません。
