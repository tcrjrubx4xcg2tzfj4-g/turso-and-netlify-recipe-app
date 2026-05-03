export const handler = async (event) => {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!dbUrl || !authToken) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing Turso credentials" }),
    };
  }

  const httpUrl = dbUrl.replace(/^libsql:\/\//, "https://");

  const runPipeline = async (requests) => {
    const response = await fetch(`${httpUrl}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Turso API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (!data.results || data.results.length === 0) {
      throw new Error("Empty response from Turso");
    }

    for (const r of data.results) {
      if (r.type === "error") {
        throw new Error(r.error?.message || "Turso query error");
      }
    }

    return data.results;
  };

  const extractRows = (result) => {
    if (!result || result.type !== "ok" || !result.response?.result) return [];
    const rs = result.response.result;
    const cols = rs.cols.map((c) => c.name);
    return (rs.rows || []).map((row) => {
      const obj = {};
      row.forEach((value, index) => {
        const extracted =
          value && typeof value === "object" && "value" in value
            ? value.value
            : value;
        obj[cols[index]] = extracted;
      });
      return obj;
    });
  };

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  const recipeId = event.queryStringParameters?.id;
  if (!recipeId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Recipe ID is required" }),
    };
  }

  const parsedId = parseInt(recipeId, 10);
  if (isNaN(parsedId)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid recipe ID" }),
    };
  }

  try {
    const results = await runPipeline([
      {
        type: "execute",
        stmt: {
          sql: "SELECT id, name, source FROM recipes WHERE id = ?",
          args: [parsedId],
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
          args: [parsedId],
        },
      },
      {
        type: "execute",
        stmt: {
          sql: "SELECT category FROM recipe_categories WHERE recipe_id = ? ORDER BY category",
          args: [parsedId],
        },
      },
      { type: "close" },
    ]);

    const recipeRows = extractRows(results[0]);
    if (recipeRows.length === 0) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
