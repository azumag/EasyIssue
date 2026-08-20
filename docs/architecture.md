# EasyIssue 初期設計

## 目的

共有中のページや投稿を見た瞬間に、別アプリを何度も移動せずGitHub Issueへ変換する。Issue本文を完璧に整えることより、情報を失わず適切なリポジトリへ入れるまでの操作数を減らすことを優先する。

## MVPの利用フロー

1. X、Chrome、または任意のアプリで共有を開く
2. EasyIssue、Chrome拡張、またはiOS Shortcutを選ぶ
3. 共有タイトル、本文、URLがIssueフォームへ入る
4. 登録済みリポジトリを選ぶ
5. 必要ならタイトル、本文、ラベルを補正する
6. `Cmd/Ctrl + Enter`または送信ボタンで作成する
7. 作成済みIssueをGitHubで開く

未ログインの場合も共有内容をURLに保持し、OAuth完了後に同じ画面へ戻す。

## コンポーネント

### PWA

- フレームワークを使わないHTML/CSS/ES Modules
- Web App Manifestの`share_target`で共有内容を`/share`へ受け取る
- Service Workerでアプリシェルのみキャッシュする
- `/api/*`とGitHub認証情報はキャッシュしない
- 登録リポジトリと最後に選んだリポジトリだけを`localStorage`へ保存する

### Cloudflare Worker

| Route | Method | 用途 |
| --- | --- | --- |
| `/api/health` | GET | 死活確認 |
| `/api/auth/login` | GET | GitHub OAuth開始 |
| `/api/auth/callback` | GET | OAuth code交換、セッション発行 |
| `/api/auth/logout` | POST | セッション破棄 |
| `/api/session` | GET | ログインユーザー確認 |
| `/api/repositories` | GET | 利用可能なIssue対応リポジトリ取得 |
| `/api/issues` | POST | Issue作成 |

Cloudflare Static Assetsで`public/`を配信し、`/api/*`だけWorkerを先に通す。

### Chrome拡張

- Manifest V3
- `contextMenus`、`activeTab`、`action`を使用
- ページタイトル、選択テキスト、リンクまたはページURLを`/share`のqueryへ渡す
- EasyIssue URLは`chrome.storage.sync`へ保存する
- 常時有効なhost permissionは持たず、ユーザー操作時だけ現在のタブ情報を受け取る

### iOS Shortcut

共有シートから渡されたテキストまたはURLをURLエンコードし、EasyIssueの`/share?text=...`を開く。ネイティブShare Extensionを作る前の軽量な橋渡しとする。

## 認証とセキュリティ

- OAuth stateは暗号化Cookieに保存し、有効期限と定時間比較で検証する
- アクセストークンはAES-GCMで暗号化し、HttpOnly / SameSite=Lax Cookieに保存する
- HTTPS環境ではCookieに`Secure`を付ける
- Issue作成とlogoutは`Origin`を検証する
- API responseは`Cache-Control: no-store`
- 静的配信にはCSP、frame拒否、MIME sniffing拒否、Referrer抑止を設定する
- Workerログへアクセストークン、OAuth code、Cookieを出力しない
- `SESSION_SECRET`は32文字以上とし、ソースコードへ含めない

## OAuth方式の判断

MVPでは構築と自己ホストが容易なOAuth Appを採用する。公開リポジトリだけなら`public_repo`、非公開リポジトリを扱う場合は`repo` scopeが必要になる。後者はIssue作成に必要な範囲より広い。

複数利用者へ提供する段階ではGitHub Appへ移行し、Repository permissionsを`Metadata: read`、`Issues: write`へ絞り、選択されたRepository installationだけを扱う。

## データモデル

サーバー永続化は行わない。

```text
Browser localStorage
  repositories: string[]
  selectedRepository: string

Encrypted session cookie
  accessToken: string
  scope: string
  expiresAt: number
```

端末間同期、チーム共通テンプレート、利用履歴が必要になった時点でD1追加を検討する。

## 次フェーズ候補

1. GitHub Appへの移行
2. ラベル、担当者、Milestone、Issue Typeの候補取得
3. リポジトリ別テンプレートと定型ラベル
4. 共有内容からタイトルと完了条件を整える任意のAI補助
5. 重複Issue候補の表示
6. iOS / AndroidのネイティブShare Extension
7. 端末間での登録リポジトリ同期
