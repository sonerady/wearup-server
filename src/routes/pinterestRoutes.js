const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const outfitsDataPath = path.join(__dirname, "..", "lib", "outfits_data.json");
const inspirationDataPath = path.join(
  __dirname,
  "..",
  "lib",
  "inspiration_data.json"
);

// Fisher-Yates (aka Knuth) Shuffle
function shuffleArray(array) {
  let currentIndex = array.length,
    randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex !== 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
}

router.get("/posts", (req, res) => {
  console.log("[Pinterest Route] Received request with query:", req.query);

  // Veri tipini belirle - varsayılan olarak outfits kullan
  const type = req.query.type || "outfits";
  console.log(`[Pinterest Route] Requested data type: ${type}`);

  // Veri tipine göre dosya yolunu belirle
  let dataPath;
  if (type === "inspiration") {
    dataPath = inspirationDataPath;
    console.log("[Pinterest Route] Using inspiration_data.json");
  } else {
    dataPath = outfitsDataPath;
    console.log("[Pinterest Route] Using outfits_data.json");
  }

  // Eğer dosya yoksa, oluştur (inspiration_data.json için)
  if (type === "inspiration" && !fs.existsSync(dataPath)) {
    try {
      // inspiration_data.json yoksa, örnek veri oluşturalım
      console.log(
        "[Pinterest Route] Creating inspiration_data.json as it doesn't exist"
      );
      const sampleData = Array.from({ length: 30 }, (_, i) => ({
        pin_id: `inspiration_${i + 1}`,
        image_url: `https://source.unsplash.com/random/400x600?fashion,inspiration&sig=${
          i + 100
        }`,
        description: `İlham verici moda örneği ${i + 1}`,
        likes: Math.floor(Math.random() * 1000),
        comments: Math.floor(Math.random() * 50),
      }));

      fs.writeFileSync(dataPath, JSON.stringify(sampleData, null, 2));
      console.log(
        "[Pinterest Route] Created inspiration_data.json with sample data"
      );
    } catch (err) {
      console.error(
        "[Pinterest Route] Error creating inspiration_data.json:",
        err
      );
      return res.status(500).send("Error creating inspiration data file");
    }
  }

  fs.readFile(dataPath, "utf8", (err, data) => {
    if (err) {
      console.error(`[Pinterest Route] Error reading ${type} data file:`, err);
      return res
        .status(500)
        .send(`Error reading ${type} data file - Check server logs`);
    }

    try {
      let jsonData = JSON.parse(data);
      console.log(`[Pinterest Route] Original data length: ${jsonData.length}`);
      jsonData = shuffleArray(jsonData); // Shuffle data on every request
      console.log(`[Pinterest Route] Shuffled data length: ${jsonData.length}`);

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;

      console.log(`[Pinterest Route] Requested page: ${page}, limit: ${limit}`);
      console.log(
        `[Pinterest Route] Calculated startIndex: ${startIndex}, endIndex: ${endIndex}`
      );

      const results = {};
      const slicedData = jsonData.slice(startIndex, endIndex);
      console.log(`[Pinterest Route] Sliced data length: ${slicedData.length}`);

      if (endIndex < jsonData.length) {
        results.next = {
          page: page + 1,
          limit: limit,
        };
      }

      if (startIndex > 0) {
        results.previous = {
          page: page - 1,
          limit: limit,
        };
      }
      results.results = slicedData;
      results.totalPosts = jsonData.length; // Send total post count
      console.log(
        `[Pinterest Route] Sending ${results.results.length} ${type} posts. Total available: ${results.totalPosts}`
      );

      res.json(results);
    } catch (parseErr) {
      console.error(
        `[Pinterest Route] Error parsing JSON or processing ${type} request:`,
        parseErr
      );
      return res
        .status(500)
        .send(
          `Error parsing ${type} data or processing request - Check server logs`
        );
    }
  });
});

module.exports = router;
