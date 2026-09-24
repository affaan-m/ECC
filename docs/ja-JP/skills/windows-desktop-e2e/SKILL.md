---
name: windows-desktop-e2e
description: E2E testing for Windows native desktop apps (WPF, WinForms, Win32/MFC, Qt) using pywinauto and Windows UI Automation.
origin: ECC
---

# Windows デスクトップ E2E テスト

**pywinauto** と Windows UI Automation（UIA）を使用したWindowsネイティブデスクトップアプリケーションのエンドツーエンドテスト。WPF、WinForms、Win32/MFC、Qt（5.x / 6.x）をカバーし、Qt固有のガイダンスは専用セクションとして提供します。

## アクティベートするタイミング

- Windowsネイティブデスクトップアプリケーションのエンドツーエンドテストを書くまたは実行するとき
- デスクトップGUIテストスイートをゼロから設定するとき
- 不安定または失敗するデスクトップオートメーションテストを診断するとき
- 既存のアプリにテスタビリティ（AutomationId、アクセシブルな名前）を追加するとき
- デスクトップエンドツーエンドをCI/CDパイプライン（GitHub Actions `windows-latest`）に統合するとき

### 使用しないタイミング

- Webアプリケーション → `e2e-testing` スキル（Playwright）を使用する
- Electron / CEF / WebView2 アプリ → HTMLレイヤーにはUIAではなくブラウザオートメーションが必要
- モバイルアプリ → プラットフォーム固有のツールを使用する（UIAutomator、XCUITest）
- 実行中のGUIを必要としない純粋なユニットまたは統合テスト

## コアコンセプト

すべてのWindowsデスクトップオートメーションは**UI Automation（UIA）**に依存します。これはWindowsに組み込まれたアクセシビリティAPIです。サポートされているすべてのフレームワークは、読み取りおよび操作可能なプロパティを持つUIA要素のツリーを公開します：

```
テスト（Python）
    └── pywinauto（UIAバックエンド）
        └── Windows UI Automation API   ← Windowsに組み込み、フレームワーク非依存
            └── アプリのUIAプロバイダー      ← 各フレームワークが独自に実装
                └── 実行中の .exe
```

**フレームワーク別UIA品質：**

| フレームワーク | AutomationId | 信頼性 | 注記 |
|-----------|-------------|-------------|-------|
| WPF | ★★★★★ | 優秀 | `x:Name` が直接AutomationIdにマッピング |
| WinForms | ★★★★☆ | 良好 | `AccessibleName` = AutomationId |
| UWP / WinUI 3 | ★★★★★ | 優秀 | Microsoftの完全サポート |
| Qt 6.x | ★★★★★ | 優秀 | アクセシビリティがデフォルトで有効；クラス名が `Qt6*` に変更 |
| Qt 5.15+ | ★★★★☆ | 良好 | Accessibilityモジュールが改善 |
| Qt 5.7–5.14 | ★★★☆☆ | 普通 | `QT_ACCESSIBILITY=1` が必要；objectNameは手動設定 |
| Win32 / MFC | ★★★☆☆ | 普通 | コントロールIDにアクセス可能；テキストマッチングが一般的 |

## セットアップと前提条件

```bash
# Python 3.8+、Windowsのみ
pip install pywinauto pytest pytest-html Pillow pytest-timeout
# オプション：画面録画
# ffmpegをインストールしてPATHに追加：https://ffmpeg.org/download.html
```

UIAが到達可能か確認：

```python
from pywinauto import Desktop
Desktop(backend="uia").windows()  # すべてのトップレベルウィンドウを一覧表示
```

**Accessibility Insights for Windows**をインストールしてください（Microsoft提供、無料）— テストを書く前にUIA要素ツリーを検査するためのDevTools相当のツールです。

## テスタビリティのセットアップ（フレームワーク別）

テストを書く前に**全てのインタラクティブなコントロールに安定したAutomationIdを設定すること**が最も効果的です。

### WPF

```xml
<!-- XAML: x:Name が自動的にAutomationIdになる -->
<TextBox x:Name="usernameInput" />
<PasswordBox x:Name="passwordInput" />
<Button x:Name="btnLogin" Content="Login" />
<TextBlock x:Name="lblError" />
```

