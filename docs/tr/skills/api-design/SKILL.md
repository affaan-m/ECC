---
name: api-design
description: REST API tasarım kalıpları; kaynak isimlendirme, durum kodları, sayfalama, filtreleme, hata yanıtları, versiyonlama ve üretim API'leri için hız sınırlama içerir.
origin: ECC
---

# API Tasarım Kalıpları

Tutarlı, geliştirici dostu REST API'leri tasarlamak için konvansiyonlar ve en iyi uygulamalar.

## Ne Zaman Aktifleştirmeli

- Yeni API endpoint'leri tasarlarken
- Mevcut API sözleşmelerini incelerken
- Sayfalama, filtreleme veya sıralama eklerken
- API'ler için hata işleme uygularken
- API versiyonlama stratejisi planlarken
- Halka açık veya iş ortağı odaklı API'ler oluştururken

## Kaynak Tasarımı

### URL Yapısı

```
# Kaynaklar isim, çoğul, küçük harf, kebab-case
GET    /api/v1/users
GET    /api/v1/users/:id
POST   /api/v1/users
PUT    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

# İlişkiler için alt kaynaklar
GET    /api/v1/users/:id/orders
POST   /api/v1/users/:id/orders

# CRUD'a uymayan aksiyonlar (fiilleri dikkatli kullanın)
POST   /api/v1/orders/:id/cancel
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
```

### İsimlendirme Kuralları

```
# İYİ
/api/v1/team-members          # çok sözcüklü kaynaklar için kebab-case
/api/v1/orders?status=active  # filtreleme için query parametreleri
/api/v1/users/123/orders      # sahiplik için iç içe kaynaklar

# KÖTÜ
/api/v1/getUsers              # URL'de fiil
/api/v1/user                  # tekil (çoğul kullanın)
/api/v1/team_members          # URL'lerde snake_case
/api/v1/users/123/getOrders   # iç içe kaynaklarda fiil
```

## HTTP Metodları ve Durum Kodları

### Metod Semantiği

| Metod | Idempotent | Güvenli | Kullanım Amacı |
|--------|-----------|------|---------|
| GET | Evet | Evet | Kaynakları getir |
| POST | Hayır | Hayır | Kaynak oluştur, aksiyonları tetikle |
| PUT | Evet | Hayır | Kaynağın tam değişimi |
| PATCH | Hayır* | Hayır | Kaynağın kısmi güncellemesi |
| DELETE | Evet | Hayır | Kaynağı kaldır |

*PATCH uygun implementasyonla idempotent yapılabilir

### Durum Kodu Referansı

```
# Başarı
200 OK                    — GET, PUT, PATCH (yanıt body'si ile)
201 Created               — POST (Location header ekleyin)
204 No Content            — DELETE, PUT (yanıt body'si yok)

# İstemci Hataları
400 Bad Request           — Validasyon hatası, hatalı JSON
401 Unauthorized          — Eksik veya geçersiz kimlik doğrulama
403 Forbidden             — Kimlik doğrulandı ama yetkilendirilmedi
404 Not Found             — Kaynak mevcut değil
409 Conflict              — Tekrar kayıt, durum çakışması
422 Unprocessable Entity  — Semantik olarak geçersiz (geçerli JSON, kötü veri)
429 Too Many Requests     — Hız limiti aşıldı

# Sunucu Hataları
500 Internal Server Error — Beklenmeyen hata (detayları açığa çıkarmayın)
502 Bad Gateway           — Upstream servis başarısız
503 Service Unavailable   — Geçici aşırı yük, Retry-After ekleyin
```

### Yaygın Hatalar

```
# KÖTÜ: Her şey için 200
{ "status": 200, "success": false, "error": "Not found" }

# İYİ: HTTP durum kodlarını semantik olarak kullanın
HTTP/1.1 404 Not Found
{ "error": { "code": "not_found", "message": "User not found" } }

# KÖTÜ: Validasyon hataları için 500
# İYİ: Alan düzeyinde detaylarla 400 veya 422

# KÖTÜ: Oluşturulan kaynaklar için 200
# İYİ: Location header ile 201
HTTP/1.1 201 Created
Location: /api/v1/users/abc-123
```

## Yanıt Formatı

### Başarı Yanıtı

```json
{
  "data": {
    "id": "abc-123",
    "email": "alice@example.com",
    "name": "Alice",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

### Koleksiyon Yanıtı (Sayfalama ile)

```json
{
  "data": [
    { "id": "abc-123", "name": "Alice" },
    { "id": "def-456", "name": "Bob" }
  ],
  "meta": {
    "total": 142,
    "page": 1,
    "per_page": 20,
    "total_pages": 8
  },
  "links": {
    "self": "/api/v1/users?page=1&per_page=20",
    "next": "/api/v1/users?page=2&per_page=20",
    "last": "/api/v1/users?page=8&per_page=20"
  }
}
```

### Hata Yanıtı

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address",
        "code": "invalid_format"
      },
      {
        "field": "age",
        "message": "Must be between 0 and 150",
        "code": "out_of_range"
      }
    ]
  }
}
```

