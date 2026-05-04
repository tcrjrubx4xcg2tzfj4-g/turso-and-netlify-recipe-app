import { getTursoClient } from './utils/turso.js';

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  let runPipeline, extractRows, toTursoValue;
  try {
    const tursoClient = getTursoClient();
    runPipeline = tursoClient.runPipeline;
    extractRows = tursoClient.extractRows;
    toTursoValue = tursoClient.toTursoValue;
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const recipeId = event.queryStringParameters?.id;
  if (!recipeId) {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Recipe ID is required" }),
    };
  }

  const parsedId = parseInt(recipeId, 10);
  if (isNaN(parsedId)) {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Invalid recipe ID" }),
    };
  }

  try {
    const results = await runPipeline([
      {
        type: "execute",
        stmt: {
          sql: "SELECT id, name, source FROM recipes WHERE id = ?",
          args: [toTursoValue(String(parsedId))],
        },
      },
      {
        type: "execute",
        stmt: {
          sql: `SELECT 
                  ri.ingredient_order, 
                  ri.grams, 
                  ir.name AS ingredient_name, 
                  ir.calories_per_100g 
                FROM recipe_ingredients ri
                JOIN ingredients_reference ir ON ri.ingredient_id = ir.id
                WHERE ri.recipe_id = ?
                ORDER BY ri.ingredient_order`,
          args: [toTursoValue(String(parsedId))],
        },
      },
      {
        type: "execute",
        stmt: {
          sql: "SELECT category FROM recipe_categories WHERE recipe_id = ? ORDER BY category",
          args: [toTursoValue(String(parsedId))],
        },
      },
      { type: "close" },
    ]);

    const recipeRows = extractRows(results[0]);
    if (recipeRows.length === 0) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Recipe not found" }),
      };
    }
    const recipe = recipeRows[0];

    const ingredients = extractRows(results[1]).map((ing) => ({
      order: ing.ingredient_order,
      name: ing.ingredient_name,
      grams: ing.grams,
      caloriesPer100g: ing.calories_per_100g,
      totalCalories: Math.round((ing.grams * ing.calories_per_100g) / 100),
    }));

    const categories = extractRows(results[2]).map((c) => c.category);

    const totalRecipeCalories = ingredients.reduce(
      (sum, ing) => sum + ing.totalCalories,
      0
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        recipe: {
          id: recipe.id,
          name: recipe.name,
          source: recipe.source,
        },
        ingredients,
        categories,
        totalCalories: totalRecipeCalories,
      }),
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