### WinForms

```csharp
// デザイナーまたはコードで設定
usernameInput.AccessibleName = "usernameInput";
passwordInput.AccessibleName = "passwordInput";
btnLogin.AccessibleName = "btnLogin";
lblError.AccessibleName = "lblError";
```

### Win32 / MFC

```cpp
// .rcファイルのコントロールリソースIDがAutomationId文字列として公開される
// IDC_EDIT_USERNAME -> AutomationId "1001"
// 名前にはSetWindowTextを優先；より豊かなサポートにはIAccessibleを追加する
```

### Qt — 以下の専用セクションを参照

---

## ページオブジェクトモデル

```
tests/
├── conftest.py          # アプリ起動フィクスチャ、失敗時スクリーンショット
├── pytest.ini
├── config.py
├── pages/
│   ├── __init__.py      # インポートに必須
│   ├── base_page.py     # ロケーター、ウェイト、スクリーンショットヘルパー
│   ├── login_page.py
│   └── main_page.py
├── tests/
│   ├── __init__.py
│   ├── test_login.py
│   └── test_main_flow.py
└── artifacts/           # スクリーンショット、動画、ログ
```

### base_page.py

```python
import os, time
from pywinauto import Desktop
from config import ACTION_TIMEOUT, ARTIFACT_DIR

class BasePage:
    def __init__(self, window):
        self.window = window

    # --- ロケーター（優先順位順）---

    def by_id(self, auto_id, **kw):
        """AutomationId — 最も安定。第一選択として使用する。"""
        return self.window.child_window(auto_id=auto_id, **kw)

    def by_name(self, name, **kw):
        """表示テキスト / アクセシブルな名前。"""
        return self.window.child_window(title=name, **kw)

    def by_class(self, cls, index=0, **kw):
        """コントロールクラス + インデックス — 脆弱、可能なら避ける。"""
        return self.window.child_window(class_name=cls, found_index=index, **kw)

    # --- ウェイト ---

    def wait_visible(self, spec, timeout=ACTION_TIMEOUT):
        spec.wait("visible", timeout=timeout)
        return spec

    def wait_gone(self, spec, timeout=ACTION_TIMEOUT):
        spec.wait_not("visible", timeout=timeout)
        return spec

    def wait_window(self, title, timeout=ACTION_TIMEOUT):
        """新しいトップレベルウィンドウ（ダイアログ、子ウィンドウ）を待つ。"""
        dlg = Desktop(backend="uia").window(title=title)
        dlg.wait("visible", timeout=timeout)
        return dlg

    def wait_until(self, fn, timeout=ACTION_TIMEOUT, interval=0.3):
        """任意の条件をポーリング — UIAイベントが信頼できない場合に使用する。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if fn():
                    return True
            except Exception:
                pass
            time.sleep(interval)
        raise TimeoutError(f"条件が{timeout}秒以内に満たされなかった")

    # --- アクション ---

    def click(self, spec):
        self.wait_visible(spec)
        spec.click_input()

    def type_text(self, spec, text):
        self.wait_visible(spec)
        ctrl = spec.wrapper_object()
        try:
            ctrl.set_edit_text(text)
        except Exception as e:
            # Qt 5.x フォールバック：UIA Value Pattern が不完全な場合がある
            import sys, pywinauto.keyboard as kb
            print(f"[windows-desktop-e2e] set_edit_text 失敗 ({e})、キーボードフォールバックを使用", file=sys.stderr)
            ctrl.click_input()
            kb.send_keys("^a")
            kb.send_keys(text, with_spaces=True)

    def get_text(self, spec):
        ctrl = spec.wrapper_object()
        for attr in ("window_text", "get_value"):
            try:
                v = getattr(ctrl, attr)()
                if v:
                    return v
            except Exception:
                pass
        return ""

    # --- アーティファクト ---

    def screenshot(self, name):
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        path = os.path.join(ARTIFACT_DIR, f"{name}.png")
        self.window.capture_as_image().save(path)
        return path
```

### login_page.py