### Yanıt Zarfı Varyantları

```typescript
// Seçenek A: Data sarmalayıcılı zarf (halka açık API'ler için önerilir)
interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
  links?: PaginationLinks;
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: FieldError[];
  };
}

// Seçenek B: Düz yanıt (daha basit, dahili API'ler için yaygın)
// Başarı: kaynağı doğrudan döndür
// Hata: hata nesnesini döndür
// HTTP durum koduyla ayırt et
```

## Sayfalama

### Offset-Tabanlı (Basit)

```
GET /api/v1/users?page=2&per_page=20

# Implementasyon
SELECT * FROM users
ORDER BY created_at DESC
LIMIT 20 OFFSET 20;
```

**Artıları:** Uygulaması kolay, "N sayfasına git" destekler
**Eksileri:** Büyük offset'lerde yavaş (OFFSET 100000), eş zamanlı eklemelerde tutarsız

### Cursor-Tabanlı (Ölçeklenebilir)

```
GET /api/v1/users?cursor=eyJpZCI6MTIzfQ&limit=20

# Implementasyon
SELECT * FROM users
WHERE id > :cursor_id
ORDER BY id ASC
LIMIT 21;  -- has_next belirlemek için bir fazla getir
```

```json
{
  "data": [...],
  "meta": {
    "has_next": true,
    "next_cursor": "eyJpZCI6MTQzfQ"
  }
}
```

**Artıları:** Pozisyondan bağımsız tutarlı performans, eş zamanlı eklemelerde kararlı
**Eksileri:** Rastgele sayfaya atlayamaz, cursor opak

### Hangisi Ne Zaman Kullanılmalı

| Kullanım Senaryosu | Sayfalama Tipi |
|----------|----------------|
| Admin panelleri, küçük veri setleri (<10K) | Offset |
| Sonsuz kaydırma, akışlar, büyük veri setleri | Cursor |
| Halka açık API'ler | Cursor (varsayılan) ile offset (opsiyonel) |
| Arama sonuçları | Offset (kullanıcılar sayfa numarası bekler) |

## Filtreleme, Sıralama ve Arama

### Filtreleme

```
# Basit eşitlik
GET /api/v1/orders?status=active&customer_id=abc-123

# Karşılaştırma operatörleri (köşeli parantez notasyonu kullanın)
GET /api/v1/products?price[gte]=10&price[lte]=100
GET /api/v1/orders?created_at[after]=2025-01-01

# Çoklu değerler (virgülle ayrılmış)
GET /api/v1/products?category=electronics,clothing

# İç içe alanlar (nokta notasyonu)
GET /api/v1/orders?customer.country=US
```

### Sıralama

```
# Tek alan (azalan için - öneki)
GET /api/v1/products?sort=-created_at

# Çoklu alanlar (virgülle ayrılmış)
GET /api/v1/products?sort=-featured,price,-created_at
```

### Tam Metin Arama

```
# Arama query parametresi
GET /api/v1/products?q=wireless+headphones

# Alana özel arama
GET /api/v1/users?email=alice
```

### Seyrek Fieldset'ler

```
# Sadece belirtilen alanları döndür (payload'ı azaltır)
GET /api/v1/users?fields=id,name,email
GET /api/v1/orders?fields=id,total,status&include=customer.name
```

## Kimlik Doğrulama ve Yetkilendirme

### Token-Tabanlı Auth

```
# Authorization header'da Bearer token
GET /api/v1/users
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

# API key (sunucudan sunucuya)
GET /api/v1/data
X-API-Key: sk_live_abc123
```

### Yetkilendirme Kalıpları

```typescript
// Kaynak seviyesi: sahipliği kontrol et
app.get("/api/v1/orders/:id", async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: { code: "not_found" } });
  if (order.userId !== req.user.id) return res.status(403).json({ error: { code: "forbidden" } });
  return res.json({ data: order });
});

// Rol-tabanlı: yetkileri kontrol et
app.delete("/api/v1/users/:id", requireRole("admin"), async (req, res) => {
  await User.delete(req.params.id);
  return res.status(204).send();
});
```

## Hız Sınırlama

### Header'lar

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000

