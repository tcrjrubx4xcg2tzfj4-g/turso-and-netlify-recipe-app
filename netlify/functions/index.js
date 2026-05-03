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

  let runPipeline, extractRows;
  try {
    const tursoClient = getTursoClient();
    runPipeline = tursoClient.runPipeline;
    extractRows = tursoClient.extractRows;
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

  try {
    const results = await runPipeline([
      {
        type: "execute",
        stmt: {
          sql: "SELECT id, name, source FROM recipes ORDER BY name",
        },
      },
      {
        type: "execute",
        stmt: {
          sql: "SELECT recipe_id, category FROM recipe_categories ORDER BY recipe_id, category",
        },
      },
      { type: "close" },
    ]);

    const recipes = extractRows(results[0]);
    const allCategories = extractRows(results[1]);

    const recipesWithDetails = recipes.map((recipe) => {
      const recipeCategories = allCategories
        .filter((cat) => cat.recipe_id === recipe.id)
        .map((cat) => cat.category);
      return {
        id: recipe.id,
        name: recipe.name,
        source: recipe.source,
        categories: recipeCategories,
      };
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(recipesWithDetails),
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