```python
from pages.base_page import BasePage

class LoginPage(BasePage):
    @property
    def username(self): return self.by_id("usernameInput")

    @property
    def password(self): return self.by_id("passwordInput")

    @property
    def btn_login(self): return self.by_id("btnLogin")

    @property
    def error_label(self): return self.by_id("lblError")

    def login(self, user, pwd):
        self.type_text(self.username, user)
        self.type_text(self.password, pwd)
        self.click(self.btn_login)

    def login_ok(self, user, pwd, main_title="Main Window"):
        self.login(user, pwd)
        return self.wait_window(main_title)

    def login_fail(self, user, pwd):
        self.login(user, pwd)
        self.wait_visible(self.error_label)
        return self.get_text(self.error_label)
```

### conftest.py

> 新しいプロジェクトでは**Tier 1サンドボックスフィクスチャ**（以下参照）を優先してください — 追加コストゼロでファイルシステムの分離が追加されます。この基本フィクスチャは最小限/レガシーセットアップ専用です。

```python
import os, pytest
os.environ["QT_ACCESSIBILITY"] = "1"  # Qt 5.x UIAサポートに必要

from pywinauto import Application
from config import APP_PATH, MAIN_WINDOW_TITLE, LAUNCH_TIMEOUT, ARTIFACT_DIR

@pytest.fixture
def app(request):
    if not APP_PATH:
        pytest.exit("APP_PATH 環境変数が設定されていない", returncode=1)
    proc = Application(backend="uia").start(APP_PATH, timeout=LAUNCH_TIMEOUT)
    win  = proc.window(title=MAIN_WINDOW_TITLE)
    win.wait("visible", timeout=LAUNCH_TIMEOUT)
    yield win
    # 失敗時のスクリーンショット
    if getattr(getattr(request.node, "rep_call", None), "failed", False):
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        try:
            win.capture_as_image().save(
                os.path.join(ARTIFACT_DIR, f"FAIL_{request.node.name}.png")
            )
        except Exception:
            pass
    # グレースフルな終了を試み、フォールバックとして強制終了
    # proc は pywinauto Application — wait_for_process() ではなく wait_for_process_exit() を使用
    try:
        win.close()
        proc.wait_for_process_exit(timeout=5)
    except Exception:
        proc.kill()

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    setattr(item, f"rep_{outcome.get_result().when}", outcome.get_result())
```

### config.py

```python
import os
APP_PATH          = os.environ.get("APP_PATH", "")           # 環境変数で設定 — デフォルトパスなし
MAIN_WINDOW_TITLE = os.environ.get("APP_TITLE", "")
LAUNCH_TIMEOUT    = int(os.environ.get("LAUNCH_TIMEOUT", "15"))
ACTION_TIMEOUT    = int(os.environ.get("ACTION_TIMEOUT", "10"))
ARTIFACT_DIR      = os.path.join(os.path.dirname(__file__), "artifacts")
```

### pytest.ini

```ini
[pytest]
testpaths = tests
markers =
    smoke: 重要なパスの高速スモークテスト
    flaky: 既知の不安定なテスト
addopts = -v --tb=short --html=artifacts/report.html --self-contained-html
```

## ロケーター戦略

```
AutomationId  >  Name（テキスト）  >  ClassName + インデックス  >  XPath
  （安定）         （可読）            （脆弱）                   （最後の手段）
```

Accessibility Insights → **Properties** ペインで検査 → まず `AutomationId` を確認。

```python
# 実行時の検査 — REPLに貼り付けてツリーを探索
win.print_control_identifiers()
# またはスコープを絞る：
win.child_window(auto_id="groupBox1").print_control_identifiers()
```

## ウェイトパターン

```python
# コントロールが表示されるのを待つ
page.wait_visible(page.by_id("statusLabel"))

# コントロールが消えるのを待つ（ローディングスピナーなど）
page.wait_gone(page.by_id("spinnerOverlay"))

# ダイアログが表示されるのを待つ
dlg = page.wait_window("Confirm Delete")

# カスタム条件（テキストの変化など）
page.wait_until(lambda: page.get_text(page.by_id("lblStatus")) == "Ready")
```

**`time.sleep()` を主要な同期手段として使用しないこと** — `wait()` または `wait_until()` を使用してください。

## アーティファクト管理

