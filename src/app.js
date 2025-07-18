// Fetch API düzeltmesini yükle
require("./fix-fetch");

// app.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

// Mevcut route'ların import'ları
const imageRoutes = require("./routes/imageRoutes");
const backgroundGeneratorRouter = require("./routes/backgroundGenerator");
const generateFirstShootRouter = require("./routes/generateFirstShoot");
const generatePhotoshootRouter = require("./routes/generatePhotoshoot");
const listTraingsRouter = require("./routes/listModels");
const getTraining = require("./routes/getTraining");
const updateCreditRouter = require("./routes/updateCredit");
const getUserRouter = require("./routes/getUser");
const notificationRoutes = require("./routes/notificationRoutes");
const addProductRouter = require("./routes/addProduct");
const plannerRoutes = require("./routes/plannerRoutes");
const getUserProductRouter = require("./routes/getUserProduct");
const uploadImageRouter = require("./routes/uploadImage");
const checkStatusRouter = require("./routes/checkStatus");
const getTrainRequestRouter = require("./routes/getTrainRequest");
const getRequests = require("./routes/getRequests");
const getBalance = require("./routes/getBalance");
const generatePredictionsRouter = require("./routes/generatePredictions");
const generateImgToVidRouter = require("./routes/generateImgToVid");
const getPredictionsRouter = require("./routes/getPredictions");
const registerAnonymousUserRouter = require("./routes/registerAnonymousUser");
const generateImagesJsonRouter = require("./routes/generateImagesJson");
const imageEnhancementRouter = require("./routes/imageEnhancement");
const faceSwapRouter = require("./routes/faceSwap");
const geminiImageProcessRouter = require("./routes/geminiImageProcess");
const geminiImageDetectionRouter = require("./routes/geminiImageDetection");
const imageClarityProcessRouter = require("./routes/imageClarityProcess");

const webScrapingRouter = require("./routes/webScraping");
const wardrobeRoutes = require("./routes/wardrobeRoutes");
const favoritesRoutes = require("./routes/favoritesRoutes");
const outfitInteractionsRouter = require("./routes/outfitInteractionsRoutes");
const virtualTryOnRoutes = require("./routes/virtualTryOnRoutes");
const outfitsRoutes = require("./routes/outfitsRoutes");
const combineImageRoutes = require("./routes/combineImageRoutes");
const pinterestRoutes = require("./routes/pinterestRoutes");
const inspirationsRoutes = require("./routes/inspirationsRoutes");
const rankingsRoutes = require("./routes/rankings");
const styleBattlesRoutes = require("./routes/styleBattles");
const tournamentRoutes = require("./routes/tournamentRoutes");
const generateProductNameRouter = require("./routes/generateProductName");
const poseRoutes = require("./routes/poseRoutes");
const referenceBrowserRoutes = require("./routes/referenceBrowserRoutes");
const bodyShapeRoutes = require("./routes/bodyShapeRoutes");
const editRoomRoutes = require("./routes/editRoomRoutes");

// Lokasyon rotalarını import et
const locationRoutes = require("./routes/locationRoutes");
// Saç stili rotalarını import et
const hairStyleRoutes = require("./routes/hairStyleRoutes");
// Saç rengi rotalarını import et
const hairColorRoutes = require("./routes/hairColorRoutes");
// Referans görsel oluşturma rotalarını import et
const referenceRoutes = require("./routes/referenceRoutes");

// Yeni eklenen route import'ları
const userProfileRoutes = require("./routes/userProfileRoutes");
const authRoutes = require("./routes/authRoutes");
const userPhotosRoutes = require("./routes/userPhotosRoutes");
const productUploadRoutes = require("./routes/productUploadRoutes");

// RevenueCat webhook route import
const revenuecatWebhookRouter = require("./routes/revenuecatWebhook");

// Route modüllerini içe aktarma
const exploreRoutes = require("./routes/exploreRoutes");

const geminiTryOnProductCratorRoutes = require("./routes/geminiTryOnProductCratorRoutes");

const app = express();

