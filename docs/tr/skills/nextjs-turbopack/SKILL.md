---
name: nextjs-turbopack
description: Next.js 16+ and Turbopack — incremental bundling, FS caching, dev speed, and when to use Turbopack vs webpack.
origin: ECC
---

# Next.js ve Turbopack

Next.js 16+ yerel geliştirme için varsayılan olarak Turbopack kullanır: geliştirme başlatma ve hot update'leri önemli ölçüde hızlandıran Rust ile yazılmış artımlı bir bundler.

## Ne Zaman Kullanılır

- **Turbopack (varsayılan dev)**: Günlük geliştirme için kullanın. Özellikle büyük uygulamalarda daha hızlı soğuk başlatma ve HMR.
- **Webpack (legacy dev)**: Sadece bir Turbopack bug'ına denk gelirseniz veya dev'de webpack'e özgü bir plugin'e güveniyorsanız kullanın. `--webpack` ile devre dışı bırakın (veya Next.js sürümünüze bağlı olarak `--no-turbopack`; sürümünüz için dokümanlara bakın).
- **Production**: Production build davranışı (`next build`) Next.js sürümüne bağlı olarak Turbopack veya webpack kullanabilir; sürümünüz için resmi Next.js dokümantasyonunu kontrol edin.

Şu durumlarda kullanın: Next.js 16+ uygulamalarını geliştirme veya debug etme, yavaş dev başlatma veya HMR'yi teşhis etme veya production bundle'larını optimize etme.

## Nasıl Çalışır

- **Turbopack**: Next.js dev için artımlı bundler. Dosya sistemi önbelleği kullanır, böylece yeniden başlatmalar çok daha hızlıdır (örn. büyük projelerde 5-14x).
- **Dev'de varsayılan**: Next.js 16'dan itibaren, `next dev` devre dışı bırakılmadıkça Turbopack ile çalışır.
- **Dosya sistemi önbelleği**: Yeniden başlatmalar önceki çalışmayı yeniden kullanır; önbellek genellikle `.next` altındadır; temel kullanım için ekstra yapılandırma gerekmez.
- **Bundle Analyzer (Next.js 16.1+)**: Çıktıyı incelemek ve ağır bağımlılıkları bulmak için deneysel Bundle Analyzer; config veya deneysel bayrak ile etkinleştirin (sürümünüz için Next.js dokümantasyonuna bakın).

## Örnekler

### Komutlar

```bash
next dev
next build
next start
```

### Kullanım

Turbopack ile yerel geliştirme için `next dev` çalıştırın. Code-splitting'i optimize etmek ve büyük bağımlılıkları kırpmak için Bundle Analyzer'ı kullanın (Next.js dokümantasyonuna bakın). Mümkün olduğunda App Router ve server component'leri tercih edin.

## En İyi Uygulamalar

- Kararlı Turbopack ve önbellekleme davranışı için güncel bir Next.js 16.x sürümünde kalın.
- Dev yavaşsa, Turbopack'te (varsayılan) olduğunuzdan ve önbelleğin gereksiz yere temizlenmediğinden emin olun.
- Production bundle boyutu sorunları için, sürümünüz için resmi Next.js bundle analiz araçlarını kullanın.
