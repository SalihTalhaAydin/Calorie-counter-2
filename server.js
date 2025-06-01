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
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";

// STEP 1: Break down input into distinct dishes/meals
async function identifyDishes(description) {
  const prompt = `Analyze this meal description and identify distinct dishes or food items. Each dish should be a separate entity that can be prepared independently.

RULES:
1. Identify individual dishes, meals, or food items
2. Keep dishes at a high level (don't break into ingredients yet)
3. Separate by cooking method if significantly different
4. Include beverages as separate items
5. Include sides as separate dishes

EXAMPLES:
Input: "I had scrambled eggs with toast and orange juice for breakfast"
Output: ["scrambled eggs", "toast", "orange juice"]

Input: "burger and fries from McDonald's with a Coke"
Output: ["McDonald's burger", "McDonald's fries", "Coca-Cola"]

Input: "chicken stir fry with steamed rice and green tea"
Output: ["chicken stir fry", "steamed rice", "green tea"]

Input: "pizza slice and caesar salad"
Output: ["pizza slice", "caesar salad"]

Return ONLY a JSON array of distinct dishes:
["dish 1", "dish 2", "dish 3"]

MEAL DESCRIPTION: "${description}"`;

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
    
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    const jsonString = jsonMatch ? jsonMatch[0] : aiResponse;
    const dishes = JSON.parse(jsonString);
    
    console.log(`   ✅ Identified ${dishes.length} dishes:`, dishes);
    return dishes;
    
  } catch (error) {
    console.log("Dish identification error:", error);
    return [description]; // Fallback to original description
  }
}

// STEP 2: Break each dish into ingredients
async function breakDishIntoIngredients(dish) {
  const prompt = `Break down this specific dish into its individual ingredients and components. Be comprehensive and detailed.

RULES:
1. List ALL ingredients and components
2. Include cooking oils, seasonings, and preparation methods
3. Include sauces, dressings, and condiments
4. Be specific about ingredient types (e.g., "yellow onion" not just "onion")
5. Include structural components (buns, crusts, etc.)
6. Don't include quantities yet - just ingredients

EXAMPLES:
Input: "scrambled eggs"
Output: ["eggs", "butter", "salt", "pepper"]

Input: "McDonald's Big Mac"
Output: ["beef patty", "sesame seed bun", "lettuce", "cheese", "pickles", "onions", "Big Mac sauce"]

Input: "chicken stir fry"
Output: ["chicken breast", "broccoli", "bell peppers", "onions", "garlic", "ginger", "soy sauce", "vegetable oil", "cornstarch"]

Input: "caesar salad"
Output: ["romaine lettuce", "parmesan cheese", "croutons", "caesar dressing", "anchovies"]

Return ONLY a JSON array of ingredients:
["ingredient 1", "ingredient 2", "ingredient 3"]

DISH: "${dish}"`;

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
    
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    const jsonString = jsonMatch ? jsonMatch[0] : aiResponse;
    const ingredients = JSON.parse(jsonString);
    
    console.log(`     🔍 "${dish}" → ${ingredients.length} ingredients:`, ingredients);
    return ingredients;
    
  } catch (error) {
    console.log(`Ingredient breakdown error for "${dish}":`, error);
    return [dish]; // Fallback to dish name
  }
}

