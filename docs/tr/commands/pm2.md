# PM2 Init

Projeyi otomatik analiz et ve PM2 servis komutları oluştur.

**Komut**: `$ARGUMENTS`

---

## İş Akışı

1. PM2'yi kontrol et (yoksa `npm install -g pm2` ile yükle)
2. Servisleri (frontend/backend/database) tanımlamak için projeyi tara
3. Config dosyaları ve bireysel komut dosyaları oluştur

---

## Servis Tespiti

| Tip | Tespit | Varsayılan Port |
|------|-----------|--------------|
| Vite | vite.config.* | 5173 |
| Next.js | next.config.* | 3000 |
| Nuxt | nuxt.config.* | 3000 |
| CRA | package.json'da react-scripts | 3000 |
| Express/Node | server/backend/api dizini + package.json | 3000 |
| FastAPI/Flask | requirements.txt / pyproject.toml | 8000 |
| Go | go.mod / main.go | 8080 |

**Port Tespit Önceliği**: Kullanıcı belirtimi > .env > config dosyası > script argümanları > varsayılan port

---

## Oluşturulan Dosyalar

```
project/
├── ecosystem.config.cjs              # PM2 config
├── {backend}/start.cjs               # Python wrapper (geçerliyse)
└── .claude/
    ├── commands/
    │   ├── pm2-all.md                # Hepsini başlat + monit
    │   ├── pm2-all-stop.md           # Hepsini durdur
    │   ├── pm2-all-restart.md        # Hepsini yeniden başlat
    │   ├── pm2-{port}.md             # Tekli başlat + logs
    │   ├── pm2-{port}-stop.md        # Tekli durdur
    │   ├── pm2-{port}-restart.md     # Tekli yeniden başlat
    │   ├── pm2-logs.md               # Tüm logları göster
    │   └── pm2-status.md             # Durumu göster
    └── scripts/
        ├── pm2-logs-{port}.ps1       # Tekli servis logları
        └── pm2-monit.ps1             # PM2 monitor
```

---

## Windows Konfigürasyonu (ÖNEMLİ)

### ecosystem.config.cjs

**`.cjs` uzantısı kullanmalı**

```javascript
module.exports = {
  apps: [
    // Node.js (Vite/Next/Nuxt)
    {
      name: 'project-3000',
      cwd: './packages/web',
      script: 'node_modules/vite/bin/vite.js',
      args: '--port 3000',
      interpreter: 'C:/Program Files/nodejs/node.exe',
      env: { NODE_ENV: 'development' }
    },
    // Python
    {
      name: 'project-8000',
      cwd: './backend',
      script: 'start.cjs',
      interpreter: 'C:/Program Files/nodejs/node.exe',
      env: { PYTHONUNBUFFERED: '1' }
    }
  ]
}
```

**Framework script yolları:**

| Framework | script | args |
|-----------|--------|------|
| Vite | `node_modules/vite/bin/vite.js` | `--port {port}` |
| Next.js | `node_modules/next/dist/bin/next` | `dev -p {port}` |
| Nuxt | `node_modules/nuxt/bin/nuxt.mjs` | `dev --port {port}` |
| Express | `src/index.js` veya `server.js` | - |

### Python Wrapper Script (start.cjs)

```javascript
const { spawn } = require('child_process');
const proc = spawn('python', ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'], {
  cwd: __dirname, stdio: 'inherit', windowsHide: true
});
proc.on('close', (code) => process.exit(code));
```

---

## Komut Dosyası Şablonları (Minimal İçerik)

### pm2-all.md (Hepsini başlat + monit)
````markdown
Tüm servisleri başlat ve PM2 monitör aç.
```bash
cd "{PROJECT_ROOT}" && pm2 start ecosystem.config.cjs && start wt.exe -d "{PROJECT_ROOT}" pwsh -NoExit -c "pm2 monit"
```
````

### pm2-all-stop.md
````markdown
Tüm servisleri durdur.
```bash
cd "{PROJECT_ROOT}" && pm2 stop all
```
````

### pm2-all-restart.md
````markdown
Tüm servisleri yeniden başlat.
```bash
cd "{PROJECT_ROOT}" && pm2 restart all
```
````

