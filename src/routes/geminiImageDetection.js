const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const mkdirAsync = promisify(fs.mkdir);
const axios = require("axios");

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Gemini API setup
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// Configure multer storage for temporary file storage
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const tempDir = path.join(__dirname, "../../temp/uploads");

    // Create directory if it doesn't exist
    try {
      await mkdirAsync(tempDir, { recursive: true });
    } catch (err) {
      if (err.code !== "EEXIST") {
        console.error("Error creating temp directory:", err);
      }
    }

    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// Route for analyzing clothing items in an image
router.post("/analyze-clothing", upload.single("image"), async (req, res) => {
  console.log("Clothing analysis API endpoint called");

  if (!req.file) {
    console.log("No file found in request");
    console.log("Request body keys:", Object.keys(req.body));
    console.log("Request files:", req.files);
    return res.status(400).json({ error: "Image file is required" });
  }

  console.log(
    "File received:",
    req.file.originalname,
    req.file.mimetype,
    req.file.size,
    "bytes"
  );

  const country = "us";
  const language = "en";
  console.log(`Parametreler: Ülke: ${country}, Dil: ${language}`);

  const imagePath = req.file.path;
  const imageMimeType = req.file.mimetype;

  try {
    // Check if API key is available
    if (!apiKey) {
      console.log("API key not found");
      throw new Error(
        "GEMINI_API_KEY is not configured in environment variables"
      );
    }

    console.log("Starting image analysis with Gemini");

    // Process image with Gemini
    try {
      const imageData = await fs.promises.readFile(imagePath, {
        encoding: "base64",
      });

      console.log("Image data read successfully, length:", imageData.length);

      // Use Gemini 1.5 Flash for analysis
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      // Prepare prompt for clothing item analysis
      const prompt = `
        Analyze this image and identify all visible clothing items and accessories worn by the person.
        For each item provide:
        1. Category/type - Use the actual and specific product category name (NOT limited to fixed categories like Tops, Bottoms). Use the most accurate category name for what you see (e.g., "Shirt", "Jeans", "Sneakers", "Bracelet", "Sunglasses").
        2. A detailed description in the "query" field in English with color, pattern, style and other notable features. Also include the gender association (male, female, or unisex) at the end of the query. IMPORTANT: DO NOT use parentheses around the gender.

        Return the results as a JSON array of objects with exactly the following keys:
        [
          { "type": "Shirt", "query": "blue striped button-up shirt male" },
          { "type": "Jeans", "query": "distressed denim jeans unisex" },
          { "type": "Boots", "query": "black leather boots female" },
          { "type": "Ring", "query": "gold band ring unisex" },
          { "type": "Cap", "query": "red baseball cap male" }
        ]

        Only include items that are clearly visible. Every item **must** have both a non-empty "type" (actual specific category) and a descriptive "query" including the gender. IMPORTANT: DO NOT return any item without both fields properly filled. DO NOT use parentheses around the gender in the query field.
        
        IMPORTANT: Write the "type" field in the user's language (${language}), but the "query" field must ALWAYS be in English.
      `;

      console.log("Sending request to Gemini API...");

      const result = await model.generateContent({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: imageMimeType,
                  data: imageData,
                },
              },
            ],
          },
        ],
      });

      // Extract the response text
      const responseText = result.response.text();
      console.log("Gemini response received:", responseText, language, country);

      // Parse the JSON response - handle different formats that might be returned
      let clothingItems = [];
      try {
        // Try to extract JSON from the response
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);

        if (jsonMatch) {
          clothingItems = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("JSON format not found in response");
        }
      } catch (parseError) {
        console.error("Error parsing JSON response:", parseError);
        // Fallback to simpler parsing approach

        try {
          // Try parsing the entire response
          clothingItems = JSON.parse(responseText);
        } catch (e) {
          console.error("Failed to parse entire response:", e);

          // Return the text response for manual parsing on client if needed
          return res.status(200).json({
            success: true,
            message: "Image analysis completed but structured parsing failed",
            rawText: responseText,
          });
        }
      }

      // Validate and filter clothing items to ensure each has both type and query fields
      clothingItems = clothingItems.filter((item) => {
        if (
          !item.type ||
          !item.query ||
          item.type.trim() === "" ||
          item.query.trim() === ""
        ) {
          console.log("Filtering out incomplete item:", item);
          return false;
        }

        // URL encode the query parameter to make it safe for API requests
        item.query = encodeURIComponent(item.query);
        return true;
      });

      // If all items were filtered out, return an error
      if (clothingItems.length === 0) {
        console.log("All clothing items were invalid or incomplete");
        return res.status(500).json({
          success: false,
          error: "Failed to analyze image properly",
          details:
            "Gemini API did not return any valid clothing items with both type and query fields",
        });
      }

      // Clean up the temporary upload file
      await unlinkAsync(imagePath);

      // Return successful response to client
      console.log(
        "Returning successful response with",
        clothingItems.length,
        "clothing items"
      );
      return res.status(200).json({
        success: true,
        message: "Clothing items analyzed successfully",
        clothingItems: clothingItems,
        country: country,
        language: language,
      });
    } catch (geminiError) {
      console.error("Gemini API error:", geminiError);
      throw geminiError;
    }
  } catch (error) {
    console.error("Error analyzing image:", error);

    // Clean up temp file if it exists
    try {
      if (fs.existsSync(imagePath)) {
        await unlinkAsync(imagePath);
      }
    } catch (unlinkError) {
      console.error("Error deleting temp file:", unlinkError);
    }

    // Return error to client
    res.status(500).json({
      success: false,
      error: "Failed to analyze image",
      details: error.message,
    });
  }
});

