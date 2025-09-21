const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const sharp = require("sharp"); // ← ekledik
const router = express.Router();
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

const API_KEY = "68cf4281d592f35c3199242b";
const SCRAPINGDOG_URL = "https://api.scrapingdog.com/google_shopping/";

// Helper: data URI'yi decode edip sharp ile dönüştürür
async function convertWebPtoPNGorJPG(dataUri, format = "png") {
  // data:image/webp;base64,AAAA...
  const matches = dataUri.match(/^data:image\/webp;base64,(.+)$/);
  if (!matches) return dataUri;
  const webpBuffer = Buffer.from(matches[1], "base64");

  let outBuffer;
  if (format === "jpg") {
    outBuffer = await sharp(webpBuffer).jpeg().toBuffer();
    return `data:image/jpeg;base64,${outBuffer.toString("base64")}`;
  } else {
    outBuffer = await sharp(webpBuffer).png().toBuffer();
    return `data:image/png;base64,${outBuffer.toString("base64")}`;
  }
}

async function searchProducts(query, country, language) {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000; // 1 saniye
  let retryCount = 0;

  // Retry mekanizması için helper fonksiyon
  const fetchWithRetry = async () => {
    try {
      const params = {
        api_key: API_KEY,
        query,
        country,
        language: language,
        results: 40,
      };

      console.log(
        `Ürün araması başlatılıyor: "${query}" (Deneme ${retryCount + 1}/${
          MAX_RETRIES + 1
        })`
      );
      const response = await axios.get(SCRAPINGDOG_URL, { params });
      const data = response.data;

      console.log(
        `Arama sonuçları alındı: ${query} için ${
          data.shopping_results?.length || 0
        } sonuç`
      );

      if (!data.shopping_results?.length) return [];

      // Sonuçları hızlıca işle ve dönüş yap
      const results = [];

      // Thumbnail dönüşümü için her öğeyi sırayla işle
      for (const item of data.shopping_results) {
        // Thumbnail yoksa boş string ata
        let thumb = item.thumbnail ?? "";

        // Sadece webp data URI ise dönüştür
        if (typeof thumb === "string" && thumb.startsWith("data:image/webp")) {
          try {
            thumb = await convertWebPtoPNGorJPG(thumb, "png");
          } catch (error) {
            console.error("Resim dönüştürme hatası:", error);
          }
        }

        results.push({
          name: item.title,
          price: item.price,
          originalPrice: item.old_price || null,
          extracted_price: item.extracted_price,
          old_price_extracted: item.old_price_extracted || null,
          merchant: item.source,
          image: thumb,
          url: item.product_link,
          product_id: item.product_id,
          scrapingdog_product_link: item.scrapingdog_product_link,
          rating: item.rating || null,
          reviewCount: item.reviews
            ? parseInt(item.reviews.replace(/[^\d]/g, ""), 10)
            : null,
          delivery: item.delivery || "Standard delivery",
          hasDiscount: item.tag?.includes("OFF") || false,
          discountRate: item.tag?.includes("OFF") ? item.tag : null,
        });
      }

      console.log(`Ürün sonuçları işlendi ve hazır: ${results.length} ürün`);
      return results;
    } catch (error) {
      // Rate limit hatası kontrolü (HTTP 429)
      if (error.response && error.response.status === 429) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;

          // Exponential backoff - her denemede bekleme süresini arttır
          const delay = BASE_DELAY * Math.pow(2, retryCount);
          console.log(
            `Rate limit aşıldı (429). ${delay}ms bekleyip tekrar deneniyor (${retryCount}/${MAX_RETRIES})...`
          );

          // Belirtilen süre kadar bekle
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Yeniden dene
          return fetchWithRetry();
        } else {
          console.error(
            `Maksimum deneme sayısına ulaşıldı (${MAX_RETRIES}). İstek başarısız oldu.`
          );
          throw new Error(
            `Rate limit aşıldı ve ${MAX_RETRIES} deneme sonrası başarısız oldu.`
          );
        }
      }

      // Diğer hatalar için
      console.error("Ürün araması sırasında hata:", error);
      throw error;
    }
  };

  try {
    // İlk çağrı
    return await fetchWithRetry();
  } catch (error) {
    console.error("Ürün araması tüm denemelere rağmen başarısız oldu:", error);
    return []; // Boş dizi döndür
  }
}