```python
# オンデマンドスクリーンショット
page.screenshot("after_login")

# フルスクリーンキャプチャ（ウィンドウが画面外または最小化されている場合）
import pyautogui
pyautogui.screenshot("artifacts/fullscreen.png")

# ffmpegによる画面録画（テスト前に開始し、テスト後に停止）
import subprocess

def start_recording(name):
    return subprocess.Popen([
        "ffmpeg", "-f", "gdigrab", "-framerate", "10",
        "-i", "desktop", "-y", f"artifacts/videos/{name}.mp4"
    ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def stop_recording(proc):
    proc.stdin.write(b"q"); proc.stdin.flush(); proc.wait(timeout=10)
```

## 不安定なテストの対処

```python
# 隔離 — PlaywrightのtestのFixmeと同等
@pytest.mark.skip(reason="不安定：遅いCIでのアニメーションレース。Issue #42")
def test_animated_transition(self, app): ...

# CIのみでスキップ
@pytest.mark.skipif(os.environ.get("CI") == "true", reason="CIで不安定 #43")
def test_heavy_load(self, app): ...
```

一般的な原因と修正：

| 原因 | 修正 |
|-------|-----|
| コントロールが準備できていない | `time.sleep` を `wait_visible` に置き換える |
| ウィンドウがフォーカスされていない | インタラクション前に `win.set_focus()` を追加する |
| アニメーション進行中 | `wait_until(lambda: not loading_indicator.exists())` |
| ダイアログのタイミング | `wait_window(title, timeout=15)` |
| CI環境のディスプレイが準備できていない | `DISPLAY` を設定するかCIで仮想デスクトップを使用する |

## テスト分離とサンドボックス

分離の3つの階層 — ニーズを満たす最も軽い階層を使用してください。

### Tier 1 — ファイルシステム分離（デフォルト、常に使用）

各テストは `subprocess.Popen` と `Application.connect()` を通じて独自の `APPDATA` / `LOCALAPPDATA` / `TEMP` を取得します。pytestの `tmp_path` フィクスチャがクリーンアップを自動的に処理します。

```python
# conftest.py — 基本的な `app` フィクスチャをこれに置き換える
import os, subprocess, pytest
from pywinauto import Application
from config import APP_PATH, APP_ARGS, APP_TITLE, LAUNCH_TIMEOUT, ACTION_TIMEOUT, ARTIFACT_DIR

@pytest.fixture(scope="function")
def app(request, tmp_path):
    """テストごとに新しいプロセス + 分離されたユーザーデータディレクトリ。"""
    if not APP_PATH:
        pytest.exit("APP_PATH が設定されていない", returncode=1)

    # 全てのユーザーストレージを分離されたtmpディレクトリにリダイレクト
    sandbox_env = os.environ.copy()
    sandbox_env["QT_ACCESSIBILITY"]  = "1"
    sandbox_env["APPDATA"]           = str(tmp_path / "AppData" / "Roaming")
    sandbox_env["LOCALAPPDATA"]      = str(tmp_path / "AppData" / "Local")
    sandbox_env["TEMP"] = sandbox_env["TMP"] = str(tmp_path / "Temp")
    for p in (sandbox_env["APPDATA"], sandbox_env["LOCALAPPDATA"], sandbox_env["TEMP"]):
        os.makedirs(p, exist_ok=True)

    if not APP_TITLE:
        pytest.exit("APP_TITLE 環境変数が設定されていない", returncode=1)

    # shlex.splitはスペースを含む引用符付き引数を処理；plain split()は壊れる
    import shlex
    # subprocessで起動して環境変数を渡し；PIDでpywinautoを接続
    proc = subprocess.Popen(
        [APP_PATH] + shlex.split(APP_ARGS),
        env=sandbox_env,
    )
    pw_app = Application(backend="uia").connect(process=proc.pid, timeout=LAUNCH_TIMEOUT)
    win    = pw_app.window(title=APP_TITLE)
    win.wait("visible", timeout=LAUNCH_TIMEOUT)
    yield win

    if getattr(getattr(request.node, "rep_call", None), "failed", False):
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        try:
            win.capture_as_image().save(
                os.path.join(ARTIFACT_DIR, f"FAIL_{request.node.name}.png")
            )
        except Exception:
            pass
    try:
        win.close()
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    # tmp_pathはpytestによって自動的にクリーンアップされる

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    setattr(item, f"rep_{outcome.get_result().when}", outcome.get_result())
```