// Add a new route for analyzing images from URLs
router.post("/analyze-clothing-url", async (req, res) => {
  console.log("Clothing analysis from URL API endpoint called");

  if (!req.body || !req.body.imageUrl) {
    console.log("No image URL found in request");
    return res.status(400).json({ error: "Image URL is required" });
  }

  const imageUrl = req.body.imageUrl;
  console.log("Analyzing image from URL:", imageUrl);

  // Dinamik ülke ve dil parametreleri
  const country = req.body.country || "us";
  const language = req.body.language || "en";
  console.log(`Parametreler: Ülke: ${country}, Dil: ${language}`);

  // Create a temp filename for the downloaded image
  const tempDir = path.join(__dirname, "../../temp/uploads");
  const tempFilename =
    Date.now() + "-" + Math.round(Math.random() * 1e9) + ".jpg";
  const imagePath = path.join(tempDir, tempFilename);

  try {
    // Ensure temp directory exists
    await mkdirAsync(tempDir, { recursive: true }).catch((err) => {
      if (err.code !== "EEXIST") throw err;
    });

    // Check if API key is available
    if (!apiKey) {
      console.log("API key not found");
      throw new Error(
        "GEMINI_API_KEY is not configured in environment variables"
      );
    }

    // Download the image
    console.log("Downloading image from URL");
    const imageResponse = await axios({
      method: "get",
      url: imageUrl,
      responseType: "arraybuffer",
    });

    // Save to temp file
    await writeFileAsync(imagePath, imageResponse.data);
    console.log("Image downloaded and saved to:", imagePath);

    // Get the image mime type
    const imageMimeType = imageResponse.headers["content-type"] || "image/jpeg";

    // Process with Gemini
    console.log("Starting image analysis with Gemini");
    const imageData = await fs.promises.readFile(imagePath, {
      encoding: "base64",
    });

    console.log("Image data read successfully, length:", imageData.length);

    // Use Gemini 1.5 Flash for analysis
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    // Prepare prompt for clothing item analysis
    const prompt = `
      Analyze this image and identify all visible clothing items and accessories worn by the person.
      For each item provide:
      1. Category/type - Use the actual and specific product category name (NOT limited to fixed categories like Tops, Bottoms). Use the most accurate category name for what you see (e.g., "Shirt", "Jeans", "Sneakers", "Bracelet", "Sunglasses").
      2. A detailed description in the "query" field in English with color, pattern, style and other notable features. Also include the gender association (male, female, or unisex) at the end of the query. IMPORTANT: DO NOT use parentheses around the gender.

      Return the results as a JSON array of objects with exactly the following keys:
      [
        { "type": "Shirt", "query": "blue striped button-up shirt male" },
        { "type": "Jeans", "query": "distressed denim jeans unisex" },
        { "type": "Boots", "query": "black leather boots female" },
        { "type": "Ring", "query": "gold band ring unisex" },
        { "type": "Cap", "query": "red baseball cap male" }
      ]

      Only include items that are clearly visible. Every item **must** have both a non-empty "type" (actual specific category) and a descriptive "query" including the gender. IMPORTANT: DO NOT return any item without both fields properly filled. DO NOT use parentheses around the gender in the query field.
      
      IMPORTANT: Write the "type" field in the user's language (${language}), but the "query" field must ALWAYS be in English.
    `;

    console.log("Sending request to Gemini API...");

    const result = await model.generateContent({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: imageMimeType,
                data: imageData,
              },
            },
          ],
        },
      ],
    });

    // Extract the response text
    const responseText = result.response.text();
    console.log("Gemini response received:", responseText);

    // Parse the JSON response - handle different formats that might be returned
    let clothingItems = [];
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);

      if (jsonMatch) {
        clothingItems = JSON.parse(jsonMatch[0]);
        console.log("JSON extracted successfully from response");
      } else {
        throw new Error("JSON format not found in response");
      }
    } catch (parseError) {
      console.error("Error parsing JSON response:", parseError);
      // Fallback to simpler parsing approach

      try {
        // Try parsing the entire response
        clothingItems = JSON.parse(responseText);
        console.log("Parsed complete response as JSON");
      } catch (e) {
        console.error("Failed to parse entire response:", e);

        // Return the text response for manual parsing on client if needed
        // Clean up the temporary upload file
        await unlinkAsync(imagePath);

        return res.status(200).json({
          success: true,
          message: "Image analysis completed but structured parsing failed",
          rawText: responseText,
        });
      }
    }

    // Validate and filter clothing items to ensure each has both type and query fields
    const validItems = clothingItems.filter((item) => {
      if (
        !item.type ||
        !item.query ||
        item.type.trim() === "" ||
        item.query.trim() === ""
      ) {
        console.log("Filtering out incomplete item:", item);
        return false;
      }

      // URL encode the query parameter to make it safe for API requests
      item.query = encodeURIComponent(item.query);
      return true;
    });

    console.log(`Found ${validItems.length} valid clothing items`);

    // If all items were filtered out, return an error
    if (validItems.length === 0) {
      console.log("All clothing items were invalid or incomplete");
      // Clean up the temporary upload file
      await unlinkAsync(imagePath);

      return res.status(500).json({
        success: false,
        error: "Failed to analyze image properly",
        details:
          "Gemini API did not return any valid clothing items with both type and query fields",
      });
    }

    // Clean up the temporary upload file
    await unlinkAsync(imagePath);

    // Return successful response to client
    console.log(
      "Returning successful response with",
      validItems.length,
      "clothing items"
    );
    return res.status(200).json({
      success: true,
      message: "Clothing items analyzed successfully",
      clothingItems: validItems,
      country: country,
      language: language,
    });
  } catch (error) {
    console.error("Error analyzing image:", error);

    // Clean up temp file if it exists
    try {
      if (fs.existsSync(imagePath)) {
        await unlinkAsync(imagePath);
      }
    } catch (unlinkError) {
      console.error("Error deleting temp file:", unlinkError);
    }

    // Return error to client
    res.status(500).json({
      success: false,
      error: "Failed to analyze image",
      details: error.message,
    });
  }
});

// Add module.exports at the end of the file
module.exports = router;