// Yeni eklenen fonksiyon: Ürün detaylarını ve resim URL'lerini getirir
async function getProductDetails(productId, country, language) {
  try {
    const url = `https://api.scrapingdog.com/google_product`;
    const params = {
      api_key: API_KEY,
      product_id: productId,
      country: country,
      language: language,
    };

    console.log("İstek yapılıyor:", url, params);

    const response = await axios.get(url, { params });
    const productData = response.data;

    console.log("Ürün detayı yanıtı:", productData);

    // Resim URL'lerini çıkarma
    const imageUrls = [];

    if (productData.images && Array.isArray(productData.images)) {
      productData.images.forEach((image) => {
        if (image.link) {
          imageUrls.push(image.link);
        }
      });
    } else if (productData.thumbnail) {
      imageUrls.push(productData.thumbnail);
    }

    return {
      productId,
      title: productData.title || "Ürün başlığı bulunamadı",
      description: productData.description || "Açıklama bulunamadı",
      price: productData.price || "Fiyat bulunamadı",
      images: imageUrls,
      rawData: productData, // Tüm ham veriyi de döndür
    };
  } catch (error) {
    console.error("Ürün detayı alınırken hata:", error);
    throw error;
  }
}

router.get("/search-product", async (req, res) => {
  const { query, country, language } = req.query;
  if (!query)
    return res.status(400).json({ message: "Arama terimi gereklidir!" });

  try {
    console.log(
      `Ürün araması API endpoint çağrıldı. Sorgu: "${query}", Ülke: "${country}", Dil: "${language}"`
    );

    // Sorgu, özel karakterlere sahipse bunları temizle
    const cleanQuery = query.trim().replace(/\s+/g, " ");
    console.log(`Temizlenmiş sorgu: "${cleanQuery}"`);

    // Aramayı başlat, sonuçları beklemeden hemen dönüş yap
    res.setHeader("Content-Type", "application/json");
    res.status(202).write(
      JSON.stringify({
        message: "Arama başlatıldı, sonuçlar işleniyor",
        query: cleanQuery,
        country: country,
        language: language,
        status: "processing",
      })
    );

    // Ürün araması yap
    const results = await searchProducts(cleanQuery, country, language);

    // Sonuçları istemciye gönder
    const responseData = {
      message: "Arama sonuçları başarıyla getirildi",
      query: cleanQuery,
      country: country,
      language: language,
      count: results.length,
      results,
      status: "completed",
    };

    res.write(JSON.stringify(responseData));
    res.end();
  } catch (error) {
    console.error("Arama sırasında hata:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        message: "Arama sırasında bir hata oluştu.",
        error: error.message,
      });
    } else {
      res.write(
        JSON.stringify({
          message: "Arama sırasında bir hata oluştu.",
          error: error.message,
          status: "error",
        })
      );
      res.end();
    }
  }
});

router.post("/search-product", async (req, res) => {
  const { query, country, language } = req.body;
  if (!query)
    return res.status(400).json({ message: "Arama terimi gereklidir!" });

  try {
    console.log(
      `Ürün araması API endpoint çağrıldı (POST). Sorgu: "${query}", Ülke: "${country}", Dil: "${language}"`
    );

    // Aramayı hemen başlat ve sonuçları normal şekilde dön
    const results = await searchProducts(query, country, language);

    res.status(200).json({
      message: "Arama sonuçları başarıyla getirildi",
      query,
      country: country,
      language: language,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Arama sırasında hata:", error);
    res.status(500).json({
      message: "Arama sırasında bir hata oluştu.",
      error: error.message,
    });
  }
});

// Yeni endpoint: Ürün detaylarını getirme
router.get("/product-details/:productId", async (req, res) => {
  const { productId } = req.params;
  const { country, language } = req.query; // Query parametresinden country ve language al

  if (!productId) {
    return res.status(400).json({ message: "Ürün ID'si gereklidir!" });
  }

  try {
    const productDetails = await getProductDetails(
      productId,
      country,
      language
    );
    res.status(200).json({
      message: "Ürün detayları başarıyla getirildi",
      productDetails,
    });
  } catch (error) {
    res.status(500).json({
      message: "Ürün detayları alınırken bir hata oluştu",
      error: error.message,
    });
  }
});

// URL'den doğrudan ürün detaylarını getirme endpointi
router.post("/scrape-product-url", async (req, res) => {
  const { scrapingdog_product_link, country, language } = req.body; // country ve language parametrelerini de al

  if (!scrapingdog_product_link) {
    return res.status(400).json({ message: "Ürün URL'si gereklidir!" });
  }

  try {
    // URL'den product_id parametresini çıkar
    const url = new URL(scrapingdog_product_link);
    const productId = url.searchParams.get("product_id");

    if (!productId) {
      return res.status(400).json({
        message: "Geçersiz ürün URL'si. product_id parametresi bulunamadı.",
      });
    }

    const productDetails = await getProductDetails(
      productId,
      country,
      language
    );
    res.status(200).json({
      message: "Ürün detayları başarıyla getirildi",
      productDetails,
    });
  } catch (error) {
    res.status(500).json({
      message: "Ürün detayları alınırken bir hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
