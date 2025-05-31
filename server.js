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

// USDA FoodData Central API configuration
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY"; // Get free key at https://fdc.nal.usda.gov/api-key-signup.html
const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";

// Step 1: Use AI to break down the meal into components
async function breakDownMeal(description) {
  const prompt = `Break down this meal description into individual food components. Be specific and detailed.

RULES:
1. Separate each food item clearly
2. Include estimated portions (1 slice, 1 cup, 2 oz, etc.)
3. Account for cooking methods (grilled, fried, etc.)
4. Include condiments and sides mentioned
5. Handle modifications (no mayo, extra cheese, etc.)
6. Use common food names that would be found in a nutrition database

EXAMPLES:
Input: "Big Mac from McDonald's"
Output: ["beef patty", "sesame seed bun", "lettuce", "cheese", "pickles", "onions", "special sauce"]

Input: "grilled chicken salad with ranch"
Output: ["grilled chicken breast", "mixed lettuce", "ranch dressing"]

Input: "wendys burger no mayo lettuce wrap"
Output: ["beef patty", "cheese", "lettuce", "pickles", "onions", "ketchup", "mustard"]

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

// Step 2: Search USDA database for food item
async function searchUSDADatabase(foodItem) {
  try {
    const searchUrl = `${USDA_BASE_URL}/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(foodItem)}&pageSize=5`;
    
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    if (data.foods && data.foods.length > 0) {
      // Get the best match (first result is usually most relevant)
      const bestMatch = data.foods[0];
      
      // Get detailed nutrition info
      const detailsUrl = `${USDA_BASE_URL}/food/${bestMatch.fdcId}?api_key=${USDA_API_KEY}`;
      const detailsResponse = await fetch(detailsUrl);
      const detailsData = await detailsResponse.json();
      
      // Extract calories (Energy nutrient ID is typically 1008)
      const energyNutrient = detailsData.foodNutrients?.find(
        nutrient => nutrient.nutrient?.name?.toLowerCase().includes('energy') || 
                   nutrient.nutrient?.id === 1008
      );
      
      const caloriesPer100g = energyNutrient ? Math.round(energyNutrient.amount) : null;
      
      if (caloriesPer100g) {
        return {
          name: foodItem,
          caloriesPer100g: caloriesPer100g,
          description: bestMatch.description,
          fdcId: bestMatch.fdcId,
          source: "usda_raw"
        };
      }
    }
    
    return null; // Not found in USDA database
    
  } catch (error) {
    console.log(`USDA search error for "${foodItem}":`, error.message);
    return null;
  }
}

// Step 2.5: Use AI to convert USDA data to realistic portions
async function validateUSDAWithAI(usdaData) {
  const prompt = `Convert this USDA nutrition data to a realistic portion size for this food item.

USDA DATA:
- Food: ${usdaData.name}
- Calories per 100g: ${usdaData.caloriesPer100g}
- Description: ${usdaData.description}

RULES:
1. Determine realistic serving size for this food (e.g., 1 slice cheese = 20g, 1 tbsp ketchup = 15g)
2. Calculate calories for that realistic portion
3. Double-check if the result makes sense
4. Be conservative with portions

EXAMPLES:
- "cheese" (400 cal/100g) → 1 slice = 20g → 80 calories
- "ketchup" (100 cal/100g) → 1 tbsp = 15g → 15 calories  
- "lettuce" (20 cal/100g) → 1 cup = 50g → 10 calories
- "beef patty" (250 cal/100g) → 4 oz = 113g → 283 calories

Return ONLY a JSON object:
{
  "name": "food name",
  "calories": number,
  "portion": "realistic portion description",
  "calculation": "20g from 100g base"
}

