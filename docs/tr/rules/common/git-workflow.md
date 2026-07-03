# Git İş Akışı

## Commit Mesaj Formatı
```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Not: Ortak yazar atfını devre dışı bırakmak için `~/.claude/settings.json` içinde `"includeCoAuthoredBy": false` ayarlayın; Claude Code varsayılan olarak `Co-Authored-By` ekler ve ECC bu ayarı içermez.

## Pull Request İş Akışı

PR oluştururken:
1. Tam commit geçmişini analiz et (sadece son commit değil)
2. Tüm değişiklikleri görmek için `git diff [base-branch]...HEAD` kullan
3. Kapsamlı PR özeti taslağı hazırla
4. TODO'ları içeren test planı ekle
5. Yeni branch ise `-u` flag'i ile push et

> Git işlemlerinden önce tam geliştirme süreci (planlama, TDD, kod incelemesi) için
> [development-workflow.md](./development-workflow.md) dosyasına bakın.