### Tier 2 — Windowsジョブオブジェクト（オプション：プロセスライフタイムの封じ込め）

プロセスをジョブオブジェクトにアタッチして、テストフィクスチャのジョブハンドルがGCされたときに**自動的に終了**させます。また、フィクスチャのクリーンアップから逃れる子プロセスのスポーンも防止します。

> **分離のスコープ：** ジョブオブジェクトはファイルシステムアクセスの仮想化や
> ネットワークトラフィックのブロックを行いません。ファイル書き込みとネットワーク分離には
> AppContainer、Windowsファイアウォールルール、またはTier 3（Windowsサンドボックス）が必要です。
> Tier 2はプロセスライフタイムと子プロセスの封じ込めにのみ使用してください。

追加の依存関係は不要です。

```python
import ctypes, ctypes.wintypes as wt

def restrict_process(pid: int):
    """
    プロセスをジョブオブジェクトにアタッチして以下を防止：
    - ジョブ外でのプロセスのスポーン（LIMIT_KILL_ON_JOB_CLOSE）
    ネットワークはブロックしません — Windowsファイアウォールルールを使用してください。
    """
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    # 最小限の権限：SET_QUOTA (0x0100) | TERMINATE (0x0001)
    PROCESS_SET_QUOTA_AND_TERMINATE    = 0x0101

    kernel32 = ctypes.windll.kernel32
    job   = kernel32.CreateJobObjectW(None, None)
    hproc = kernel32.OpenProcess(PROCESS_SET_QUOTA_AND_TERMINATE, False, pid)

    # 正しい構造体レイアウト — LimitFlagsはオフセット+16（+44ではない）
    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", wt.LARGE_INTEGER),
            ("PerJobUserTimeLimit",     wt.LARGE_INTEGER),
            ("LimitFlags",             wt.DWORD),
            ("MinimumWorkingSetSize",   ctypes.c_size_t),
            ("MaximumWorkingSetSize",   ctypes.c_size_t),
            ("ActiveProcessLimit",      wt.DWORD),
            ("Affinity",               ctypes.c_size_t),
            ("PriorityClass",          wt.DWORD),
            ("SchedulingClass",        wt.DWORD),
        ]

    info = JOBOBJECT_BASIC_LIMIT_INFORMATION()
    info.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    ok = kernel32.SetInformationJobObject(job, 2, ctypes.byref(info), ctypes.sizeof(info))
    if not ok:
        raise ctypes.WinError()
    kernel32.AssignProcessToJobObject(job, hproc)
    kernel32.CloseHandle(hproc)
    return job  # 生存を維持 — ジョブが閉じると（GC時）プロセスが終了する

# proc = subprocess.Popen(...) の後：  job = restrict_process(proc.pid)
```

### Tier 3 — Windowsサンドボックス（CI完全OS分離）

実行ごとにクリーンなWindowsイメージが必要な場合（残留レジストリキーなし、共有GPUステートなし、真の分離）、[Windowsサンドボックス](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview)内で**テストスイート全体**を実行します。

**要件：** Windows 10/11 Pro またはエンタープライズ、仮想化が有効。

プロジェクトルートに `e2e-sandbox.wsb` を作成：

```xml
<Configuration>
  <MappedFolders>
    <!-- アプリバイナリ（読み取り専用） -->
    <MappedFolder>
      <HostFolder>C:\path\to\your\build\Release</HostFolder>
      <SandboxFolder>C:\app</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
    <!-- テストスイート（アーティファクト用に読み書き可能） -->
    <MappedFolder>
      <HostFolder>C:\path\to\your\e2e_test</HostFolder>
      <SandboxFolder>C:\e2e_test</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <!--
      WindowsサンドボックスはデフォルトでPythonがない。まずサイレントインストール、
      次に依存関係をインストールしてテストを実行する。アーティファクトは
      上記のMappedFolderを通じてホストに書き戻される。
    -->
    <Command>powershell -Command "
      winget install --id Python.Python.3.11 --silent --accept-package-agreements;
      $env:PATH += ';' + $env:LOCALAPPDATA + '\Programs\Python\Python311\Scripts';
      cd C:\e2e_test;
      pip install -r requirements.txt;
      pytest tests\ -v
    "</Command>
  </LogonCommand>
</Configuration>
```

