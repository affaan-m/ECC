---
name: cisco-ios-patterns
description: showコマンド、コンフィグ階層、ワイルドカードマスク、ACL配置、インターフェースハイジーン、安全な変更ウィンドウ検証のためのCisco IOSおよびIOS-XEレビューパターン。
origin: community
---

# Cisco IOSパターン

Cisco IOSまたはIOS-XEスニペットをレビューする場合、変更ウィンドウチェックリストを構築する場合、またはルーターまたはスイッチから証拠を収集し、インシデントを悪化させない方法を説明する場合に、このスキルを使用します。

## 使用時期

- 計画的な変更前にIOSまたはIOS-XE構成をレビュー。
- トラブルシューティングの読み取り専用`show`コマンドを選択。
- ACLワイルドカードマスクとインターフェース方向をチェック。
- グローバル、インターフェース、ルーティングプロセス、ラインコンフィグレーションモードを説明。
- 変更がランニング構成で実行され、意図的に保存されたことを確認。

## 操作規則

IOSの例をパターンとして、本番環境に対応した変更として扱いません。実際のデバイスで変更を加える前に、プラットフォーム、インターフェース名、現在の構成、ロールバックパス、アウトオブバンドアクセスを確認してください。

このワークフロー好みます：

1. 読み取り専用コマンドで現在の状態をキャプチャ。
2. 正確な候補構成をレビュー。
3. 管理アクセスがロックアウトされていないことを確認。
4. メンテナンスウィンドウで最小の変更を適用。
5. 状態を再度読み、ベースラインと比較し、検証後にのみ保存。

## モード参照

```text
Router> enable
Router# show running-config
Router# configure terminal
Router(config)# interface GigabitEthernet0/1
Router(config-if)# description UPLINK-TO-CORE
Router(config-if)# no shutdown
Router(config-if)# exit
Router(config)# end
Router# show running-config interface GigabitEthernet0/1
```

`running-config`はアクティブメモリ。`startup-config`はリロード後に生き残ります。
コマンドが受け入れられただけという理由で変更を保存しないでください。最初に動作を検証し、変更が承認された場合は`copy running-config startup-config`を使用します。

## 読み取り専用コレクション

```text
show version
show inventory
show processes cpu sorted
show memory statistics
show logging
show running-config | section line vty
show running-config | section interface
show running-config | section router bgp
show ip interface brief
show interfaces
show interfaces status
show vlan brief
show mac address-table
show spanning-tree
show ip route
show ip protocols
show ip access-lists
show route-map
show ip prefix-list
```

構成に秘密、顧客名、またはプライベートトポロジが含まれる可能性があるため、完全な構成をチケットにダンプするのではなく、必要な特定のセクションを収集してください。

## ワイルドカードマスク

IOS ACLおよび多くのルーティングステートメントでは、サブネットマスクではなくワイルドカードマスクを使用します。

```text
Subnet mask       Wildcard mask
255.255.255.255   0.0.0.0
255.255.255.252   0.0.0.3
255.255.255.0     0.0.0.255
255.255.0.0       0.0.255.255
```

デプロイメント前にワイルドカードマスクをレビュー。サブネットマスクがワイルドカードとして誤ってマスクされて使用されると、意図した以上のトラフィックに一致する可能性があります。

```text
ip access-list extended WEB-IN
  10 permit tcp 192.0.2.0 0.0.0.255 any eq 443
  999 deny ip any any log
```
