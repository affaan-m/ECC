---
paths:
  - "**/*.dart"
  - "**/pubspec.yaml"
---
# Dart/Flutter Patterns

> This file extends [common/patterns.md](../common/patterns.md) with Dart, Flutter, and common ecosystem-specific content.

## Repository Pattern

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

## State Management: BLoC/Cubit

```dart
// Cubit — simple state transitions
class CounterCubit extends Cubit<int> {
  CounterCubit() : super(0);

  void increment() => emit(state + 1);
  void decrement() => emit(state - 1);
}

// BLoC — event-driven
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

## State Management: Riverpod

```dart
// Simple provider
@riverpod
Future<List<User>> users(Ref ref) async {
  final repo = ref.watch(userRepositoryProvider);
  return repo.getAll();
}

// Notifier for mutable state
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

## Dependency Injection

Constructor injection is preferred. Use `get_it` or Riverpod providers at composition root:

```dart
// get_it registration (in a setup file)
void setupDependencies() {
  final di = GetIt.instance;
  di.registerSingleton<ApiClient>(ApiClient(baseUrl: Env.apiUrl));
  di.registerSingleton<UserRepository>(
    UserRepositoryImpl(di<ApiClient>(), di<LocalDatabase>()),
  );
  di.registerFactory(() => UserListViewModel(di<UserRepository>()));
}
```

## ViewModel Pattern (without BLoC/Riverpod)

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

## UseCase Pattern

```dart
class GetUserUseCase {
  const GetUserUseCase(this._repository);
  final UserRepository _repository;

  Future<User?> call(String id) => _repository.getById(id);
}

class CreateUserUseCase {
  const CreateUserUseCase(this._repository, this._idGenerator);
  final UserRepository _repository;
  final IdGenerator _idGenerator; // injected — domain layer must not depend on uuid package directly

  Future<void> call(CreateUserInput input) async {
    // Validate, apply business rules, then persist
    final user = User(id: _idGenerator.generate(), name: input.name, email: input.email);
    await _repository.save(user);
  }
}
```

## Immutable State with freezed

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

## Clean Architecture Layer Boundaries

```
lib/
├── domain/              # Pure Dart — no Flutter, no external packages
│   ├── entities/
│   ├── repositories/    # Abstract interfaces
│   └── usecases/
├── data/                # Implements domain interfaces
│   ├── datasources/
│   ├── models/          # DTOs with fromJson/toJson
│   └── repositories/
└── presentation/        # Flutter widgets + state management
    ├── pages/
    ├── widgets/
    └── providers/ (or blocs/ or viewmodels/)
```

- Domain must not import `package:flutter` or any data-layer package
- Data layer maps DTOs to domain entities at repository boundaries
- Presentation calls use cases, not repositories directly

## Navigation (GoRouter)

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
  // refreshListenable re-evaluates redirect whenever auth state changes
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

## References

See skill: `flutter-dart-code-review` for the comprehensive review checklist.
See skill: `compose-multiplatform-patterns` for Kotlin Multiplatform/Flutter interop patterns.
