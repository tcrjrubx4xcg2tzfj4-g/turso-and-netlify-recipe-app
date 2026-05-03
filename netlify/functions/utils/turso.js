export function toTursoValue(value) {
  if (typeof value === "string") {
    return { type: "text", value };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { type: "integer", value };
    } else {
      return { type: "real", value };
    }
  }
  if (value === null || value === undefined) {
    return { type: "null" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  throw new Error(`Unsupported Turso value type: ${typeof value}`);
}

export function getTursoClient() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!dbUrl || !authToken) {
    throw new Error("Missing Turso credentials");
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

  return { runPipeline, extractRows, toTursoValue };
}
