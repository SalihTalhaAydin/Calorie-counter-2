#!/bin/bash

# Create project structure
mkdir -p public

# Create package.json
cat > package.json << 'EOF'
{
  "name": "calorie-logger-demo",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "node-fetch": "^2.7.0",
    "dotenv": "^16.3.1"
  }
}
EOF

# Create .env file
cat > .env << 'EOF'
OPENAI_API_KEY=sk-your-openai-api-key-here
PORT=3000
EOF

# Create server.js
cat > server.js << 'EOF'
const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// In-memory storage for meal logs
let mealLog = [];

// POST endpoint to log meals
app.post('/api/logMeal', async (req, res) => {
  try {
    const { description } = req.body;
    
    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
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
}`
          },
          {
            role: 'user',
            content: description
          }
        ],
        temperature: 0.3
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiMessage = openaiData.choices[0].message.content.trim();
    
    console.log('AI Response:', aiMessage); // Debug log
    
    // Parse AI response
    let parsedMeal;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : aiMessage;
      parsedMeal = JSON.parse(jsonString);
      
      // Validate the response structure
      if (!parsedMeal.clarificationNeeded && (!parsedMeal.foods || !Array.isArray(parsedMeal.foods))) {
        throw new Error('Invalid response format');
      }
      
    } catch (parseError) {
      console.log('JSON Parse Error:', parseError); // Debug log
      console.log('Original AI Message:', aiMessage); // Debug log
      
      // If AI didn't return valid JSON, create a basic response
      parsedMeal = {
        foods: [{ name: description, calories: 200 }],
        totalCalories: 200,
        clarificationNeeded: false
      };
    }

    // Ensure required fields exist
    if (!parsedMeal.clarificationNeeded) {
      if (!parsedMeal.foods) parsedMeal.foods = [];
      if (!parsedMeal.totalCalories) {
        parsedMeal.totalCalories = parsedMeal.foods.reduce((sum, food) => sum + (food.calories || 0), 0);
      }
    }

    // Add timestamp and store in meal log (only if not asking for clarification)
    if (!parsedMeal.clarificationNeeded) {
      const mealEntry = {
        timestamp: new Date().toISOString(),
        ...parsedMeal
      };
      
      mealLog.push(mealEntry);
    }

    // Send response
    res.json({
      meal: parsedMeal,
      mealLog: mealLog
    });

  } catch (error) {
    console.error('Error processing meal:', error);
    res.status(500).json({ error: 'Failed to process meal description' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
EOF

# Create public/index.html
cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Calorie Logger</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 30px;
        }
        textarea {
            width: 100%;
            height: 100px;
            padding: 15px;
            border: 2px solid #ddd;
            border-radius: 5px;
            font-size: 16px;
            margin-bottom: 15px;
            box-sizing: border-box;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin-right: 10px;
        }
        button:hover {
            background-color: #45a049;
        }
        button:disabled {
            background-color: #cccccc;
            cursor: not-allowed;
        }
        #clarification {
            background-color: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        #clarificationInput {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 3px;
            margin: 10px 0;
            box-sizing: border-box;
        }
        #result {
            background-color: #d4edda;
            border: 1px solid #c3e6cb;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        #history {
            background-color: #f8f9fa;
            border: 1px solid #e9ecef;
            padding: 15px;
            border-radius: 5px;
            margin-top: 20px;
        }
        .food-item {
            margin: 5px 0;
            padding: 5px;
            background-color: #e9ecef;
            border-radius: 3px;
        }
        .total-calories {
            font-weight: bold;
            font-size: 18px;
            margin-top: 10px;
            color: #155724;
        }
        .history-item {
            margin: 5px 0;
            padding: 8px;
            background-color: white;
            border-radius: 3px;
            border-left: 4px solid #4CAF50;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🍽️ AI Calorie Logger</h1>
        
        <textarea id="mealInput" placeholder="Describe your meal (e.g., 'I had scrambled eggs with toast and orange juice for breakfast')"></textarea>
        
        <button id="logButton">Log Meal</button>
        
        <div id="clarification" style="display:none;">
            <p id="clarificationText"></p>
            <input id="clarificationInput" placeholder="Enter your clarification here..."/>
            <button id="clarifyButton">Submit</button>
        </div>
        
        <div id="result"></div>
        
        <div id="history">
            <h3>📊 Meal History</h3>
            <div id="historyList"></div>
        </div>
    </div>

    <script src="app.js"></script>
</body>
</html>
EOF

# Create public/app.js
cat > public/app.js << 'EOF'
let originalDescription = '';

document.addEventListener('DOMContentLoaded', function() {
    const mealInput = document.getElementById('mealInput');
    const logButton = document.getElementById('logButton');
    const clarificationDiv = document.getElementById('clarification');
    const clarificationText = document.getElementById('clarificationText');
    const clarificationInput = document.getElementById('clarificationInput');
    const clarifyButton = document.getElementById('clarifyButton');
    const resultDiv = document.getElementById('result');
    const historyList = document.getElementById('historyList');

    // Log meal button click
    logButton.addEventListener('click', async function() {
        const description = mealInput.value.trim();
        
        if (!description) {
            alert('Please describe your meal first!');
            return;
        }

        originalDescription = description;
        await logMeal(description);
    });

    // Clarification submit button click
    clarifyButton.addEventListener('click', async function() {
        const clarification = clarificationInput.value.trim();
        
        if (!clarification) {
            alert('Please provide a clarification!');
            return;
        }

        const fullDescription = originalDescription + ' ' + clarification;
        
        // Hide clarification UI
        clarificationDiv.style.display = 'none';
        logButton.style.display = 'inline-block';
        
        await logMeal(fullDescription);
    });

    // Main function to log meals
    async function logMeal(description) {
        try {
            logButton.disabled = true;
            logButton.textContent = 'Processing...';

            const response = await fetch('/api/logMeal', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ description })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to log meal');
            }

            // Validate response structure
            if (!data.meal) {
                throw new Error('Invalid response from server');
            }

            // Check if clarification is needed
            if (data.meal.clarificationNeeded) {
                showClarification(data.meal.question || 'Please provide more details about your meal.');
            } else {
                displayResult(data.meal);
                renderHistory(data.mealLog || []);
                mealInput.value = '';
            }

        } catch (error) {
            console.error('Error:', error);
            alert('Error logging meal: ' + error.message);
        } finally {
            logButton.disabled = false;
            logButton.textContent = 'Log Meal';
        }
    }

    // Show clarification UI
    function showClarification(question) {
        clarificationText.textContent = question;
        clarificationDiv.style.display = 'block';
        logButton.style.display = 'none';
        clarificationInput.value = '';
        clarificationInput.focus();
    }

    // Display meal parsing results
    function displayResult(meal) {
        resultDiv.innerHTML = '';
        
        const title = document.createElement('h3');
        title.textContent = '✅ Meal Logged Successfully';
        resultDiv.appendChild(title);

        // Check if foods array exists and display individual foods
        if (meal.foods && Array.isArray(meal.foods)) {
            meal.foods.forEach(food => {
                const foodDiv = document.createElement('div');
                foodDiv.className = 'food-item';
                foodDiv.textContent = `${food.name || 'Unknown food'} — ${food.calories || 0} kcal`;
                resultDiv.appendChild(foodDiv);
            });
        } else {
            const errorDiv = document.createElement('div');
            errorDiv.textContent = 'No food items parsed from your meal description.';
            errorDiv.style.color = '#666';
            resultDiv.appendChild(errorDiv);
        }

        // Display total calories
        const totalDiv = document.createElement('div');
        totalDiv.className = 'total-calories';
        totalDiv.textContent = `Total: ${meal.totalCalories || 0} kcal`;
        resultDiv.appendChild(totalDiv);
    }

    // Render meal history
    function renderHistory(logArray) {
        historyList.innerHTML = '';
        
        if (logArray.length === 0) {
            const emptyMsg = document.createElement('p');
            emptyMsg.textContent = 'No meals logged yet.';
            emptyMsg.style.fontStyle = 'italic';
            emptyMsg.style.color = '#666';
            historyList.appendChild(emptyMsg);
            return;
        }

        // Show meals in reverse chronological order
        const reversedLog = [...logArray].reverse();
        
        reversedLog.forEach(entry => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            
            const date = new Date(entry.timestamp);
            const timeString = date.toLocaleString();
            
            historyItem.textContent = `[${timeString}] — ${entry.totalCalories} kcal`;
            historyList.appendChild(historyItem);
        });
    }
});
EOF

echo "✅ Project setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your OpenAI API key"
echo "2. Run: npm install"
echo "3. Run: npm start"
echo "4. Open: http://localhost:3000"
echo ""
echo "📁 Files created:"
echo "  - package.json"
echo "  - .env (add your OpenAI API key here)"
echo "  - server.js"
echo "  - public/index.html"
echo "  - public/app.js"