---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# TypeScript/JavaScript Hooks

> Bu dosya [common/hooks.md](../common/hooks.md) dosyasını TypeScript/JavaScript'e özgü içerikle genişletir.

## PostToolUse Hooks

`~/.claude/settings.json` içinde yapılandır:

- **Prettier**: Edit'ten sonra JS/TS dosyalarını otomatik formatla
- **TypeScript check**: `.ts`/`.tsx` dosyalarını düzenledikten sonra `tsc` çalıştır
- **console.log uyarısı**: Düzenlenen dosyalarda `console.log` hakkında uyar

## Stop Hooks

- **console.log audit**: Session bitmeden önce değiştirilen tüm dosyalarda `console.log` kontrolü yap
