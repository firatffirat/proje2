# PROJECT 2 — 1v1 Şerit Düellosu

## Çalıştırma
- Node.js 20+ kurulu olmalı.
- Klasörde `npm install` ardından `npm start` çalıştır.
- Tarayıcıda `http://localhost:3000` aç.
- İkinci cihazdan aynı ağdaki bilgisayarın yerel IP adresi ve `:3000` portuyla bağlan. İnternet üzerinden oynamak için Render'a deploy et ve oluşan HTTPS adresini iki oyuncuyla paylaş.

## Oynanış
- Özel oda koduyla iki oyuncu eşleşir.
- 20 şampiyon seçilebilir; rakibin seçimi kilitlenene kadar gizlidir.
- Üç şerit arasında hareket et, hedef şeridi seç ve Q/W/E/R saldırılarını gönder.
- Sunucu mana, bekleme süresi, isabet, hasar, can, maç süresi ve bağlantı kopmasını yönetir.
- Maç 5 dakika sürer; canı sıfırlanan kaybeder.

## İçerik notu
Şampiyon isimleri ve yetenek adları referans amaçlıdır. Portreler bu projeye özel, stilize SVG konsept çizimleridir; Riot'un resmî oyun modelleri, dokuları, sesleri veya kaynak kodu değildir. Yetenekler bu prototipte düello mekaniğine uyarlanmış ortak hasar/atış kurallarıyla çalışır; resmî LoL denge değerlerinin birebir kopyası değildir.

## Teknik
Node.js, Express, Socket.IO ve Phaser 3 (CDN). Render için `render.yaml` dahildir.
