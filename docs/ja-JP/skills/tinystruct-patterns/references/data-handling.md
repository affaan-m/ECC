# tinystruct のデータ処理（JSON）

## 使用タイミング

軽量で外部依存ゼロの JSON 処理には `org.tinystruct.data.component.Builder` と `Builders` を優先して使用します。`Builder` は JSON オブジェクト（`{}`）に、`Builders` は JSON 配列（`[]`）に対応します。**ジェネリクスの型消去問題を避けるため、`List<Builder>` の代わりに必ず `Builders` を使用してください。**

## 仕組み

`Builder` はキーと値のインターフェースで JSON オブジェクトの生成と読み取りを行います。`Builders` はインデックスによるリストで JSON 配列を扱います。どちらも `AbstractApplication` の結果処理と直接統合されています。

### なぜ Builder/Builders を使うのか
- **外部依存ゼロ** — 軽量かつ高速
- **ネイティブ統合** — フレームワークの結果処理と連携
- **型安全性** — `Builders` は `[]` として正しくシリアライズされます。`List<Builder>` はキャスト問題を引き起こす可能性があります

## 例

### 単一オブジェクトのシリアライズ
```java
import org.tinystruct.data.component.Builder;

Builder response = new Builder();
response.put("status", "success");
response.put("count", 42);
return response.toString(); // {"status":"success","count":42}
```

### Builders を使ったリストのシリアライズ
```java
import org.tinystruct.data.component.Builder;
import org.tinystruct.data.component.Builders;

Builders dataList = new Builders();
for (MyModel item : myCollection) {
    Builder b = new Builder();
    b.put("id", item.getId());
    b.put("name", item.getName());
    dataList.add(b);
}
Builder response = new Builder();
response.put("data", dataList);
return response.toString(); // {"data":[{"id":1,"name":"X"}]}
```

### JSON オブジェクトのパース
```java
Builder parsed = new Builder();
parsed.parse(jsonString);
String status = parsed.get("status").toString();
```

### JSON 配列のパース
```java
Builders parsedArray = new Builders();
parsedArray.parse(jsonArrayString);
for (int i = 0; i < parsedArray.size(); i++) {
    Builder item = parsedArray.get(i);
    System.out.println(item.get("name"));
}
```
