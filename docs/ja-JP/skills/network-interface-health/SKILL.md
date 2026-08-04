---
name: network-interface-health
description: ルーター、スイッチ、Linuxホスト上のインターフェースエラー、ドロップ、CRC、デュプレックス不一致、フラッピング、速度ネゴシエーション問題、カウンタートレンドを診断する。
origin: community
---

# ネットワークインターフェースヘルス

ネットワークの症状が物理リンク、スイッチポート、ケーブル、トランシーバー、デュプレックス設定、または輻輳したインターフェースによって引き起こされている可能性がある場合にこのスキルを使用する。

## 使用するタイミング

- ホストまたはVLANにパケットロス、レイテンシスパイク、または断続的な到達不能がある。
- スイッチまたはルーターのインターフェースにCRC、ランツ、ジャイアント、ドロップ、リセット、またはフラップが表示されている。
- ハードウェアを交換する前にリンクの両端を比較する必要がある。
- 変更ウィンドウでインターフェースカウンターの前後の証拠が必要。
- 監視が`ifInErrors`、`ifOutErrors`、または`ifOutDiscards`の増加を報告している。

## 仕組み

インターフェースカウンターは証拠だが、絶対値よりもトレンドの方が重要である。ベースラインを取得し、測定間隔を待ち、再度取得してから増分を比較する。

```text
show interfaces <interface>
show interfaces <interface> status
show logging | include <interface>|changed state|line protocol
```

Linuxホストの場合:

```text
ip -s link show <interface>
ethtool <interface>
ethtool -S <interface>
```

## カウンターリファレンス

| カウンター | 意味 | 一般的な原因 |
| --- | --- | --- |
| CRC | 受信フレームのチェックサムが失敗 | 不良ケーブル、汚れたファイバー、不良オプティック、デュプレックス不一致 |
| input errors | 受信側エラーの集計 | 結論を出す前にサブカウンターを確認 |
| runts | 最小イーサネットサイズ未満のフレーム | デュプレックス不一致、コリジョンドメイン、不良NIC |
| giants | 期待されるMTUより大きいフレーム | MTU不一致またはジャンボフレーム境界 |
| input drops | デバイスがインバウンドパケットを受け入れられなかった | バースト、オーバーサブスクリプション、CPUパス、キュー圧迫 |
| output drops | 送信キューがパケットを廃棄した | 輻輳、QoSポリシー、サイズ不足のアップリンク |
| resets | インターフェースハードウェアリセット | フラッピング、キープアライブ、ドライバー、オプティック、電源 |
| collisions | イーサネットコリジョンカウンター | ハーフデュプレックスまたはネゴシエーション不一致 |

## 診断フロー

### CRCまたは入力エラー

1. カウンターが増加していることを確認する（歴史的なものだけでなく）。
2. リンクの両端を確認する。受信側エラーは通常、エラーを報告しているポートではなく、その側に到着する信号を指す。
3. パッチケーブルを交換するか、ファイバーとオプティクスを清掃/交換する。
4. 両側で速度/デュプレックス設定が一致していることを確認する。
5. 同じタイムスタンプ前後のフラップイベントのログを確認する。

### ドロップ

1. 入力ドロップと出力ドロップを分離する。
2. インターフェースレートを容量と比較する。
3. QoSポリシー、キューカウンター、リンクがオーバーサブスクリプションのアップリンクかどうかを確認する。
4. キューチューニングは二次的な処置として扱う。まずリンクが輻輳しているかどうかを証明する。

### デュプレックスと速度

両側がサポートしている場合、最新のイーサネットリンクではオートネゴシエーションを優先する。一方の側を固定する必要がある場合は、両側を明示的に設定し、理由を文書化する。一方をfixed speed/duplexに設定し、もう一方をautoにすることは絶対にしてはならない。

```text
show interfaces <interface> | include duplex|speed
```

## 安全なパーサーの例

各インターフェースブロックを1つのヘッダーから次のヘッダーまでスライスする。任意の文字ウィンドウを使用しないこと。大きなインターフェースブロックはカウンターが欠落したり、誤ったポートに割り当てられたりする可能性がある。

```python
import re
from typing import Any

HEADER_RE = re.compile(
    r"^(?P<name>\S+) is (?P<status>(?:administratively )?down|up), "
    r"line protocol is (?P<protocol>up|down)",
    re.I | re.M,
)
ERROR_RE = re.compile(r"(?P<input>\d+) input errors, (?P<crc>\d+) CRC", re.I)
DROP_RE = re.compile(r"(?P<output>\d+) output errors", re.I)
DUPLEX_RE = re.compile(r"(?P<duplex>Full|Half|Auto)-duplex,\s+(?P<speed>[^,]+)", re.I)

def parse_show_interfaces(raw: str) -> list[dict[str, Any]]:
    headers = list(HEADER_RE.finditer(raw))
    interfaces = []
    for index, header in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(raw)
        block = raw[header.start():end]
        errors = ERROR_RE.search(block)
        drops = DROP_RE.search(block)
        duplex = DUPLEX_RE.search(block)
        interfaces.append({
            "name": header.group("name"),
            "status": header.group("status"),
            "protocol": header.group("protocol"),
            "duplex": duplex.group("duplex") if duplex else "unknown",
            "speed": duplex.group("speed").strip() if duplex else "unknown",
            "input_errors": int(errors.group("input")) if errors else 0,
            "crc_errors": int(errors.group("crc")) if errors else 0,
            "output_errors": int(drops.group("output")) if drops else 0,
        })
    return interfaces
```

## 例

### 1つのスイッチポートのCRC

1. ローカルポートのカウンターを取得する。
2. 接続されたリモートポートのカウンターを取得する。
3. ルーティングやファイアウォールルールを変更する前にケーブルまたはオプティクスを交換する。
4. ベースラインを記録した後にのみカウンターをクリアする。
5. 一定間隔後に再確認する。

### インターネットは遅いがLANは正常

1. WANインターフェースのドロップ/エラーを確認する。
2. LANアップリンクの利用率と出力ドロップを確認する。
3. WANリンクがクリーンでもスループットが低い場合はゲートウェイCPUを確認する。
4. 上流サービスを責める前に有線と無線のテストを比較する。

## アンチパターン

- ベースラインを保存する前にカウンターをクリアする。
- リンクの一方の側だけを確認する。
- 時間ウィンドウなしで過去のすべてのCRCをアクティブな問題と仮定する。
- 一方の側でオートネゴシエーションを使用し、もう一方で固定速度/デュプレックスを使用する。
- 輻輳を確認する前に出力ドロップをケーブル問題として扱う。

## 関連情報

- エージェント: `network-troubleshooter`
- スキル: `network-config-validation`
- スキル: `homelab-network-setup`