// CORS ayarlarını daha esnek hale getir
app.use(
  cors({
    origin: "*", // Tüm originlere izin ver
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// Results klasörüne statik dosya erişimi sağla
app.use("/results", express.static(path.join(__dirname, "../results")));

// Virtual Try On outputs klasörüne statik dosya erişimi ekle
app.use("/outputs", express.static(path.join(__dirname, "../outputs")));

// Outputs klasörünü oluştur (yoksa)
const outputsDir = path.join(__dirname, "../outputs");
if (!fs.existsSync(outputsDir)) {
  fs.mkdirSync(outputsDir, { recursive: true });
  console.log("Outputs directory ready:", outputsDir);
}

// Basit test endpointi ekle
app.get("/test", (req, res) => {
  console.log("Test endpoint was called from:", req.ip);
  res.json({
    success: true,
    message: "API bağlantı testi başarılı!",
    timestamp: new Date().toISOString(),
  });
});

// API durumunu kontrol endpointi
app.get("/api/status", (req, res) => {
  console.log("Status check called from:", req.ip);
  res.json({
    status: "online",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Düzeltme: Node.js 18+ için global fetch fonksiyonunu düzelt
const originalFetch = global.fetch;
global.fetch = (url, opts = {}) => {
  // Eğer bir body varsa ve duplex belirtilmediyse, 'half' ekle
  if (opts.body && !opts.duplex) {
    opts.duplex = "half";
  }
  return originalFetch(url, opts);
};

// Önemli: Router sıralaması kritiktir. Özel endpoint'leri önce tanımlayın!
// Yeni eklenen auth ve profile rotalarını önce tanımlayın
app.use("/api/auth", authRoutes);
app.use("/api/user", userProfileRoutes);
app.use("/api/photos", userPhotosRoutes);
app.use("/api/products", productUploadRoutes);

// outfitInteractionsRouter'ı outfitsRoutes'dan ÖNCE tanımlayın
app.use("/api", outfitInteractionsRouter);
app.use("/api", virtualTryOnRoutes);
app.use("/api", outfitsRoutes);
app.use("/api", inspirationsRoutes);

// Poz rotalarını ekle
app.use("/api/poses", poseRoutes);
// Lokasyon rotalarını ekle
app.use("/api", locationRoutes);
// Saç stili rotalarını ekle
app.use("/api/hairstyles", hairStyleRoutes);
// Saç rengi rotalarını ekle
app.use("/api/bodyshapes", bodyShapeRoutes);

app.use("/api/haircolors", hairColorRoutes);
// Referans görsel oluşturma rotalarını ekle
app.use("/api/reference", referenceRoutes);
app.use("/api/referenceBrowser", referenceBrowserRoutes);
app.use("/api/reference", exploreRoutes);
app.use("/api/editRoom", editRoomRoutes);

// Mevcut route tanımlamaları
app.use("/api", backgroundGeneratorRouter);
app.use("/api/images", imageRoutes);
app.use("/api/generateFirstShoot", generateFirstShootRouter);
app.use("/api/generatePhotoshoot", generatePhotoshootRouter);
app.use("/api/listTrainings", listTraingsRouter);
app.use("/api/getTraining", getTraining);
app.use("/api/imageEnhancement", imageEnhancementRouter);
app.use("/api/faceSwap", faceSwapRouter);
app.use("/api", updateCreditRouter);
app.use("/api", getUserRouter);
app.use("/api", notificationRoutes);
app.use("/api", uploadImageRouter);
app.use("/api/checkStatus", checkStatusRouter);
app.use("/api", getTrainRequestRouter);
app.use("/api", getRequests);
app.use("/api", addProductRouter);
app.use("/api", getUserProductRouter);
app.use("/api", generatePredictionsRouter);
app.use("/api", getPredictionsRouter);
app.use("/api", getBalance);
app.use("/api", registerAnonymousUserRouter);
app.use("/api", generateImgToVidRouter);
app.use("/api", generateImagesJsonRouter);
app.use("/api", geminiImageProcessRouter);
app.use("/api", geminiImageDetectionRouter);
app.use("/api", imageClarityProcessRouter);
app.use("/api", webScrapingRouter);
app.use("/api", wardrobeRoutes);
app.use("/api", favoritesRoutes);
app.use("/api", combineImageRoutes);
app.use("/api/pinterest", pinterestRoutes);
app.use("/api", rankingsRoutes);
app.use("/api", styleBattlesRoutes);
app.use("/api/planner", plannerRoutes);
app.use("/api/style-battles", styleBattlesRoutes);
app.use("/api/rankings", rankingsRoutes);
app.use("/api/tournaments", tournamentRoutes);
app.use("/api", generateProductNameRouter);
app.use("/api/gemini-tryon", geminiTryOnProductCratorRoutes);

// RevenueCat webhook route ekle
app.use("/revenuecat", revenuecatWebhookRouter);
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Server is accessible at http://localhost:${PORT}`);
  console.log(
    `For mobile devices use your machine's IP address: http://192.168.1.100:${PORT}`
  );
});

module.exports = app;