FOOD TO CONVERT: "${usdaData.name}"`;

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
    
    return { 
      ...result, 
      source: "usda_validated",
      usdaData: {
        caloriesPer100g: usdaData.caloriesPer100g,
        fdcId: usdaData.fdcId
      }
    };
    
  } catch (error) {
    console.log("AI validation error:", error);
    // Fallback to simple conversion based on food type
    let portionGrams = 100; // default
    const food = usdaData.name.toLowerCase();
    
    if (food.includes('cheese')) portionGrams = 20; // 1 slice
    if (food.includes('ketchup') || food.includes('sauce')) portionGrams = 15; // 1 tbsp
    if (food.includes('mustard')) portionGrams = 5; // 1 tsp
    if (food.includes('lettuce') || food.includes('vegetable')) portionGrams = 50; // 1 cup
    if (food.includes('patty') || food.includes('meat')) portionGrams = 113; // 4 oz
    if (food.includes('pickle')) portionGrams = 15; // 1 medium
    if (food.includes('onion')) portionGrams = 25; // 2 tbsp diced
    
    const calories = Math.round((usdaData.caloriesPer100g * portionGrams) / 100);
    
    return {
      name: usdaData.name,
      calories: calories,
      portion: `${portionGrams}g portion`,
      calculation: `${portionGrams}g from ${usdaData.caloriesPer100g} cal/100g`,
      source: "usda_calculated"
    };
  }
}

// Step 3: Use AI to estimate unknown food items with realistic portions
async function validateUSDAWithAI(usdaData) {
  const prompt = `Convert this USDA nutrition data to a realistic portion size for this food item.

USDA DATA:
- Food: ${usdaData.name}
- Calories per 100g: ${usdaData.caloriesPer100g}
- Description: ${usdaData.description}

RULES:
1. Determine realistic serving size for this food (e.g., 1 slice cheese = 20g, 1 tbsp ketchup = 15g)
2. Calculate calories for that realistic portion
3. Double-check if the result makes sense
4. Be conservative with portions

EXAMPLES:
- "cheese" (400 cal/100g) → 1 slice = 20g → 80 calories
- "ketchup" (100 cal/100g) → 1 tbsp = 15g → 15 calories  
- "lettuce" (20 cal/100g) → 1 cup = 50g → 10 calories
- "beef patty" (250 cal/100g) → 4 oz = 113g → 283 calories

Return ONLY a JSON object:
{
  "name": "food name",
  "calories": number,
  "portion": "realistic portion description",
  "calculation": "20g from 100g base"
}

FOOD TO CONVERT: "${usdaData.name}"`;

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
    
    return { 
      ...result, 
      source: "usda_validated",
      usdaData: {
        caloriesPer100g: usdaData.caloriesPer100g,
        fdcId: usdaData.fdcId
      }
    };
    
  } catch (error) {
    console.log("AI validation error:", error);
    // Fallback to simple conversion based on food type
    let portionGrams = 100; // default
    const food = usdaData.name.toLowerCase();
    
    if (food.includes('cheese')) portionGrams = 20; // 1 slice
    if (food.includes('ketchup') || food.includes('sauce')) portionGrams = 15; // 1 tbsp
    if (food.includes('mustard')) portionGrams = 5; // 1 tsp
    if (food.includes('lettuce') || food.includes('vegetable')) portionGrams = 50; // 1 cup
    if (food.includes('patty') || food.includes('meat')) portionGrams = 113; // 4 oz
    if (food.includes('pickle')) portionGrams = 15; // 1 medium
    if (food.includes('onion')) portionGrams = 25; // 2 tbsp diced
    
    const calories = Math.round((usdaData.caloriesPer100g * portionGrams) / 100);
    
    return {
      name: usdaData.name,
      calories: calories,
      portion: `${portionGrams}g portion`,
      calculation: `${portionGrams}g from ${usdaData.caloriesPer100g} cal/100g`,
      source: "usda_calculated"
    };
  }
}
async function estimateWithAI(foodItem) {
  const prompt = `Estimate the calories for this specific food item. Consider the portion size mentioned.

RULES:
1. Give realistic calorie estimate for the portion mentioned
2. If no portion mentioned, assume standard serving size
3. Consider cooking method (grilled vs fried affects calories)
4. Be conservative but accurate
5. Use knowledge of common food calories

