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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recipesWithDetails),
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
