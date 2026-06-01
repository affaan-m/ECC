# tinystruct のデータベース永続化

## 使用タイミング

データベース操作には組み込みの ORM ライクなデータレイヤーを使用します。`AbstractData` を継承した POJO と XML マッピングファイルを使った、JPA/Hibernate の軽量な代替手段です。

## 仕組み

### アーキテクチャ

各テーブルは以下の 2 つで表現されます：
1. **Java POJO**：`AbstractData` を継承し、ゲッター・セッターと `setData(Row)` を提供します。
2. **マッピング XML**：リソース内の `ClassName.map.xml` で、Java フィールドと DB カラムをバインドします。

#### 基底クラス：`AbstractData`
CRUD メソッドを提供します：
- `append()` / `appendAndGetId()`
- `update()`
- `delete()`
- `findAll()` / `findOneById()` / `findOneByKey(key, value)`
- `findWith(where, params)`
- `find(SQL, params)`

### POJO の生成（CLI）

稼働中のデータベーステーブルを内省して POJO とマッピングファイルを生成します。

#### 設定
`application.properties`：
```properties
driver=com.mysql.cj.jdbc.Driver
database.url=jdbc:mysql://localhost:3306/mydb
database.user=root
database.password=secret
```

#### コマンド
```bash
# 対話モード
bin/dispatcher generate

# テーブルを指定
bin/dispatcher generate --tables users
```

## 例

### CRUD 操作
```java
// CREATE
User user = new User();
user.setUsername("james");
user.append();

// READ
User user = new User();
user.setId(42);
user.findOneById();

// UPDATE
user.setEmail("new@example.com");
user.update();

// DELETE
user.delete();
```

### 条件を使ったクエリ
```java
User user = new User();
Table results = user.findWith("username LIKE ?", new Object[]{"%jam%"});

// フルエント Condition ビルダー
Condition condition = new Condition();
condition.setRequestFields("id,username");
Table filtered = user.find(
    condition.select("`users`").and("email LIKE ?").orderBy("id DESC"),
    new Object[]{"%@example.com"}
);
```

### マッピング XML の構造
`User.map.xml`：
```xml
<mapping>
  <class name="User" table="users">
    <id name="Id" column="id" increment="true" generate="false" length="11" type="int"/>
    <property name="username" column="username" length="50" type="varchar"/>
    <property name="email" column="email" length="100" type="varchar"/>
  </class>
</mapping>
```

## 重要なルール

1. **ファイルの配置**：マッピング XML は `src/main/resources/` 以下の POJO のパッケージパスと**必ず**一致させること。
2. **命名規則**：テーブル名はクラス名として単数化されます（`users` → `User`）。アンダースコア区切りのカラム名はキャメルケースのフィールドになります（`created_at` → `createdAt`）。
3. **セッター**：セッター内では `setFieldAsXxx` メソッド（例：`setFieldAsString`）を使用して、内部フィールドマップと状態を同期させること。
4. **Id フィールド**：Java での主キーフィールドは常に `Id` という名前になります（`AbstractData` から継承）。