起動：`WindowsSandbox.exe e2e-sandbox.wsb`

> pywinautoとアプリは両方ともサンドボックス**内**で実行されます（同じセッションが必要）。
> アーティファクトはマップされたフォルダーを通じてホストに書き戻されます。

### 階層の比較

| 階層 | 分離 | セットアップコスト | CIで動作 | 使用タイミング |
|------|-----------|-----------|-------------|----------|
| 1 — `tmp_path` 環境リダイレクト | ファイルシステム | ゼロ | 常に | 全テストのデフォルト |
| 2 — ジョブオブジェクト | プロセスツリー | 低 | 常に | 子プロセスの逃走を防止 |
| 3 — Windowsサンドボックス | 完全OS | 中 | Pro/Enterpriseイメージが必要 | 定期的なクリーンルーム実行 |

### テストのハングを防止する

`pytest-timeout` を追加して単一テストに上限を設けます。`pytest.ini` で `timeout = 60` と `timeout_method = thread` を設定します。注意：`thread` メソッドはWindows上でQtアプリのサブプロセスを終了できません — `conftest.py` に `atexit.register(lambda: [p.kill() for p in psutil.Process().children(recursive=True)])` を追加してオーファンを刈り取ってください。

## CI/CDインテグレーション

```yaml
# .github/workflows/e2e-desktop.yml
name: Desktop E2E
on: [push, pull_request]

jobs:
  e2e:
    runs-on: windows-latest   # 実際のGUI環境、Xvfb不要
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }

      - name: 依存関係をインストール
        run: pip install pywinauto pytest pytest-html Pillow

      - name: アプリをビルド
        run: cmake --build build --config Release  # ビルドシステムに合わせて調整

      - name: E2Eを実行
        env:
          APP_PATH: ${{ github.workspace }}\build\Release\MyApp.exe
          APP_TITLE: "My Application"
          CI: "true"
        run: pytest tests/ --html=artifacts/report.html --self-contained-html --junitxml=artifacts/results.xml -v

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-artifacts
          path: artifacts/
          retention-days: 14
```

## Qt固有

### Qt 5.xでのUIA有効化

Qt 5.xのアクセシビリティは一部のビルド（特に5.7〜5.14）でデフォルトが無効です。起動前に環境変数を設定してください。Qt 6.xはデフォルトでアクセシビリティが有効です — Qt 6ではこのステップをスキップしてください。

```python
# conftest.py — モジュールの先頭に追加
import os
os.environ["QT_ACCESSIBILITY"] = "1"
```

またはCIでエクスポート：

```yaml
env:
  QT_ACCESSIBILITY: "1"
```

### Qtウィジェットへの安定した識別子の追加

```cpp
// 優先：objectNameとaccessibleNameの両方
void setTestId(QWidget* w, const char* id) {
    w->setObjectName(id);
    w->setAccessibleName(id);  // UIA Nameプロパティになる
}

// ダイアログコンストラクタ内：
setTestId(ui->usernameEdit, "usernameInput");
setTestId(ui->passwordEdit, "passwordInput");
setTestId(ui->loginButton,  "btnLogin");
setTestId(ui->errorLabel,   "lblError");
```

タイポを避けるためにすべてのIDをヘッダーに集約：

```cpp
// test_ids.h
#define TID_USERNAME   "usernameInput"
#define TID_PASSWORD   "passwordInput"
#define TID_BTN_LOGIN  "btnLogin"
#define TID_LBL_ERROR  "lblError"
```

### Qt固有の注意点

**QComboBox** — ドロップダウンは別のトップレベルウィンドウです：

```python
from pywinauto import Desktop

def select_combo_item(page, combo_spec, item_text):
    page.click(combo_spec)
    # ドロップダウンは新しいルートレベルウィンドウとして表示される
    # class_nameはQtバージョンによって異なる — Accessibility Insightsで確認
    # Qt 5.x: "Qt5QWindowIcon"  |  Qt 6.x: "Qt6QWindowIcon" — Accessibility Insightsで確認
    popup = Desktop(backend="uia").window(class_name_re="Qt[56]QWindowIcon")
    popup.wait("visible", timeout=5)
    popup.child_window(title=item_text).click_input()
```

