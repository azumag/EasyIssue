# EasyIssue

Xやブラウザで見つけた内容を、登録済みのGitHubリポジトリへ素早くIssueとして送るための小さなWebアプリです。

## 初期実装でできること

- GitHub OAuthでログインし、Issueをユーザー本人として作成
- よく使うリポジトリを端末ごとに登録
- タイトル、本文、ラベルを指定してIssueを作成
- Androidの共有シートから受け取るPWA Web Share Target
- iPhone / iPadの共有シートからShortcuts経由で受け取る共有URL
- PC版Chromeの右クリック・ツールバーから送るManifest V3拡張
- 共有内容を保持したままGitHub OAuthを往復
- オフライン時にも入力画面を開けるアプリシェル

## 構成

```text
X / Chrome / OS share sheet
          │
          ▼
    EasyIssue PWA ───── Chrome extension / iOS Shortcut
          │
          ▼
 Cloudflare Worker API
   ├─ GitHub OAuth
   ├─ repository list
   └─ issue creation
          │
          ▼
       GitHub API
```

フロントエンドとAPIを単一のCloudflare Workerとして配布します。登録リポジトリは`localStorage`に保存し、GitHubアクセストークンは`SESSION_SECRET`で暗号化したHttpOnly Cookieだけに保持します。データベースは不要です。詳しくは [`docs/architecture.md`](docs/architecture.md) を参照してください。

## ローカル起動

### 1. GitHub OAuth Appを作る

GitHubのDeveloper settingsでOAuth Appを作成します。

- Homepage URL: `http://localhost:8787`
- Authorization callback URL: `http://localhost:8787/api/auth/callback`

本番環境とは別のOAuth Appを用意するのが簡単です。

### 2. 環境変数を用意する

```bash
npm install
cp .dev.vars.example .dev.vars
openssl rand -base64 48
```

生成したランダム文字列とOAuth Appの値を`.dev.vars`へ設定します。

```dotenv
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
SESSION_SECRET=32文字以上のランダム値
```

初期設定のOAuth scopeは`public_repo`です。非公開リポジトリも対象にする場合は、`wrangler.jsonc`の`GITHUB_OAUTH_SCOPE`を`repo`へ変更します。OAuth Appの`repo` scopeはコードを含む広い権限になるため、利用者を限定した自己ホスト用途を想定しています。

### 3. 起動する

```bash
npm run dev
```

`http://localhost:8787`を開き、GitHubへログインします。

## Cloudflare Workersへデプロイ

本番OAuth Appのcallback URLを、デプロイ先の`/api/auth/callback`に設定してから実行します。

```bash
npm install
npm run deploy:dry-run
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npm run deploy
```

## 共有から開く

### Android

ChromeでEasyIssueをPWAとしてインストールします。その後、XやChromeの共有先にEasyIssueが表示されます。共有されたタイトル、テキスト、URLが入力欄へ反映されます。

### iPhone / iPad

[`docs/ios-shortcut.md`](docs/ios-shortcut.md) の手順で共有シート用Shortcutを作成します。XやChromeからShortcutを選ぶと、EasyIssueの入力画面が開きます。

### PC版Chrome

1. `chrome://extensions`を開く
2. デベロッパーモードを有効にする
3. 「パッケージ化されていない拡張機能を読み込む」で`extension/chrome`を選ぶ
4. 拡張機能のオプションでEasyIssueのURLを設定する
5. ページ、リンク、選択テキストを右クリックして「EasyIssueでIssueを作成」を選ぶ

## テスト

```bash
npm run check
```

JavaScript構文、JSON設定、共有内容の整形、入力検証、暗号化Cookie、主要APIルートを検査します。

## 現時点の制約

- GitHubから取得するリポジトリ一覧は、更新が新しい順に最大1,000件です。それ以降は手入力による追加が可能です。
- ラベル名は直接入力です。候補の取得、担当者、Milestone、Issue Templateは次フェーズです。
- iOSではPWAを直接Share Targetとして登録せず、Shortcutsを橋渡しにします。
- OAuth Appの非公開リポジトリ権限は広いため、複数利用者へ公開する段階でGitHub App方式へ移行する想定です。