// STEP 3: Estimate realistic portions for each ingredient
async function estimateIngredientPortion(ingredient, originalDish, originalMealDescription) {
  const prompt = `Estimate a realistic portion size for this ingredient in the context of the dish and meal described.

CONTEXT:
- Ingredient: ${ingredient}
- Dish: ${originalDish}
- Full meal: ${originalMealDescription}

RULES:
1. Consider the ingredient's role in the dish (main ingredient vs garnish vs seasoning)
2. Use standard serving sizes and cooking portions
3. Consider typical restaurant/home cooking amounts
4. Be realistic about how much of each ingredient is actually used
5. Account for cooking methods (some ingredients reduce/concentrate)

PORTION GUIDELINES:
- Proteins: 3-6 oz raw weight
- Vegetables: 1/2 cup to 1 cup cooked
- Grains/starches: 1/2 cup to 1 cup cooked
- Cheese: 1-2 oz (1-2 slices)
- Oils/butter: 1-2 tsp for cooking
- Seasonings: pinch to 1/2 tsp
- Sauces: 1-3 tbsp
- Condiments: 1-2 tsp to 1 tbsp

EXAMPLES:
Input: ingredient="chicken breast", dish="chicken stir fry", meal="chicken stir fry with rice"
Output: {"ingredient": "chicken breast", "portion": "4 oz", "grams": 113}

Input: ingredient="butter", dish="scrambled eggs", meal="scrambled eggs and toast"
Output: {"ingredient": "butter", "portion": "1 tsp", "grams": 5}

Input: ingredient="lettuce", dish="Big Mac", meal="Big Mac and fries"
Output: {"ingredient": "lettuce", "portion": "2 leaves", "grams": 10}

Return ONLY a JSON object:
{"ingredient": "name", "portion": "realistic portion", "grams": estimated_grams}

INGREDIENT TO ESTIMATE: "${ingredient}"`;

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
    
    console.log(`       📏 "${ingredient}" → ${result.portion} (${result.grams}g)`);
    return result;
    
  } catch (error) {
    console.log(`Portion estimation error for "${ingredient}":`, error);
    // Use AI fallback for portion estimation
    return await estimatePortionWithAI(ingredient, originalDish);
  }
}

// AI fallback for portion estimation when main function fails
async function estimatePortionWithAI(ingredient, originalDish) {
  const prompt = `Estimate a realistic portion size for this ingredient when used in the dish context.

INGREDIENT: ${ingredient}
DISH CONTEXT: ${originalDish}

Return ONLY a JSON object with realistic portion:
{"ingredient": "name", "portion": "realistic portion", "grams": estimated_grams}

Example: {"ingredient": "butter", "portion": "1 tsp", "grams": 5}`;

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
    return JSON.parse(jsonString);
    
  } catch (error) {
    console.log("AI portion fallback error:", error);
    return {
      ingredient: ingredient,
      portion: "standard serving",
      grams: 50
    };
  }
}

// Search USDA database for food item
async function searchUSDADatabase(ingredient, portionGrams) {
  try {
    const searchUrl = `${USDA_BASE_URL}/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(ingredient)}&pageSize=5`;
    
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    if (data.foods && data.foods.length > 0) {
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
      
      if (caloriesPer100g && portionGrams) {
        const calories = Math.round((caloriesPer100g * portionGrams) / 100);
        
        return {
          name: ingredient,
          calories: calories,
          portion: `${portionGrams}g`,
          caloriesPer100g: caloriesPer100g,
          source: "usda",
          fdcId: bestMatch.fdcId
        };
      }
    }
    
    return null;
    
  } catch (error) {
    console.log(`USDA search error for "${ingredient}":`, error.message);
    return null;
  }
}

// Use AI to estimate calories when USDA lookup fails
async function estimateCaloriesWithAI(ingredient, portion, grams) {
  const prompt = `Estimate the calories for this specific ingredient and portion size. Use your knowledge of nutrition data.

INGREDIENT: ${ingredient}
PORTION: ${portion}
GRAMS: ${grams}g

RULES:
1. Use accurate nutrition knowledge
2. Consider the specific portion size given
3. Be conservative but realistic
4. Account for cooking method if mentioned

EXAMPLES:
Input: ingredient="chicken breast", portion="4 oz", grams=113
Output: {"name": "chicken breast", "calories": 185, "portion": "4 oz (113g)"}

Input: ingredient="butter", portion="1 tsp", grams=5
Output: {"name": "butter", "calories": 36, "portion": "1 tsp (5g)"}

Return ONLY a JSON object:
{"name": "ingredient name", "calories": number, "portion": "portion description"}

ESTIMATE FOR: ${ingredient} (${portion}, ${grams}g)`;

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
    console.log("AI calorie estimation error:", error);
    // Final fallback - use AI with simpler prompt
    return await simpleAICalorieEstimate(ingredient, grams);
  }
}

