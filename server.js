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

// POST endpoint to log meals
app.post("/api/logMeal", async (req, res) => {
  try {
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }

    // Call OpenAI API
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a helpful assistant that converts a user's meal description into discrete food items with approximate calories. Always assume standard serving sizes unless the user clarifies. If you're unsure about portion size, ask exactly one follow-up question. Return valid JSON only in this exact format:
{
  "foods": [
    { "name": "food item name", "calories": number }
  ],
  "totalCalories": number,
  "clarificationNeeded": false
}

Or if clarification is needed:
{
  "clarificationNeeded": true,
  "question": "your question here"
}`,
            },
            {
              role: "user",
              content: description,
            },
          ],
          temperature: 0.3,
        }),
      }
    );

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiMessage = openaiData.choices[0].message.content.trim();

    console.log("AI Response:", aiMessage); // Debug log

    // Parse AI response
    let parsedMeal;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : aiMessage;
      parsedMeal = JSON.parse(jsonString);

      // Validate the response structure
      if (
        !parsedMeal.clarificationNeeded &&
        (!parsedMeal.foods || !Array.isArray(parsedMeal.foods))
      ) {
        throw new Error("Invalid response format");
      }
    } catch (parseError) {
      console.log("JSON Parse Error:", parseError); // Debug log
      console.log("Original AI Message:", aiMessage); // Debug log

      // If AI didn't return valid JSON, create a basic response
      parsedMeal = {
        foods: [{ name: description, calories: 200 }],
        totalCalories: 200,
        clarificationNeeded: false,
      };
    }

    // Ensure required fields exist
    if (!parsedMeal.clarificationNeeded) {
      if (!parsedMeal.foods) parsedMeal.foods = [];
      if (!parsedMeal.totalCalories) {
        parsedMeal.totalCalories = parsedMeal.foods.reduce(
          (sum, food) => sum + (food.calories || 0),
          0
        );
      }
    }

    // Add timestamp and store in meal log (only if not asking for clarification)
    if (!parsedMeal.clarificationNeeded) {
      const mealEntry = {
        timestamp: new Date().toISOString(),
        ...parsedMeal,
      };

      mealLog.push(mealEntry);
    }

    // Send response
    res.json({
      meal: parsedMeal,
      mealLog: mealLog,
    });
  } catch (error) {
    console.error("Error processing meal:", error);
    res.status(500).json({ error: "Failed to process meal description" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
