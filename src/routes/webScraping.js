const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const sharp = require("sharp"); // ← ekledik
const router = express.Router();
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

const API_KEY = "6801844612505d276ac0ded9";
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

async function searchProducts(query) {
  try {
    const params = {
      api_key: API_KEY,
      query,
      country: "tr",
      results: 10,
      language: "tr",
    };
    const response = await axios.get(SCRAPINGDOG_URL, { params });
    const data = response.data;

    console.log("dataaaa", data);

    if (!data.shopping_results?.length) return [];

    const results = await Promise.all(
      data.shopping_results.map(async (item) => {
        // Thumbnail yoksa boş string ata
        let thumb = item.thumbnail ?? "";
        // Sadece webp data URI ise dönüştür
        if (typeof thumb === "string" && thumb.startsWith("data:image/webp")) {
          thumb = await convertWebPtoPNGorJPG(thumb, "png");
        }
        return {
          name: item.title,
          price: item.extracted_price,
          originalPrice: item.old_price_extracted || null,
          merchant: item.source,
          image: thumb,
          url: item.product_link,
          rating: item.rating || null,
          reviewCount: item.reviews
            ? parseInt(item.reviews.replace(/[^\d]/g, ""), 10)
            : null,
          delivery: item.delivery || "Standard delivery",
          hasDiscount: item.tag?.includes("OFF") || false,
          discountRate: item.tag?.includes("OFF") ? item.tag : null,
        };
      })
    );

    return results;
  } catch (error) {
    console.error("Ürün araması sırasında hata:", error);
    return [];
  }
}

// Yeni eklenen fonksiyon: Ürün detaylarını ve resim URL'lerini getirir
async function getProductDetails(productId) {
  try {
    const url = `https://api.scrapingdog.com/google_product`;
    const params = {
      api_key: API_KEY,
      product_id: productId,
      country: "us",
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
  const { query } = req.query;
  if (!query)
    return res.status(400).json({ message: "Arama terimi gereklidir!" });

  try {
    const results = await searchProducts(query);
    res.status(200).json({
      message: "Arama sonuçları başarıyla getirildi",
      query,
      count: results.length,
      results,
    });
  } catch (error) {
    res.status(500).json({
      message: "Arama sırasında bir hata oluştu.",
      error: error.message,
    });
  }
});

router.post("/search-product", async (req, res) => {
  const { query } = req.body;
  if (!query)
    return res.status(400).json({ message: "Arama terimi gereklidir!" });

  try {
    const results = await searchProducts(query);
    res.status(200).json({
      message: "Arama sonuçları başarıyla getirildi",
      query,
      count: results.length,
      results,
    });
  } catch (error) {
    res.status(500).json({
      message: "Arama sırasında bir hata oluştu.",
      error: error.message,
    });
  }
});

// Yeni endpoint: Ürün detaylarını getirme
router.get("/product-details/:productId", async (req, res) => {
  const { productId } = req.params;

  if (!productId) {
    return res.status(400).json({ message: "Ürün ID'si gereklidir!" });
  }

  try {
    const productDetails = await getProductDetails(productId);
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
  const { scrapingdog_product_link } = req.body;

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

    const productDetails = await getProductDetails(productId);
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