// Simple AI calorie estimate fallback
async function simpleAICalorieEstimate(ingredient, grams) {
  const prompt = `Estimate calories for ${grams}g of ${ingredient}. Return only: {"name": "${ingredient}", "calories": number, "portion": "${grams}g"}`;

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
    
    return { ...result, source: "ai_simple" };
    
  } catch (error) {
    console.log("Simple AI estimate failed:", error);
    return {
      name: ingredient,
      calories: Math.round(grams * 1.5), // Very last resort - rough estimate
      portion: `${grams}g`,
      source: "emergency_fallback"
    };
  }
}

// MAIN SMART BREAKDOWN FUNCTION
async function smartBreakdownMeal(description) {
  try {
    console.log(`\n🧠 SMART BREAKDOWN: "${description}"`);
    
    // STEP 1: Identify distinct dishes
    console.log(`\n📋 STEP 1: Identifying dishes...`);
    const dishes = await identifyDishes(description);
    
    // STEP 2: Break each dish into ingredients
    console.log(`\n🔪 STEP 2: Breaking dishes into ingredients...`);
    const allIngredients = [];
    for (const dish of dishes) {
      const ingredients = await breakDishIntoIngredients(dish);
      
      // Add dish context to each ingredient
      const ingredientsWithContext = ingredients.map(ing => ({
        ingredient: ing,
        dish: dish,
        originalMeal: description
      }));
      
      allIngredients.push(...ingredientsWithContext);
      
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // STEP 3: Estimate portions for each ingredient
    console.log(`\n⚖️ STEP 3: Estimating realistic portions...`);
    const processedFoods = [];
    
    for (const item of allIngredients) {
      // Get portion estimate
      const portionData = await estimateIngredientPortion(
        item.ingredient, 
        item.dish, 
        item.originalMeal
      );
      
      // Try USDA database first
      const usdaResult = await searchUSDADatabase(item.ingredient, portionData.grams);
      
      if (usdaResult) {
        console.log(`         ✅ USDA: ${item.ingredient} = ${usdaResult.calories} cal`);
        processedFoods.push(usdaResult);
      } else {
        // Use AI estimation
        const aiResult = await estimateCaloriesWithAI(
          item.ingredient, 
          portionData.portion, 
          portionData.grams
        );
        console.log(`         🤖 AI: ${item.ingredient} = ${aiResult.calories} cal`);
        processedFoods.push(aiResult);
      }
      
      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // STEP 4: Calculate total and summarize
    const totalCalories = processedFoods.reduce((sum, food) => sum + food.calories, 0);
    
    console.log(`\n📊 BREAKDOWN COMPLETE:`);
    console.log(`   Dishes: ${dishes.length}`);
    console.log(`   Ingredients: ${processedFoods.length}`);
    console.log(`   Total Calories: ${totalCalories}`);
    console.log(`   Sources: ${processedFoods.filter(f => f.source === 'usda').length} USDA, ${processedFoods.filter(f => f.source === 'ai').length} AI, ${processedFoods.filter(f => f.source === 'fallback').length} fallback\n`);
    
    return {
      foods: processedFoods,
      totalCalories: totalCalories,
      clarificationNeeded: false,
      breakdown: {
        dishes: dishes,
        totalIngredients: processedFoods.length
      }
    };
    
  } catch (error) {
    console.log("Smart breakdown error:", error);
    return {
      clarificationNeeded: true,
      question: "Could you describe your meal in more detail? For example, what dishes did you have and roughly what size portions?"
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
    
    // Use the new smart breakdown system
    const result = await smartBreakdownMeal(description);
    
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
    totalMealsLogged: mealLog.length,
    breakdownSystem: "3-step smart breakdown (dishes → ingredients → portions)"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🍽️  SMART Calorie Logger running on http://localhost:${PORT}`);
  console.log(`🧠 3-Step Breakdown: Input → Dishes → Ingredients → Portions`);
  console.log(`🏛️  Connected to USDA FoodData Central (300,000+ foods)`);
  console.log(`🔑 API Key: ${USDA_API_KEY === "DEMO_KEY" ? "Using DEMO_KEY (limited)" : "Custom key configured"}`);
  console.log(`🎯 Smart Flow: Much more accurate ingredient-level breakdown!`);
  console.log(`📖 Get free USDA API key: https://fdc.nal.usda.gov/api-key-signup.html`);
});