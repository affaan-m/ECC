---
paths:
  - "**/*.dart"
  - "**/pubspec.yaml"
---
# Dart/Flutter パターン

> このファイルは [common/patterns.md](../common/patterns.md) を Dart、Flutter、および一般的なエコシステム固有のコンテンツで拡張します。

## リポジトリパターン

```dart
abstract interface class UserRepository {
  Future<User?> getById(String id);
  Future<List<User>> getAll();
  Stream<List<User>> watchAll();
  Future<void> save(User user);
  Future<void> delete(String id);
}

class UserRepositoryImpl implements UserRepository {
  const UserRepositoryImpl(this._remote, this._local);

  final UserRemoteDataSource _remote;
  final UserLocalDataSource _local;

  @override
  Future<User?> getById(String id) async {
    final local = await _local.getById(id);
    if (local != null) return local;
    final remote = await _remote.getById(id);
    if (remote != null) await _local.save(remote);
    return remote;
  }

  @override
  Future<List<User>> getAll() async {
    final remote = await _remote.getAll();
    for (final user in remote) {
      await _local.save(user);
    }
    return remote;
  }

  @override
  Stream<List<User>> watchAll() => _local.watchAll();

  @override
  Future<void> save(User user) => _local.save(user);

  @override
  Future<void> delete(String id) async {
    await _remote.delete(id);
    await _local.delete(id);
  }
}
```

## ステート管理: BLoC/Cubit

```dart
// Cubit — シンプルなステート遷移
class CounterCubit extends Cubit<int> {
  CounterCubit() : super(0);

  void increment() => emit(state + 1);
  void decrement() => emit(state - 1);
}

// BLoC — イベント駆動
@immutable
sealed class CartEvent {}
class CartItemAdded extends CartEvent { CartItemAdded(this.item); final Item item; }
class CartItemRemoved extends CartEvent { CartItemRemoved(this.id); final String id; }
class CartCleared extends CartEvent {}

@immutable
class CartState {
  const CartState({this.items = const []});
  final List<Item> items;
  CartState copyWith({List<Item>? items}) => CartState(items: items ?? this.items);
}

class CartBloc extends Bloc<CartEvent, CartState> {
  CartBloc() : super(const CartState()) {
    on<CartItemAdded>((event, emit) =>
        emit(state.copyWith(items: [...state.items, event.item])));
    on<CartItemRemoved>((event, emit) =>
        emit(state.copyWith(items: state.items.where((i) => i.id != event.id).toList())));
    on<CartCleared>((_, emit) => emit(const CartState()));
  }
}
```

## ステート管理: Riverpod

```dart
// シンプルなプロバイダー
@riverpod
Future<List<User>> users(Ref ref) async {
  final repo = ref.watch(userRepositoryProvider);
  return repo.getAll();
}

// ミュータブルなステート用の Notifier
@riverpod
class CartNotifier extends _$CartNotifier {
  @override
  List<Item> build() => [];

  void add(Item item) => state = [...state, item];
  void remove(String id) => state = state.where((i) => i.id != id).toList();
  void clear() => state = [];
}

// ConsumerWidget
class CartPage extends ConsumerWidget {
  const CartPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(cartNotifierProvider);
    return ListView(
      children: items.map((item) => CartItemTile(item: item)).toList(),
    );
  }
}
```

## 依存性注入

コンストラクタ注入が推奨される。コンポジションルートで `get_it` または Riverpod プロバイダーを使用する:

```dart
// get_it の登録 (セットアップファイル内)
void setupDependencies() {
  final di = GetIt.instance;
  di.registerSingleton<ApiClient>(ApiClient(baseUrl: Env.apiUrl));
  di.registerSingleton<UserRepository>(
    UserRepositoryImpl(di<ApiClient>(), di<LocalDatabase>()),
  );
  di.registerFactory(() => UserListViewModel(di<UserRepository>()));
}
```

## ViewModel パターン (BLoC/Riverpod なし)

```dart
class UserListViewModel extends ChangeNotifier {
  UserListViewModel(this._repository);

  final UserRepository _repository;

  AsyncState<List<User>> _state = const Loading();
  AsyncState<List<User>> get state => _state;

  Future<void> load() async {
    _state = const Loading();
    notifyListeners();
    try {
      final users = await _repository.getAll();
      _state = Success(users);
    } on Exception catch (e) {
      _state = Failure(e);
    }
    notifyListeners();
  }
}
```

## UseCase パターン

```dart
class GetUserUseCase {
  const GetUserUseCase(this._repository);
  final UserRepository _repository;

  Future<User?> call(String id) => _repository.getById(id);
}

class CreateUserUseCase {
  const CreateUserUseCase(this._repository, this._idGenerator);
  final UserRepository _repository;
  final IdGenerator _idGenerator; // 注入 — ドメイン層は uuid パッケージに直接依存してはならない

  Future<void> call(CreateUserInput input) async {
    // バリデーション、ビジネスルールの適用、その後永続化
    final user = User(id: _idGenerator.generate(), name: input.name, email: input.email);
    await _repository.save(user);
  }
}
```

## freezed を使ったイミュータブルなステート

```dart
@freezed
class UserState with _$UserState {
  const factory UserState({
    @Default([]) List<User> users,
    @Default(false) bool isLoading,
    String? errorMessage,
  }) = _UserState;
}
```

## クリーンアーキテクチャのレイヤー境界

```
lib/
├── domain/              # 純粋な Dart — Flutter なし、外部パッケージなし
│   ├── entities/
│   ├── repositories/    # 抽象インターフェース
│   └── usecases/
├── data/                # ドメインインターフェースの実装
│   ├── datasources/
│   ├── models/          # fromJson/toJson を持つ DTO
│   └── repositories/
└── presentation/        # Flutter ウィジェット + ステート管理
    ├── pages/
    ├── widgets/
    └── providers/ (or blocs/ or viewmodels/)
```

- ドメイン層は `package:flutter` やデータ層のパッケージをインポートしてはならない
- データ層はリポジトリ境界で DTO をドメインエンティティにマッピングする
- プレゼンテーション層はリポジトリを直接使用せず、ユースケースを呼び出す

## ナビゲーション (GoRouter)

```dart
final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomePage(),
    ),
    GoRoute(
      path: '/users/:id',
      builder: (context, state) {
        final id = state.pathParameters['id']!;
        return UserDetailPage(userId: id);
      },
    ),
  ],
  // refreshListenable は認証ステートが変わるたびに redirect を再評価する
  refreshListenable: GoRouterRefreshStream(authCubit.stream),
  redirect: (context, state) {
    final isLoggedIn = context.read<AuthCubit>().state is AuthAuthenticated;
    if (!isLoggedIn && !state.matchedLocation.startsWith('/login')) {
      return '/login';
    }
    return null;
  },
);
```

## 参考資料

スキル `flutter-dart-code-review` で包括的なレビューチェックリストを参照。
スキル `compose-multiplatform-patterns` で Kotlin Multiplatform/Flutter 相互運用パターンを参照。
