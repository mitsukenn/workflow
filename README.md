# Workflow Board

業務フロー・業務棚卸しのための、**カード＋接続線**のシンプルなビジュアルボード。
Excel・Word・PDF・フォルダ・リンクを「カード」として並べ、矢印で繋いで、付箋でメモを残すだけ。

- **完全ローカル動作**：バックエンドなし、データはブラウザのlocalStorageに保存
- **URL共有**：盤面をURLに埋め込んで、リンク1本で他の人に送れる（サーバ不要）
- **AI連携**：Claude などに業務を説明 → JSONを貰って貼り付けで盤面生成
- **画像/JSON書出**：PNG・SVG・JSONでエクスポート可

## デモ

公開URL：`https://mitsukenn.github.io/workflow/`
（GitHub Pages へのデプロイ手順は後述）

## 使い方（基本）

1. ヘッダの「Excel / Word / PDF / フォルダ / リンク / その他」からカードを追加、またはファイルをドラッグ&ドロップ
2. カードをドラッグして配置
3. 「接続」ボタンで2つのカードをクリックして矢印を引く → クリックでラベル編集
4. 「メモ」で付箋を追加（カードを選択中なら自動で紐付け、一緒に動く）
5. 盤面は自動で保存される（ブラウザのlocalStorage）

## 共有のしかた

| 方法 | 用途 |
|---|---|
| **共有リンク** | URLをコピーして送る。相手はブラウザで開くだけ。小〜中規模盤面に最適 |
| **JSON書出/読込** | ファイルで渡す。大きな盤面や恒久保存向き |
| **PNG / SVG** | 画像として共有。資料やプレゼンに |

> 共有リンクはURLに圧縮データ（lz-string）を埋め込んでいます。
> URLが長くなりすぎた場合（8,000文字超）は警告が出ます。その時はJSON書出で送ってください。

## AI（Claude等）と併用するとき

このリポジトリには、業務ヒアリング用の対話スキル `workflow_interview_skill_v1.0.md` が同梱されています。
Claude Code などに読み込ませると、1問1答で業務を整理 → Workflow Board 用の JSON を出力してくれます。
出力されたJSONを「AI / JSON 取込」ボタンから貼り付けると、自動レイアウトで盤面化されます。

## 開発

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ に本番ビルド
npm run preview  # ビルド結果のローカル確認
```

## GitHub Pages へのデプロイ

1. GitHubでリポジトリを作る（例: `workflow`）
2. このディレクトリを push

   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/workflow.git
   git push -u origin main
   ```

3. GitHub の該当リポジトリ → **Settings → Pages → Build and deployment → Source** を「**GitHub Actions**」に変更
4. main に push するたび、`.github/workflows/deploy.yml` が自動でビルド＆公開します
5. 数十秒後、`https://<your-username>.github.io/<repo-name>/` で公開されます

### リポジトリ名が `workflow` 以外のとき

`vite.config.js` の `base` を合わせるか、GitHub Actions の環境変数 `BASE` を設定してください。

```yaml
# .github/workflows/deploy.yml の build ステップに追加
env:
  BASE: /your-repo-name/
```

## ライセンス

[MIT](./LICENSE)