EXAMPLES:
- "beef patty" → assume 4oz cooked = ~250 calories
- "cheese" → assume 1 slice = ~50 calories  
- "lettuce" → assume 1 cup = ~5 calories
- "ranch dressing" → assume 2 tbsp = ~140 calories

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
    // Fallback estimate based on food type
    let calories = 100; // default
    const item = foodItem.toLowerCase();
    if (item.includes('patty') || item.includes('meat')) calories = 250;
    if (item.includes('cheese')) calories = 50;
    if (item.includes('lettuce') || item.includes('vegetable')) calories = 10;
    if (item.includes('sauce') || item.includes('dressing')) calories = 80;
    if (item.includes('bun') || item.includes('bread')) calories = 120;
    
    return { name: foodItem, calories: calories, source: "fallback" };
  }
}

// Main processing function
async function processMeal(description) {
  try {
    // Step 1: Break down meal with AI
    console.log(`\n🔍 Step 1: Breaking down "${description}"`);
    const foodItems = await breakDownMeal(description);
    console.log("✅ Breakdown:", foodItems);
    
    const processedFoods = [];
    const unknownItems = [];
    
    // Step 2: Search USDA database for each item
    console.log("\n🏛️ Step 2: Searching USDA FoodData Central...");
    for (const item of foodItems) {
      console.log(`   Searching: ${item}`);
      const usdaResult = await searchUSDADatabase(item);
      
      if (usdaResult) {
        console.log(`   ✅ Found: ${item} = ${usdaResult.caloriesPer100g} cal/100g (USDA)`);
        
        // Step 2.5: Validate with AI for realistic portions
        console.log(`   🤖 Converting to realistic portion...`);
        const validatedResult = await validateUSDAWithAI(usdaResult);
        processedFoods.push(validatedResult);
        console.log(`   ✅ Final: ${item} = ${validatedResult.calories} cal (${validatedResult.portion})`);
      } else {
        unknownItems.push(item);
        console.log(`   ❌ Not found: ${item}`);
      }
      
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Step 3: Use AI for unknown items
    if (unknownItems.length > 0) {
      console.log("\n🤖 Step 3: AI estimation for unknown items...");
      for (const item of unknownItems) {
        const aiResult = await estimateWithAI(item);
        processedFoods.push(aiResult);
        console.log(`   ✅ AI estimated: ${item} = ${aiResult.calories} cal`);
      }
    }
    
    // Step 4: Calculate total
    const totalCalories = processedFoods.reduce((sum, food) => sum + food.calories, 0);
    
    console.log(`\n📊 Total: ${totalCalories} calories`);
    console.log(`📈 Sources: ${processedFoods.filter(f => f.source?.includes('usda')).length} USDA+AI, ${processedFoods.filter(f => f.source === 'ai').length} AI only, ${processedFoods.filter(f => f.source === 'fallback').length} fallback\n`);
    
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
      question: "Could you describe your meal in more detail? For example, what size portions and how was it prepared?"
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
    
    // Process the meal through our pipeline
    const result = await processMeal(description);
    
    // Store successful meal logs
    if (!result.clarificationNeeded) {
      const mealEntry = {
        timestamp: new Date().toISOString(),
        description: description,
        ...result
      };
      mealLog.push(mealEntry);
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

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "healthy",
    usdaApiKey: USDA_API_KEY !== "DEMO_KEY" ? "configured" : "using demo key",
    totalMealsLogged: mealLog.length
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🍽️  Smart Calorie Logger running on http://localhost:${PORT}`);
  console.log(`🏛️  Connected to USDA FoodData Central (300,000+ foods)`);
  console.log(`🔑 API Key: ${USDA_API_KEY === "DEMO_KEY" ? "Using DEMO_KEY (limited)" : "Custom key configured"}`);
  console.log(`🎯 Flow: Input → AI Breakdown → USDA Database → AI Portion Validation → AI Estimation → Log`);
  console.log(`✅ Double-checking: AI validates all USDA data for realistic portions`);
  console.log(`📖 Get free USDA API key: https://fdc.nal.usda.gov/api-key-signup.html`);
});