# 保守ルール導入候補の照合記録

担当：Codex。2026-11-05（日本時間）。本資料は別ブランチの導入準備記録です。今回のユーザー指示は作業ブランチのpushとPreview検証までを承認しています。mainへのマージ・Production配備は対象外です。本資料自体は将来の変更への承認ではありません。

## 正本と変更範囲

- 基準main：`de5b11a0b98061b2dc3d26513d5a4b110693e536`（v2.4.86、コピーボタンの幅だけを変更した公開版）。
- ブランチ：`codex/maintenance-rules-20261105`。
- 既存のAGENTS.md・docs・.vercelignoreはなし。同名の既存資料を上書きしていません。
- 製品66ファイル（vercel.jsonを含む）のGit内容は不変。製品コード、CSS、保存・同期、公開設定のvercel.jsonは変更しません。
- FILE_MAP.csvの66件は基準GitコミットのSHA-256と全件一致。台帳はこのコミットのスナップショットです。将来のmainを文書に合わせて戻さないでください。
- 提供元のZIPとハッシュ一覧はリポジトリへ追加せず、外側の作業領域に保管。

## 資料だけの補正

- STARTUP_AND_RELEASE_CHECKLIST.mdの旧ファイル名2件を、実在するDESIGN_GUIDELINES.mdとMAINTENANCE_AND_RELEASE.mdへ修正。
- DESIGN_GUIDELINES.mdでは、承認済みの目標文言「不一致を解消」と、現行製品の入口表示・案内文「不一致を確認」を別欄に記録。以前の単純置換を訂正し、現行表示だけを理由に承認済み仕様と同一視しません。製品への目標文言反映は今回の対象外です。
- 原則の追加・包括的な作業許可はしていません。現在のユーザー指示、正規権限、システム制約を優先します。

## Codexの参照

AGENTS.mdをGitルートへ配置し、この作業で読み取りました。文書サイズ3569 bytes、参照先7ファイルは全件実在・可読です。ルートにAGENTS.override.mdはありません。

このworktreeを作業ディレクトリに指定した新規Codex CLIセッション（read-only、ephemeral）で自動読み込みを確認しました。確認プロンプトには個別ルール・資料名を与えず、ツールやファイル読取りを禁止した状態で、AGENTS.mdの重要ルール3件を原文どおり回答し、参照先7件を列挙しました。参照先の実在・可読性は別途確認しています。

公式の探索方式では、セッション開始時にGitルートから作業ディレクトリまでのAGENTS.mdを読み込みます。次回はこのworktree（または正式導入後のリポジトリ）を作業フォルダとして開いてください。既に開始済みの別フォルダのチャットへ自動で追加済みとは扱いません。

参考：https://learn.chatgpt.com/docs/agent-configuration/agents-md

## Vercel配信除外

新規.vercelignoreで、AGENTS.md、docs/、ルートtests/、.vercelignore自身を除外します。`client/*test-only*.mjs`等の製品依存ファイルを名前で除外しません。

PRODUCT_RELEASE_ALLOWLIST.jsonには基準コミットの製品66ファイルとGit原本SHA-256を記録。Windowsのチェックアウト時の改行変換とは区別します。

公式の除外ファイル仕様と同じパターンを使い、ローカルではGit ignore構文を利用して製品66件を全て残し、保守資料を全て除外することを検査します。ただし、Vercelの現行Git連携に新ブランチを配備した確認ではありません。本番で除外済みとは報告しません。

参考：https://vercel.com/docs/deployments/vercel-ignore

## 正式導入前の操作

1. この文書差分と.vercelignoreを確認する。
2. 承認済みの作業ブランチだけをpushする。VercelのGit連携によりPreviewが生成される可能性も含めて扱う。
3. Previewの配信物が製品許可リストと一致し、/AGENTS.md、/docs/ani-log/MAINTENANCE_AND_RELEASE.md等が404になり、/client/と/notice/と既存Rewriteが正常であることを確認する。除外されなければマージをSTOPする。
4. mainへのマージと、自動Production配備の承認を得る。merge直前にmainの追加変更を再確認する。
5. 配備後にも資料非公開と製品内容の不変を読み戻す。

Previewの実測結果はpush後の外部検証記録で報告します。mainへのマージ・Production配備・Cloudflare変更・個人データ操作は行いません。
