# Güvenlik Politikası

## Desteklenen Sürümler

| Sürüm   | Destekleniyor      |
| ------- | ------------------ |
| 1.9.x   | :white_check_mark: |
| 1.8.x   | :white_check_mark: |
| < 1.8   | :x:                |

## Güvenlik Açığı Bildirimi

ECC'de bir güvenlik açığı keşfederseniz, lütfen sorumlu bir şekilde bildirin.

**Güvenlik açıkları için herkese açık GitHub issue açmayın.**

Bunun yerine, **<security@ecc.tools>** adresine aşağıdaki bilgilerle e-posta gönderin:

- Güvenlik açığının açıklaması
- Yeniden oluşturma adımları
- Etkilenen sürüm(ler)
- Potansiyel etki değerlendirmesi

Beklentileriniz:

- 48 saat içinde **onay**
- 7 gün içinde **durum güncellemesi**
- Kritik sorunlar için 30 gün içinde **düzeltme veya azaltma**

Güvenlik açığı kabul edilirse:

- Sürüm notlarında size teşekkür edeceğiz (anonim kalmayı tercih etmiyorsanız)
- Sorunu zamanında düzelteceğiz
- Açıklama zamanlamasını sizinle koordine edeceğiz

Güvenlik açığı reddedilirse, nedenini açıklayacağız ve başka bir yere bildirilmesi gerekip gerekmediği konusunda rehberlik sağlayacağız.

## Kapsam

Bu politika aşağıdakileri kapsar:

- ECC eklentisi ve bu depodaki tüm script'ler
- Makinenizde çalışan hook script'leri
- Install/uninstall/repair yaşam döngüsü script'leri
- ECC ile birlikte gelen MCP konfigürasyonları
- AgentShield güvenlik tarayıcısı ([github.com/affaan-m/agentshield](https://github.com/affaan-m/agentshield))

## Güvenlik Kaynakları

- **AgentShield**: Agent konfigürasyonunuzu güvenlik açıkları için tarayın — `npx ecc-agentshield scan`
- **Güvenlik Kılavuzu**: [The Shorthand Guide to Everything Agentic Security](./the-security-guide.md)
- **OWASP MCP Top 10**: [owasp.org/www-project-mcp-top-10](https://owasp.org/www-project-mcp-top-10/)
- **OWASP Agentic Applications Top 10**: [genai.owasp.org](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