# Aşıldığında
HTTP/1.1 429 Too Many Requests
Retry-After: 60
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Try again in 60 seconds."
  }
}
```

### Hız Limit Katmanları

| Katman | Limit | Pencere | Kullanım Senaryosu |
|------|-------|--------|----------|
| Anonim | 30/dk | IP Başına | Halka açık endpoint'ler |
| Kimlik Doğrulanmış | 100/dk | Kullanıcı Başına | Standart API erişimi |
| Premium | 1000/dk | API key Başına | Ücretli API planları |
| Dahili | 10000/dk | Servis Başına | Servisten servise |

## Versiyonlama

### URL Yolu Versiyonlama (Önerilen)

```
/api/v1/users
/api/v2/users
```

**Artıları:** Açık, yönlendirmesi kolay, cache'lenebilir
**Eksileri:** Versiyonlar arası URL değişir

### Header Versiyonlama

```
GET /api/users
Accept: application/vnd.myapp.v2+json
```

**Artıları:** Temiz URL'ler
**Eksileri:** Test etmesi zor, unutulması kolay

### Versiyonlama Stratejisi

```
1. /api/v1/ ile başlayın — ihtiyaç duyana kadar versiyonlamayın
2. En fazla 2 aktif versiyon koruyun (mevcut + önceki)
3. Kullanımdan kaldırma zaman çizelgesi:
   - Kullanımdan kaldırmayı duyurun (halka açık API'ler için 6 ay önceden)
   - Sunset header ekleyin: Sunset: Sat, 01 Jan 2026 00:00:00 GMT
   - Sunset tarihinden sonra 410 Gone döndürün
4. Breaking olmayan değişiklikler yeni versiyon gerektirmez:
   - Yanıtlara yeni alanlar eklemek
   - Yeni opsiyonel query parametreleri eklemek
   - Yeni endpoint'ler eklemek
5. Breaking değişiklikler yeni versiyon gerektirir:
   - Alanları kaldırmak veya yeniden adlandırmak
   - Alan tiplerini değiştirmek
   - URL yapısını değiştirmek
   - Kimlik doğrulama metodunu değiştirmek
```

## Implementasyon Kalıpları

### TypeScript (Next.js API Route)

```typescript
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: "validation_error",
        message: "Request validation failed",
        details: parsed.error.issues.map(i => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      },
    }, { status: 422 });
  }

  const user = await createUser(parsed.data);

  return NextResponse.json(
    { data: user },
    {
      status: 201,
      headers: { Location: `/api/v1/users/${user.id}` },
    },
  );
}
```

### Python (Django REST Framework)

```python
from rest_framework import serializers, viewsets, status
from rest_framework.response import Response

class CreateUserSerializer(serializers.Serializer):
    email = serializers.EmailField()
    name = serializers.CharField(max_length=100)

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "name", "created_at"]

class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == "create":
            return CreateUserSerializer
        return UserSerializer

    def create(self, request):
        serializer = CreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserService.create(**serializer.validated_data)
        return Response(
            {"data": UserSerializer(user).data},
            status=status.HTTP_201_CREATED,
            headers={"Location": f"/api/v1/users/{user.id}"},
        )
```

### Go (net/http)

```go
func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid_json", "Invalid request body")
        return
    }

    if err := req.Validate(); err != nil {
        writeError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
        return
    }

    user, err := h.service.Create(r.Context(), req)
    if err != nil {
        switch {
        case errors.Is(err, domain.ErrEmailTaken):
            writeError(w, http.StatusConflict, "email_taken", "Email already registered")
        default:
            writeError(w, http.StatusInternalServerError, "internal_error", "Internal error")
        }
        return
    }

    w.Header().Set("Location", fmt.Sprintf("/api/v1/users/%s", user.ID))
    writeJSON(w, http.StatusCreated, map[string]any{"data": user})
}
```

## API Tasarım Kontrol Listesi

Yeni bir endpoint yayınlamadan önce:

- [ ] Kaynak URL isimlendirme konvansiyonlarını takip ediyor (çoğul, kebab-case, fiil yok)
- [ ] Doğru HTTP metodu kullanılıyor (okumalar için GET, oluşturmalar için POST, vb.)
- [ ] Uygun durum kodları döndürülüyor (her şey için 200 değil)
- [ ] Girdi şema ile validasyona tabi tutuluyor (Zod, Pydantic, Bean Validation)
- [ ] Hata yanıtları kodlar ve mesajlarla standart formatı takip ediyor
- [ ] Liste endpoint'leri için sayfalama uygulanmış (cursor veya offset)
- [ ] Kimlik doğrulama gerekli (veya açıkça halka açık işaretlenmiş)
- [ ] Yetkilendirme kontrol ediliyor (kullanıcı sadece kendi kaynaklarına erişebilir)
- [ ] Hız sınırlama yapılandırılmış
- [ ] Yanıt dahili detayları sızdırmıyor (stack trace'ler, SQL hataları)
- [ ] Mevcut endpoint'lerle tutarlı isimlendirme (camelCase vs snake_case)
- [ ] Dokümante edilmiş (OpenAPI/Swagger spec güncellenmiş)
