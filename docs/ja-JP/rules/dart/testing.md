---
paths:
  - "**/*.dart"
  - "**/pubspec.yaml"
  - "**/analysis_options.yaml"
---
# Dart/Flutter テスト

> このファイルは [common/testing.md](../common/testing.md) を Dart および Flutter 固有のコンテンツで拡張します。

## テストフレームワーク

- **flutter_test** / **dart:test** — 組み込みテストランナー
- **mockito** (`@GenerateMocks` 付き) または **mocktail** (コード生成なし) でモック
- **bloc_test** — BLoC/Cubit のユニットテスト
- **fake_async** — ユニットテストでの時間制御
- **integration_test** — エンドツーエンドのデバイステスト

## テストの種類

| 種類 | ツール | 場所 | 書くタイミング |
|------|------|----------|---------------|
| ユニット | `dart:test` | `test/unit/` | すべてのドメインロジック、ステートマネージャー、リポジトリ |
| ウィジェット | `flutter_test` | `test/widget/` | 意味のある動作を持つすべてのウィジェット |
| ゴールデン | `flutter_test` | `test/golden/` | デザインが重要な UI コンポーネント |
| インテグレーション | `integration_test` | `integration_test/` | 実機/エミュレーターでの重要なユーザーフロー |

## ユニットテスト: ステートマネージャー

### `bloc_test` を使った BLoC

```dart
group('CartBloc', () {
  late CartBloc bloc;
  late MockCartRepository repository;

  setUp(() {
    repository = MockCartRepository();
    bloc = CartBloc(repository);
  });

  tearDown(() => bloc.close());

  blocTest<CartBloc, CartState>(
    'CartItemAdded 時に更新されたアイテムを emit する',
    build: () => bloc,
    act: (b) => b.add(CartItemAdded(testItem)),
    expect: () => [CartState(items: [testItem])],
  );

  blocTest<CartBloc, CartState>(
    'CartCleared 時に空のカートを emit する',
    seed: () => CartState(items: [testItem]),
    build: () => bloc,
    act: (b) => b.add(CartCleared()),
    expect: () => [const CartState()],
  );
});
```

### `ProviderContainer` を使った Riverpod

```dart
test('usersProvider がリポジトリからユーザーをロードする', () async {
  final container = ProviderContainer(
    overrides: [userRepositoryProvider.overrideWithValue(FakeUserRepository())],
  );
  addTearDown(container.dispose);

  final result = await container.read(usersProvider.future);
  expect(result, isNotEmpty);
});
```

## ウィジェットテスト

```dart
testWidgets('CartPage がアイテム数バッジを表示する', (tester) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        cartNotifierProvider.overrideWith(() => FakeCartNotifier([testItem])),
      ],
      child: const MaterialApp(home: CartPage()),
    ),
  );

  await tester.pump();
  expect(find.text('1'), findsOneWidget);
  expect(find.byType(CartItemTile), findsOneWidget);
});

testWidgets('カートが空のときに空の状態を表示する', (tester) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [cartNotifierProvider.overrideWith(() => FakeCartNotifier([]))],
      child: const MaterialApp(home: CartPage()),
    ),
  );

  await tester.pump();
  expect(find.text('Your cart is empty'), findsOneWidget);
});
```

## モックよりもフェイクを優先

複雑な依存関係には手書きのフェイクを優先する:

```dart
class FakeUserRepository implements UserRepository {
  final _users = <String, User>{};
  Object? fetchError;

  @override
  Future<User?> getById(String id) async {
    if (fetchError != null) throw fetchError!;
    return _users[id];
  }

  @override
  Future<List<User>> getAll() async {
    if (fetchError != null) throw fetchError!;
    return _users.values.toList();
  }

  @override
  Stream<List<User>> watchAll() => Stream.value(_users.values.toList());

  @override
  Future<void> save(User user) async {
    _users[user.id] = user;
  }

  @override
  Future<void> delete(String id) async {
    _users.remove(id);
  }

  void addUser(User user) => _users[user.id] = user;
}
```

## 非同期テスト

```dart
// タイマーと Future を制御するために fake_async を使用
test('300ms 後にデバウンスが発火する', () {
  fakeAsync((async) {
    final debouncer = Debouncer(delay: const Duration(milliseconds: 300));
    var callCount = 0;
    debouncer.run(() => callCount++);
    expect(callCount, 0);
    async.elapse(const Duration(milliseconds: 200));
    expect(callCount, 0);
    async.elapse(const Duration(milliseconds: 200));
    expect(callCount, 1);
  });
});
```

## ゴールデンテスト

```dart
testWidgets('UserCard ゴールデンテスト', (tester) async {
  await tester.pumpWidget(
    MaterialApp(home: UserCard(user: testUser)),
  );

  await expectLater(
    find.byType(UserCard),
    matchesGoldenFile('goldens/user_card.png'),
  );
});
```

意図的な視覚的変更があった場合は `flutter test --update-goldens` を実行する。

## テストの命名

説明的で振る舞いに焦点を当てた名前を使用する:

```dart
test('ユーザーが存在しない場合に null を返す', () { ... });
test('id が空文字列の場合に NotFoundException をスローする', () { ... });
testWidgets('フォームが無効な間は送信ボタンを無効にする', (tester) async { ... });
```

## テストの構成

```
test/
├── unit/
│   ├── domain/
│   │   └── usecases/
│   └── data/
│       └── repositories/
├── widget/
│   └── presentation/
│       └── pages/
└── golden/
    └── widgets/

integration_test/
└── flows/
    ├── login_flow_test.dart
    └── checkout_flow_test.dart
```

## カバレッジ

- ビジネスロジック (ドメイン + ステートマネージャー) で 80%以上の行カバレッジを目標とする
- すべてのステート遷移にテストが必要: ローディング → 成功、ローディング → エラー、リトライ
- `flutter test --coverage` を実行し、カバレッジレポーターで `lcov.info` を確認する
- カバレッジが閾値を下回った場合は CI でブロックする
