const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static("public"));

// In-memory storage for meal logs
let mealLog = [];

// Comprehensive food calorie database (per 100g unless specified)
const foodDatabase = {
  // // Proteins
  // "beef patty": 250,
  // "chicken breast": 165,
  // "salmon": 208,
  // "tuna": 132,
  // "egg": 70,
  // "tofu": 76,
  
  // // Dairy
  // "cheddar cheese": 113,
  // "mozzarella": 85,
  // "milk": 42,
  // "yogurt": 59,
  // "butter": 717,
  
  // // Carbs
  // "white bread": 75,
  // "whole wheat bread": 69,
  // "hamburger bun": 120,
  // "rice": 130,
  // "pasta": 131,
  // "potato": 77,
  
  // // Vegetables
  // "lettuce": 5,
  // "tomato": 6,
  // "onion": 10,
  // "pickle": 2,
  // "carrot": 8,
  // "broccoli": 7,
  
  // // Condiments & Sauces
  // "mayonnaise": 90,
  // "ketchup": 15,
  // "mustard": 5,
  // "ranch dressing": 140,
  
  // // Beverages
  // "coffee": 5,
  // "orange juice": 110,
  // "soda": 140,
  // "water": 0,
  
  // // Fruits
  // "apple": 80,
  // "banana": 105,
  // "orange": 60
};

// Step 1: Use AI to break down the meal into components
async function breakDownMeal(description) {
  const prompt = `Break down this meal description into individual food components. Be specific and detailed.

RULES:
1. Separate each food item clearly
2. Include estimated portions (1 slice, 1 cup, 2 oz, etc.)
3. Account for cooking methods (grilled, fried, etc.)
4. Include condiments and sides mentioned
5. Handle modifications (no mayo, extra cheese, etc.)

EXAMPLES:
Input: "Big Mac from McDonald's"
Output: ["beef patty (2 oz)", "sesame seed bun", "lettuce", "cheese slice", "pickles", "onions", "special sauce"]

Input: "grilled chicken salad with ranch"
Output: ["grilled chicken breast (4 oz)", "mixed lettuce (2 cups)", "ranch dressing (2 tbsp)"]

Return ONLY a JSON array of food items:
["food item 1", "food item 2", "food item 3"]

MEAL: "${description}"`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: prompt }],
        temperature: 0.2,
      }),
    });

    const data = await response.json();
    const aiResponse = data.choices[0].message.content.trim();
    
    // Parse the JSON array
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    const jsonString = jsonMatch ? jsonMatch[0] : aiResponse;
    return JSON.parse(jsonString);
    
  } catch (error) {
    console.log("Breakdown error:", error);
    // Fallback to simple split
    return [description];
  }
}

// Step 2: Look up each food item in database
function lookupInDatabase(foodItem) {
  const item = foodItem.toLowerCase();
  
  // Try exact match first
  if (foodDatabase[item]) {
    return { name: foodItem, calories: foodDatabase[item], source: "database" };
  }
  
  // Try partial matches
  for (const [dbFood, calories] of Object.entries(foodDatabase)) {
    if (item.includes(dbFood) || dbFood.includes(item.split(" ")[0])) {
      return { name: foodItem, calories: calories, source: "database" };
    }
  }
  
  return null; // Not found in database
}

// Step 3: Use AI to estimate unknown food items
async function estimateWithAI(foodItem) {
  const prompt = `Estimate the calories for this specific food item. Consider the portion size mentioned.

RULES:
1. Give realistic calorie estimate for the portion mentioned
2. If no portion mentioned, assume standard serving size
3. Consider cooking method (grilled vs fried affects calories)
4. Be conservative but accurate

Return ONLY a JSON object:
{"name": "food name", "calories": number}

FOOD ITEM: "${foodItem}"`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: prompt }],
        temperature: 0.1,
      }),
    });

    const data = await response.json();
    const aiResponse = data.choices[0].message.content.trim();
    
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    const jsonString = jsonMatch ? jsonMatch[0] : aiResponse;
    const result = JSON.parse(jsonString);
    
    return { ...result, source: "ai" };
    
  } catch (error) {
    console.log("AI estimation error:", error);
    // Fallback estimate
    return { name: foodItem, calories: 100, source: "fallback" };
  }
}

// Main processing function
async function processMeal(description) {
  try {
    // Step 1: Break down meal with AI
    console.log("Step 1: Breaking down meal...");
    const foodItems = await breakDownMeal(description);
    console.log("Breakdown result:", foodItems);
    
    const processedFoods = [];
    const unknownItems = [];
    
    // Step 2: Look up each item in database
    console.log("Step 2: Looking up in database...");
    for (const item of foodItems) {
      const dbResult = lookupInDatabase(item);
      if (dbResult) {
        processedFoods.push(dbResult);
        console.log(`Found in DB: ${item} = ${dbResult.calories} cal`);
      } else {
        unknownItems.push(item);
        console.log(`Not in DB: ${item}`);
      }
    }
    
    // Step 3: Use AI for unknown items
    console.log("Step 3: AI estimation for unknown items...");
    for (const item of unknownItems) {
      const aiResult = await estimateWithAI(item);
      processedFoods.push(aiResult);
      console.log(`AI estimated: ${item} = ${aiResult.calories} cal`);
    }
    
    // Step 4: Calculate total
    const totalCalories = processedFoods.reduce((sum, food) => sum + food.calories, 0);
    
    return {
      foods: processedFoods,
      totalCalories: totalCalories,
      clarificationNeeded: false
    };
    
  } catch (error) {
    console.log("Processing error:", error);
    // Step 4: Ask for clarification if everything fails
    return {
      clarificationNeeded: true,
      question: "Could you describe your meal in more detail? For example, what size was it and how was it prepared?"
    };
  }
}

// POST endpoint to log meals
app.post("/api/logMeal", async (req, res) => {
  try {
    const { description } = req.body;

    if (!description || description.trim().length < 2) {
      return res.status(400).json({ error: "Please describe your meal" });
    }

    console.log(`\n🍽️ Processing: "${description}"`);
    
    // Process the meal through our 4-step pipeline
    const result = await processMeal(description);
    
    // Store successful meal logs
    if (!result.clarificationNeeded) {
      const mealEntry = {
        timestamp: new Date().toISOString(),
        description: description,
        ...result
      };
      mealLog.push(mealEntry);
      
      console.log(`✅ Total: ${result.totalCalories} calories`);
    }

    res.json({
      meal: result,
      mealLog: mealLog
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ 
      error: "Sorry, couldn't process that meal. Please try again." 
    });
  }
});

// GET endpoint for meal history
app.get("/api/history", (req, res) => {
  res.json({ mealLog });
});

// Start server
app.listen(PORT, () => {
  console.log(`🍽️  Smart Calorie Logger running on http://localhost:${PORT}`);
  console.log(`📊 Database has ${Object.keys(foodDatabase).length} food items`);
  console.log(`🤖 AI-powered breakdown and estimation`);
  console.log(`🎯 Flow: Input → AI Breakdown → Database Lookup → AI Estimation → Log`);
});