### pm2-{port}.md (Tekli başlat + logs)
````markdown
{name} ({port}) başlat ve logları aç.
```bash
cd "{PROJECT_ROOT}" && pm2 start ecosystem.config.cjs --only {name} && start wt.exe -d "{PROJECT_ROOT}" pwsh -NoExit -c "pm2 logs {name}"
```
````

### pm2-{port}-stop.md
````markdown
{name} ({port}) durdur.
```bash
cd "{PROJECT_ROOT}" && pm2 stop {name}
```
````

### pm2-{port}-restart.md
````markdown
{name} ({port}) yeniden başlat.
```bash
cd "{PROJECT_ROOT}" && pm2 restart {name}
```
````

### pm2-logs.md
````markdown
Tüm PM2 loglarını göster.
```bash
cd "{PROJECT_ROOT}" && pm2 logs
```
````

### pm2-status.md
````markdown
PM2 durumunu göster.
```bash
cd "{PROJECT_ROOT}" && pm2 status
```
````

### PowerShell Scripts (pm2-logs-{port}.ps1)
```powershell
Set-Location "{PROJECT_ROOT}"
pm2 logs {name}
```

### PowerShell Scripts (pm2-monit.ps1)
```powershell
Set-Location "{PROJECT_ROOT}"
pm2 monit
```

---

## Ana Kurallar

1. **Config dosyası**: `ecosystem.config.cjs` (.js değil)
2. **Node.js**: Bin yolunu doğrudan belirt + interpreter
3. **Python**: Node.js wrapper script + `windowsHide: true`
4. **Yeni pencere aç**: `start wt.exe -d "{path}" pwsh -NoExit -c "command"`
5. **Minimal içerik**: Her komut dosyası sadece 1-2 satır açıklama + bash bloğu
6. **Doğrudan çalıştırma**: AI ayrıştırması gerekmez, sadece bash komutunu çalıştır

---

## Çalıştır

`$ARGUMENTS`'a göre init'i çalıştır:

1. Servisleri taramak için projeyi tara
2. `ecosystem.config.cjs` oluştur
3. Python servisleri için `{backend}/start.cjs` oluştur (geçerliyse)
4. `.claude/commands/` dizininde komut dosyaları oluştur
5. `.claude/scripts/` dizininde script dosyaları oluştur
6. **Proje CLAUDE.md'yi PM2 bilgisiyle güncelle** (aşağıya bakın)
7. **Terminal komutlarıyla tamamlama özetini göster**

---

## Post-Init: CLAUDE.md'yi Güncelle

Dosyalar oluşturulduktan sonra, projenin `CLAUDE.md` dosyasına PM2 bölümünü ekle (yoksa oluştur):

````markdown
## PM2 Services

| Port | Name | Type |
|------|------|------|
| {port} | {name} | {type} |

**Terminal Commands:**
```bash
pm2 start ecosystem.config.cjs   # İlk seferinde
pm2 start all                    # İlk seferinden sonra
pm2 stop all / pm2 restart all
pm2 start {name} / pm2 stop {name}
pm2 logs / pm2 status / pm2 monit
pm2 save                         # Process listesini kaydet
pm2 resurrect                    # Kaydedilen listeyi geri yükle
```
````

**CLAUDE.md güncelleme kuralları:**
- PM2 bölümü varsa, değiştir
- Yoksa, sona ekle
- İçeriği minimal ve temel tut

---

## Post-Init: Özet Göster

Tüm dosyalar oluşturulduktan sonra, çıktı:

```
## PM2 Init Complete

**Services:**

| Port | Name | Type |
|------|------|------|
| {port} | {name} | {type} |

**Claude Commands:** /pm2-all, /pm2-all-stop, /pm2-{port}, /pm2-{port}-stop, /pm2-logs, /pm2-status

**Terminal Commands:**
## İlk seferinde (config dosyasıyla)
pm2 start ecosystem.config.cjs && pm2 save

## İlk seferinden sonra (basitleştirilmiş)
pm2 start all          # Hepsini başlat
pm2 stop all           # Hepsini durdur
pm2 restart all        # Hepsini yeniden başlat
pm2 start {name}       # Tekli başlat
pm2 stop {name}        # Tekli durdur
pm2 logs               # Logları göster
pm2 monit              # Monitor paneli
pm2 resurrect          # Kaydedilen process'leri geri yükle

**İpucu:** Basitleştirilmiş komutları etkinleştirmek için ilk başlatmadan sonra `pm2 save` çalıştırın.
```
