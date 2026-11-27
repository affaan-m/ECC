---
name: springboot-security
description: Spring Security best practices for authn/authz, validation, CSRF, secrets, headers, rate limiting, and dependency security in Java Spring Boot services.
---

# Spring Boot セキュリティレビュー

認証の追加、入力処理、エンドポイント作成、またはシークレット処理時に使用します。

## 認証

- ステートレスJWTまたは失効リスト付き不透明トークンを優先
- セッションには `httpOnly`、`Secure`、`SameSite=Strict` クッキーを使用
- `OncePerRequestFilter` またはリソースサーバーでトークンを検証

```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
  private final JwtService jwtService;

  public JwtAuthFilter(JwtService jwtService) {
    this.jwtService = jwtService;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
      FilterChain chain) throws ServletException, IOException {
    String header = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (header != null && header.startsWith("Bearer ")) {
      String token = header.substring(7);
      Authentication auth = jwtService.authenticate(token);
      SecurityContextHolder.getContext().setAuthentication(auth);
    }
    chain.doFilter(request, response);
  }
}
```

## 認可

- メソッドセキュリティを有効化: `@EnableMethodSecurity`
- `@PreAuthorize("hasRole('ADMIN')")` または `@PreAuthorize("@authz.canEdit(#id)")` を使用
- デフォルトで拒否し、必要なスコープのみ公開

## 入力検証

- `@Valid` を使用してコントローラーでBean Validationを使用
- DTOに制約を適用: `@NotBlank`、`@Email`、`@Size`、カスタムバリデーター
- レンダリング前にホワイトリストでHTMLをサニタイズ

## SQLインジェクション防止

- Spring Dataリポジトリまたはパラメータ化クエリを使用
- ネイティブクエリには `:param` バインディングを使用し、文字列を連結しない

## CSRF保護

- ブラウザセッションアプリの場合はCSRFを有効にし、フォーム/ヘッダーにトークンを含める
- Bearerトークンを使用する純粋なAPIの場合は、CSRFを無効にしてステートレス認証に依存

```java
http
  .csrf(csrf -> csrf.disable())
  .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
```

## シークレット管理

- ソースコードにシークレットを含めない。環境変数またはvaultから読み込む
- `application.yml` を認証情報から解放し、プレースホルダーを使用
- トークンとDB認証情報を定期的にローテーション

## セキュリティヘッダー

```java
http
  .headers(headers -> headers
    .contentSecurityPolicy(csp -> csp
      .policyDirectives("default-src 'self'"))
    .frameOptions(HeadersConfigurer.FrameOptionsConfig::sameOrigin)
    .xssProtection(Customizer.withDefaults())
    .referrerPolicy(rp -> rp.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)));
```

## レート制限

- 高コストなエンドポイントにBucket4jまたはゲートウェイレベルの制限を適用
- バーストをログに記録してアラートを送信し、リトライヒント付きで429を返す

## 依存関係のセキュリティ

- CIでOWASP Dependency Check / Snykを実行
- Spring BootとSpring Securityをサポートされているバージョンに保つ
- 既知のCVEでビルドを失敗させる

## ロギングとPII

- シークレット、トークン、パスワード、完全なPANデータをログに記録しない
- 機密フィールドを編集し、構造化JSONロギングを使用

## ファイルアップロード

- サイズ、コンテンツタイプ、拡張子を検証
- Webルート外に保存し、必要に応じてスキャン

## リリース前チェックリスト

- [ ] 認証トークンが正しく検証され、期限切れになっている
- [ ] すべての機密パスに認可ガードがある
- [ ] すべての入力が検証およびサニタイズされている
- [ ] 文字列連結されたSQLがない
- [ ] アプリケーションタイプに対してCSRF対策が正しい
- [ ] シークレットが外部化され、コミットされていない
- [ ] セキュリティヘッダーが設定されている
- [ ] APIにレート制限がある
- [ ] 依存関係がスキャンされ、最新である
- [ ] ログに機密データがない

**注意**: デフォルトで拒否し、入力を検証し、最小権限を適用し、設定によるセキュリティを優先します。
