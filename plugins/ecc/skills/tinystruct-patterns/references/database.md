# tinystruct Database Persistence

## When to Use

Use the built-in ORM-like data layer for database operations. It provides a lightweight alternative to JPA/Hibernate using POJOs extending `AbstractData` and XML mapping files.

## How It Works

### Architecture

Each table is represented by:
1. **Java POJO**: Extends `AbstractData`, provides getters/setters and `setData(Row)`.
2. **Mapping XML**: `ClassName.map.xml` in resources, binding Java fields to DB columns.

#### Key Base Class: `AbstractData`
Provides CRUD methods:
- `append()` / `appendAndGetId()`
- `update()`
- `delete()`
- `findAll()` / `findOneById()` / `findOneByKey(key, value)`
- `findWith(where, params)`
- `find(SQL, params)`

### POJO Generation (CLI)

Introspect a live database table to produce the POJO and mapping file.

#### Configuration
`application.properties`:
```properties
driver=com.mysql.cj.jdbc.Driver
database.url=jdbc:mysql://localhost:3306/mydb
database.user=root
database.password=secret
```

#### Command
```bash
# Interactive mode
bin/dispatcher generate

# Specify table
bin/dispatcher generate --tables users
```

## Examples

### CRUD Operations
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

### Querying with Conditions
```java
User user = new User();
Table results = user.findWith("username LIKE ?", new Object[]{"%jam%"});

// Fluent Condition Builder
Condition condition = new Condition();
condition.setRequestFields("id,username");
Table filtered = user.find(
    condition.select("`users`").and("email LIKE ?").orderBy("id DESC"),
    new Object[]{"%@example.com"}
);
```

### Mapping XML Structure
`User.map.xml`:
```xml
<mapping>
  <class name="User" table="users">
    <id name="Id" column="id" increment="true" generate="false" length="11" type="int"/>
    <property name="username" column="username" length="50" type="varchar"/>
    <property name="email" column="email" length="100" type="varchar"/>
  </class>
</mapping>
```

## Important Rules

1. **File Placement**: The mapping XML **must** mirror the POJO's package path under `src/main/resources/`.
2. **Naming**: Table names are singularized for class names (`users` → `User`). Underscored columns become camelCase fields (`created_at` → `createdAt`).
3. **Setters**: Use `setFieldAsXxx` methods (e.g., `setFieldAsString`) in setters to sync state with the internal field map.
4. **Id Field**: The primary key field in Java is always named `Id` (inherited from `AbstractData`).
