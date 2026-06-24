# tinystruct Data Handling (JSON)

## When to Use

Prefer `org.tinystruct.data.component.Builder` and `Builders` for lightweight, zero-dependency JSON. Use `Builder` for JSON objects (`{}`), `Builders` for JSON arrays (`[]`). **Always use `Builders` instead of `List<Builder>`** to avoid generic type erasure issues.

## How It Works

`Builder` provides a key-value interface for creating and reading JSON objects. `Builders` provides an indexed list for JSON arrays. Both integrate directly with `AbstractApplication` result handling.

### Why Builder/Builders?
- **Zero External Dependencies** — lean and fast
- **Native Integration** — works with framework result handling
- **Type Safety** — `Builders` serializes properly to `[]`; `List<Builder>` can cause casting issues

## Examples

### Serialize a Single Object
```java
import org.tinystruct.data.component.Builder;

Builder response = new Builder();
response.put("status", "success");
response.put("count", 42);
return response.toString(); // {"status":"success","count":42}
```

### Serialize a List using Builders
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

### Parse a JSON Object
```java
Builder parsed = new Builder();
parsed.parse(jsonString);
String status = parsed.get("status").toString();
```

### Parse a JSON Array
```java
Builders parsedArray = new Builders();
parsedArray.parse(jsonArrayString);
for (int i = 0; i < parsedArray.size(); i++) {
    Builder item = parsedArray.get(i);
    System.out.println(item.get("name"));
}
```
