const express = require("express");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

let mealLog = [];

// Smart meal processor with dynamic logic
async function processMeal(description, context = {}) {
  const systemPrompt = `You are a nutrition expert AI. Analyze meals with this smart process:

1. BREAKDOWN: ${description}
   - First identify dishes/items (e.g., "burger and fries" → ["burger", "fries"])
   - Then break each dish into ingredients with portions
   - Consider cooking methods (affects calories significantly)
   - Account for typical restaurant vs homemade portions

2. DYNAMIC FACTORS:
   - User context: ${JSON.stringify(context)}
   - Time of day affects portion assumptions
   - Previous meals today: ${mealLog.length} logged

3. ESTIMATION RULES:
   - Be realistic about portions (people often underestimate)
   - Consider hidden calories (oils, sauces, dressings)
   - Restaurant meals typically 20-40% more calories than homemade
   - If ambiguous, provide a range or ask for clarification

Return JSON only:
{
  "foods": [{"name": "item", "calories": number, "confidence": "high|medium|low", "portion": "description"}],
  "totalCalories": number,
  "clarificationNeeded": boolean,
  "question": "optional clarification",
  "insights": ["optional insights about the meal"]
}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: description }
        ],
        temperature: 0.3,
      }),
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    // Dynamic validation
    if (result.totalCalories > 3000) {
      result.clarificationNeeded = true;
      result.question = "That seems like a lot of food. Did you mean all of this for one meal?";
    }

    return result;
  } catch (error) {
    console.error("AI Error:", error);
    return {
      foods: [{ name: description, calories: 400, confidence: "low", portion: "estimated" }],
      totalCalories: 400,
      clarificationNeeded: false,
      insights: ["Using fallback estimate due to processing error"]
    };
  }
}

// Dynamic daily stats calculator
function calculateDailyStats() {
  const today = new Date().toDateString();
  const todaysMeals = mealLog.filter(m => 
    new Date(m.timestamp).toDateString() === today
  );
  
  const totalCalories = todaysMeals.reduce((sum, meal) => sum + meal.totalCalories, 0);
  const mealCount = todaysMeals.length;
  const avgPerMeal = mealCount > 0 ? Math.round(totalCalories / mealCount) : 0;
  
  // Dynamic recommendations based on time and intake
  const hour = new Date().getHours();
  const remainingMeals = hour < 10 ? 3 : hour < 14 ? 2 : hour < 19 ? 1 : 0;
  const targetDaily = 2000; // Could be dynamic based on user profile
  const remainingCalories = Math.max(0, targetDaily - totalCalories);
  const suggestedPerMeal = remainingMeals > 0 ? Math.round(remainingCalories / remainingMeals) : 0;

  return {
    totalCalories,
    mealCount,
    avgPerMeal,
    remainingCalories,
    suggestedPerMeal,
    insights: generateInsights(todaysMeals, hour)
  };
}

// Generate dynamic insights
function generateInsights(meals, hour) {
  const insights = [];
  const total = meals.reduce((sum, m) => sum + m.totalCalories, 0);
  
  if (meals.length === 0 && hour > 14) {
    insights.push("Don't forget to log your meals today!");
  } else if (total > 2500) {
    insights.push("High calorie day - consider lighter options for remaining meals");
  } else if (total < 1000 && hour > 18) {
    insights.push("Low calorie intake today - make sure you're eating enough");
  }
  
  if (meals.length > 0) {
    const lastMeal = meals[meals.length - 1];
    const timeSince = (Date.now() - new Date(lastMeal.timestamp)) / (1000 * 60 * 60);
    if (timeSince < 1) {
      insights.push("Recent meal logged - wait 2-3 hours before next meal");
    }
  }
  
  return insights;
}

// Main endpoint with dynamic context
app.post("/api/logMeal", async (req, res) => {
  try {
    const { description, isEdit, mealId } = req.body;

    if (!description?.trim()) {
      return res.status(400).json({ error: "Please describe your meal" });
    }

    // Build dynamic context
    const context = {
      time: new Date().toLocaleTimeString(),
      previousMealsToday: mealLog.filter(m => 
        new Date(m.timestamp).toDateString() === new Date().toDateString()
      ).length,
      isEdit
    };

    const result = await processMeal(description, context);
    
    if (!result.clarificationNeeded) {
      const mealEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        description,
        ...result
      };
      
      if (isEdit && mealId) {
        const index = mealLog.findIndex(m => m.id === mealId);
        if (index !== -1) mealLog[index] = mealEntry;
      } else {
        mealLog.push(mealEntry);
      }
    }

    const stats = calculateDailyStats();
    
    res.json({
      meal: result,
      mealLog,
      dailyStats: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ 
      error: "Failed to process meal",
      suggestion: "Try describing your meal differently"
    });
  }
});

// Get personalized recommendations
app.get("/api/recommendations", (req, res) => {
  const stats = calculateDailyStats();
  const hour = new Date().getHours();
  
  const recommendations = [];
  
  if (hour < 10 && stats.mealCount === 0) {
    recommendations.push({
      meal: "Balanced breakfast",
      calories: "300-400",
      examples: ["Oatmeal with berries", "Eggs with whole grain toast", "Greek yogurt parfait"]
    });
  } else if (hour >= 12 && hour < 14 && stats.suggestedPerMeal > 0) {
    recommendations.push({
      meal: "Lunch options",
      calories: `${stats.suggestedPerMeal - 100}-${stats.suggestedPerMeal + 100}`,
      examples: ["Grilled chicken salad", "Quinoa bowl", "Soup and half sandwich"]
    });
  }
  
  res.json({ recommendations, stats });
});

// Delete/edit meal
app.delete("/api/meal/:id", (req, res) => {
  mealLog = mealLog.filter(m => m.id !== req.params.id);
  res.json({ success: true, stats: calculateDailyStats() });
});

// Get history with filtering
app.get("/api/history", (req, res) => {
  const { date, limit = 50 } = req.query;
  let filtered = mealLog;
  
  if (date) {
    filtered = mealLog.filter(m => 
      new Date(m.timestamp).toDateString() === new Date(date).toDateString()
    );
  }
  
  res.json({ 
    mealLog: filtered.slice(-limit).reverse(),
    stats: calculateDailyStats()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Smart Calorie Logger on port ${PORT}`);
  console.log(`📊 Features: Dynamic portions, AI insights, Personalized recommendations`);
});