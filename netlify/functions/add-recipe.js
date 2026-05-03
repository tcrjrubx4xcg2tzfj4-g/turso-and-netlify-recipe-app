import { getTursoClient } from './utils/turso.js';

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  if (event.httpMethod === "GET") {
    try {
      const results = await runPipeline([
        {
          type: "execute",
          stmt: {
            sql: "SELECT id, name FROM ingredients_reference ORDER BY name",
          },
        },
        {
          type: "execute",
          stmt: {
            sql: "SELECT DISTINCT category FROM recipe_categories ORDER BY category",
          },
        },
        { type: "close" },
      ]);

      const ingredients = extractRows(results[0]);
      const categories = extractRows(results[1]);

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ ingredients, categories }),
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
  }

  if (event.httpMethod === "POST") {
    const token = event.queryStringParameters?.token;
    const expectedToken = process.env.WRITE_ACCESS_USER_TOKEN;

    if (!expectedToken) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Server configuration error: missing WRITE_ACCESS_USER_TOKEN" }),
      };
    }

    if (token !== expectedToken) {
      return {
        statusCode: 403,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Forbidden: invalid or missing token" }),
      };
    }

    try {
      let body;
      try {
        body = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: "Invalid JSON body" }),
        };
      }

      const { name, source, ingredients, categories } = body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return {
          statusCode: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: "Recipe name is required" }),
        };
      }

      if (!Array.isArray(ingredients) || ingredients.length === 0) {
        return {
          statusCode: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: "At least one ingredient is required" }),
        };
      }

      for (const ing of ingredients) {
        if (typeof ing.grams !== "number" || ing.grams <= 0) {
          return {
            statusCode: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify({ error: "Each ingredient needs positive grams" }),
          };
        }
        if (ing.type === "new") {
          if (!ing.name || typeof ing.name !== "string" || ing.name.trim().length === 0) {
            return {
              statusCode: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
              body: JSON.stringify({ error: "New ingredient name is required" }),
            };
          }
          if (typeof ing.calories_per_100g !== "number" || ing.calories_per_100g < 0) {
            return {
              statusCode: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
              body: JSON.stringify({ error: "New ingredient calories must be 0 or more" }),
            };
          }
        } else if (ing.type === "existing") {
          if (!ing.ingredient_id || typeof ing.ingredient_id !== "number") {
            return {
              statusCode: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
              body: JSON.stringify({ error: "Existing ingredient must have a valid ID" }),
            };
          }
        } else {
          return {
            statusCode: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
            body: JSON.stringify({ error: "Ingredient type must be 'existing' or 'new'" }),
          };
        }
      }

      const pipeline1 = [];
      pipeline1.push({
        type: "execute",
        stmt: {
          sql: "INSERT INTO recipes (name, source) VALUES (?, ?) RETURNING id",
          args: [toTursoValue(name.trim()), toTursoValue(typeof source === "string" ? source.trim() : "")],
        },
      });

      const newIngredientIndices = [];
      ingredients.forEach((ing, idx) => {
        if (ing.type === "new") {
          pipeline1.push({
            type: "execute",
            stmt: {
              sql: "INSERT INTO ingredients_reference (name, calories_per_100g) VALUES (?, ?) RETURNING id",
              args: [toTursoValue(ing.name.trim()), toTursoValue(Math.round(ing.calories_per_100g))],
            },
          });
          newIngredientIndices.push({ resultIndex: pipeline1.length - 1, ingredientIndex: idx });
        }
      });

      pipeline1.push({ type: "close" });

      const results1 = await runPipeline(pipeline1);

      const recipeRow = extractRows(results1[0])[0];
      if (!recipeRow || !recipeRow.id) {
        throw new Error("Failed to retrieve new recipe ID");
      }
      const recipeId = recipeRow.id;

      const resolvedIngredientIds = new Array(ingredients.length);
      ingredients.forEach((ing, idx) => {
        if (ing.type === "existing") {
          resolvedIngredientIds[idx] = ing.ingredient_id;
        }
      });

      for (const { resultIndex, ingredientIndex } of newIngredientIndices) {
        const row = extractRows(results1[resultIndex])[0];
        if (!row || !row.id) {
          throw new Error("Failed to retrieve new ingredient ID");
        }
        resolvedIngredientIds[ingredientIndex] = row.id;
      }

      const pipeline2 = [];
      ingredients.forEach((ing, idx) => {
        pipeline2.push({
          type: "execute",
          stmt: {
            sql: "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, ingredient_order, grams) VALUES (?, ?, ?, ?)",
            args: [toTursoValue(recipeId), toTursoValue(resolvedIngredientIds[idx]), toTursoValue(idx + 1), toTursoValue(Math.round(ing.grams))],
          },
        });
      });

      if (Array.isArray(categories)) {
        for (const cat of categories) {
          const trimmed = typeof cat === "string" ? cat.trim() : "";
          if (trimmed) {
            pipeline2.push({
              type: "execute",
              stmt: {
                sql: "INSERT INTO recipe_categories (recipe_id, category) VALUES (?, ?)",
                args: [toTursoValue(recipeId), toTursoValue(trimmed)],
              },
            });
          }
        }
      }

      pipeline2.push({ type: "close" });
      await runPipeline(pipeline2);

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ success: true, recipe_id: recipeId }),
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
  }

  return {
    statusCode: 405,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ error: "Method not allowed" }),
  };
};
