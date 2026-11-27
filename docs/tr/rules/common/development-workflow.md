# Geliştirme İş Akışı

> Bu dosya [common/git-workflow.md](./git-workflow.md) dosyasını git işlemlerinden önce gerçekleşen tam özellik geliştirme süreci ile genişletir.

Feature Implementation Workflow geliştirme pipeline'ını tanımlar: araştırma, planlama, TDD, kod incelemesi ve ardından git'e commit.

## Feature Uygulama İş Akışı

0. **Araştırma & Yeniden Kullanım** _(her yeni implementasyondan önce zorunlu)_
   - **Önce GitHub kod araması:** Yeni bir şey yazmadan önce mevcut implementasyonları, şablonları ve pattern'leri bulmak için `gh search repos` ve `gh search code` çalıştır.
   - **İkinci olarak kütüphane dokümanları:** Uygulamadan önce API davranışını, paket kullanımını ve versiyona özgü detayları doğrulamak için Context7 veya birincil vendor dokümanlarını kullan.
   - **İlk ikisi yetersiz olduğunda Exa:** GitHub araması ve birincil dokümanlardan sonra daha geniş web araştırması veya keşif için Exa kullan.
   - **Paket kayıtlarını kontrol et:** Utility kodu yazmadan önce npm, PyPI, crates.io ve diğer kayıtları ara. Kendi çözümlerinden ziyade test edilmiş kütüphaneleri tercih et.
   - **Adapte edilebilir implementasyonlar ara:** Problemin %80+'sını çözen ve fork'lanabilir, port edilebilir veya wrap edilebilir açık kaynak projeler ara.
   - Gereksinimi karşıladığında sıfırdan yeni kod yazmak yerine kanıtlanmış bir yaklaşımı benimsemeyi veya port etmeyi tercih et.

1. **Önce Planla**
   - Uygulama planı oluşturmak için **planner** agent kullan
   - Kodlamadan önce planlama dokümanları oluştur: PRD, architecture, system_design, tech_doc, task_list
   - Bağımlılıkları ve riskleri belirle
   - Fazlara ayır

2. **TDD Yaklaşımı**
   - **tdd-guide** agent kullan
   - Önce testleri yaz (RED)
   - Testleri geçmek için uygula (GREEN)
   - Refactor et (IMPROVE)
   - %80+ coverage'ı doğrula

3. **Kod İncelemesi**
   - Kod yazdıktan hemen sonra **code-reviewer** agent kullan
   - CRITICAL ve HIGH sorunları ele al
   - Mümkün olduğunda MEDIUM sorunları düzelt

4. **Commit & Push**
   - Detaylı commit mesajları
   - Conventional commits formatını takip et
   - Commit mesaj formatı ve PR süreci için [git-workflow.md](./git-workflow.md) dosyasına bak
