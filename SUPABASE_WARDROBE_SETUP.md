# Supabase Wardrobe Setup Rehberi

Bu rehber, WearUp! uygulamasının gardırop özelliği için gerekli Supabase ayarlarını açıklar.

## 1. Gerekli Buckets Oluşturma

### Gardırop Resimleri için "wardrobes" Bucket'ı Oluşturma

1. Supabase projenizdeki Storage kısmına gidin
2. "New Bucket" butonuna tıklayın
3. Aşağıdaki ayarları yapın:
   - Bucket Name: `wardrobes`
   - Public bucket: Evet (işaretleyin)
   - File size limit: 5MB (veya ihtiyacınıza göre ayarlayın)
4. "Create bucket" butonuna tıklayın

## 2. Veritabanı Tablolarını Oluşturma

Bu proje için gerekli veritabanı tablolarını oluşturmak için `wardrobe_tables.sql` dosyasındaki SQL kodunu kullanabilirsiniz.

### SQL Kodunu Çalıştırma

1. Supabase projenizdeki "SQL Editor" kısmına gidin
2. "New Query" butonuna tıklayın
3. `wardrobe_tables.sql` dosyasındaki içeriği kopyalayıp yapıştırın
4. "Run" butonuna tıklayarak SQL sorgusunu çalıştırın

## 3. RLS Politikalarını Anlama

`wardrobe_tables.sql` dosyası aşağıdaki RLS (Row Level Security) politikalarını içerir:

1. **Kullanıcı yetkilendirme politikaları**: Kullanıcılar yalnızca kendi eklediği öğeleri görüntüleyebilir, düzenleyebilir ve silebilir
2. **Görünürlük politikaları**: "public" olarak işaretlenen öğeler herkes tarafından görüntülenebilir

## 4. API Anahtarları ve Güvenlik

### Uygulama İçin Güvenli Veri Erişimi

- İstemci tarafında (React Native uygulamasında) her zaman **anon/public** anahtarı kullanın
- Sunucu tarafında (Node.js API'da) **service_role** anahtarını kullanın, ancak bu anahtar asla istemci koduna dahil edilmemelidir

### Ortam Değişkenleri

Server projenizde `.env` dosyasını güncelleyin:

```
SUPABASE_URL=https://your-project-url.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

## 5. Sorun Giderme

### Yaygın Hatalar

1. **"RLS policy violated"**: Kullanıcının kimliği doğru şekilde iletilmiyor veya RLS politikaları düzgün yapılandırılmamış
2. **"Bucket not found"**: Bucket adı yanlış yazılmış veya bucket henüz oluşturulmamış
3. **"403 Forbidden"**: Dosya izinleri veya bucket politikaları doğru yapılandırılmamış

### Kontrol Listesi

- [ ] Supabase projesi URL ve anahtarları doğru mu?
- [ ] `wardrobes` bucket'ı oluşturuldu mu?
- [ ] `wardrobe_items` ve `wardrobe_outfits` tabloları oluşturuldu mu?
- [ ] RLS politikaları etkinleştirildi mi?
- [ ] Kullanıcı kimlik doğrulama düzgün çalışıyor mu?

## 6. Geliştirme İpuçları

- Storage bucket dosyalarını yönetmek için Supabase Storage JavaScript SDK'sını kullanın
- RLS politikalarınızı geliştikçe genişletin (örneğin, takipçilerin özel içerikleri görmesine izin vermek)
- Verileri JSON olarak saklarken (örneğin, etiketler veya mevsimler için) her zaman JSON.parse() ve JSON.stringify() kullanın

## 7. Kaynaklar

- [Supabase Storage Dokümantasyonu](https://supabase.com/docs/guides/storage)
- [Supabase RLS Dokümantasyonu](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase JavaScript SDK Dokümantasyonu](https://supabase.com/docs/reference/javascript/initializing)
