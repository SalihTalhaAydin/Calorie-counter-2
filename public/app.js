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