**QMessageBox / QDialog** — これも別のトップレベルウィンドウです：

```python
dlg = page.wait_window("Confirm")          # ダイアログタイトルを待つ
dlg.child_window(title="OK").click_input() # 内部のボタンをクリック
```

**QTableWidget / QTableView** — 行/セルアクセス：

```python
table = page.by_id("tblUsers").wrapper_object()
cell  = table.cell(row=0, column=1)
print(cell.window_text())
```

**自己描画コントロール**（`paintEvent`のみ、`QGraphicsView`、`QOpenGLWidget`）— UIAは内部を見ることができません。以下のフォールバックセクションを使用してください。

## フォールバック：スクリーンショットモード

コントロールがUIAで到達できない場合（自己描画、サードパーティ、ゲームエンジン）：

```bash
pip install pyautogui Pillow opencv-python
```

```python
import pyautogui, cv2, numpy as np
from PIL import Image

def find_image_on_screen(template_path, confidence=0.85):
    """画面上のテンプレート画像を探す。(x, y) の中心またはNoneを返す。"""
    screen   = np.array(pyautogui.screenshot())
    template = np.array(Image.open(template_path))
    result   = cv2.matchTemplate(
        cv2.cvtColor(screen, cv2.COLOR_RGB2BGR),
        cv2.cvtColor(template, cv2.COLOR_RGB2BGR),
        cv2.TM_CCOEFF_NORMED,
    )
    _, max_val, _, max_loc = cv2.minMaxLoc(result)
    if max_val >= confidence:
        h, w = template.shape[:2]
        return max_loc[0] + w // 2, max_loc[1] + h // 2
    return None

def click_image(template_path, confidence=0.85):
    pos = find_image_on_screen(template_path, confidence)
    if pos is None:
        raise RuntimeError(f"画面上で画像が見つからない：{template_path}")
    pyautogui.click(*pos)
```

**控えめに使用すること** — 画像マッチングはDPI変更、テーマ切り替え、部分的な遮蔽で壊れます。
常にUIAを最初に試し、本当に到達できないコントロールにのみスクリーンショットにフォールバックしてください。

## アンチパターン

```python
# BAD: 固定スリープ
time.sleep(3)
page.click(page.by_id("btnSubmit"))

# GOOD: 条件ウェイト
page.wait_visible(page.by_id("btnSubmit"))
page.click(page.by_id("btnSubmit"))
```

```python
# BAD: 主要戦略として脆弱なクラス+インデックスロケーター
page.by_class("Edit", index=2).type_keys("hello")

# GOOD: AutomationId
page.by_id("usernameInput").set_edit_text("hello")
```

```python
# BAD: ピクセル座標でのアサート
assert btn.rectangle().left == 120

# GOOD: コンテンツ/状態でのアサート
assert page.get_text(page.by_id("lblStatus")) == "Logged in"
assert page.by_id("btnLogout").is_enabled()
```

```python
# BAD: 全テストにわたってアプリインスタンスを共有（状態の漏洩）
@pytest.fixture(scope="session")
def app(): ...

# GOOD: テストごとに新しいプロセス（または最大でもクラスごと）
@pytest.fixture(scope="function")
def app(): ...
```

## テストの実行

```bash
# 全テスト
pytest tests/ -v

# スモークのみ
pytest tests/ -m smoke -v

# 特定ファイル
pytest tests/test_login.py -v

# カスタムアプリパスで実行
APP_PATH="C:\build\Release\MyApp.exe" APP_TITLE="MyApp" pytest tests/ -v

# 不安定なテストを検出（各テストを5回繰り返す）
pip install pytest-repeat
pytest tests/test_login.py --count=5 -v
```

## 関連スキル

- `e2e-testing` — WebアプリケーションのPlaywright E2Eテスト
- `cpp-testing` — GoogleTestを使用したC++ユニット/統合テスト
- `cpp-coding-standards` — C++コードスタイルとパターン
