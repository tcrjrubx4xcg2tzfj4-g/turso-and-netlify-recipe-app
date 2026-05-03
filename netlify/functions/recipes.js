export const handler = async () => {
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

  try {
    const response = await fetch(`${httpUrl}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          { type: "execute", stmt: { sql: "SELECT name, source FROM recipes" } },
          { type: "close" },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Turso API error ${response.status}: ${text}`);
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      throw new Error("Empty response from Turso");
    }

    const firstResult = data.results[0];
    if (firstResult.type !== "ok") {
      throw new Error("Query failed");
    }

    const resultSet = firstResult.response.result;
    const cols = resultSet.cols.map((col) => col.name);
    const rows = resultSet.rows.map((row) => {
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rows),
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
