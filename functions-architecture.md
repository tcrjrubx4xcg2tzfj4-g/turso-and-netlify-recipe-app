# Netlify Functions Architecture Documentation

## Overview
This document describes the architecture of the Netlify serverless functions used in the recipe application. These functions interact with a Turso (libsql) database to manage recipe data, and are deployed via Netlify's serverless function runtime.

## Netlify Functions Inventory
The repository includes three Netlify serverless functions and one shared utility module:
1. `netlify/functions/add-recipe.js`: Handles creating new recipes and fetching reference data for the add recipe form.
2. `netlify/functions/index.js`: Default function, handles listing all recipes with basic details and associated categories.
3. `netlify/functions/view-recipe.js`: Handles fetching full details for a single recipe by ID, including ingredients and total calories.
4. `netlify/functions/utils/turso.js`: Shared utility module containing all Turso database interaction logic, reused across all functions.

---

## Shared Architecture Patterns
All functions now use a centralized shared utility module (`utils/turso.js`) to eliminate code duplication. The shared module provides:
- `toTursoValue(value)`: Converts JavaScript values to Turso's typed value format (e.g., `{ type: "text", value: "..." }` for strings, `{ type: "integer", value: 123 }` for integers) to prevent Turso API JSON parse errors.
- `getTursoClient()`: Initializes and returns authenticated Turso client methods, validating required environment variables (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) and converting the `libsql://` URL to HTTPS for API requests.
- `runPipeline(requests)`: Sends batched requests to the Turso v2 Pipeline API (`/v2/pipeline`), handles HTTP errors, parses Turso response errors, and returns results.
- `extractRows(result)`: Parses Turso's typed response format into plain JavaScript objects, extracting column names and row values.

### Common Function Structure
All functions follow this pattern:
1. Handle CORS preflight `OPTIONS` requests with appropriate headers.
2. Initialize the Turso client via `getTursoClient()`, returning a 500 error if credentials are missing.
3. Validate the HTTP method, returning 405 if unsupported.
4. Perform request-specific validation and database operations using the shared `runPipeline` and `extractRows` methods.
5. Return responses with consistent CORS headers (`Access-Control-Allow-Origin: *`) and JSON-formatted bodies.

---

## Individual Function Details

### `netlify/functions/add-recipe.js`
- **Purpose**:
  - `GET` request: Returns reference data (all ingredients from `ingredients_reference`, all distinct categories from `recipe_categories`) to populate the add recipe form.
  - `POST` request: Creates a new recipe, with support for both existing and new ingredients, and associates categories with the recipe. Requires authentication via a `token` query parameter matching the `WRITE_ACCESS_USER_TOKEN` environment variable.
- **Unique Features**:
  - Detailed input validation for POST requests: validates recipe name, ingredient structure (type, grams, calories for new ingredients), and category data.
  - Uses two separate Turso pipelines: first to create the recipe and new ingredients (to retrieve generated IDs), second to create recipe-ingredient associations and category associations.
  - Token-based authentication restricted to POST requests.

### `netlify/functions/index.js`
- **Purpose**: Handles `GET` requests to list all recipes with basic details (id, name, source) and their associated categories, ordered by recipe name.
- **Unique Features**:
  - Returns combined recipe and category data by joining recipe results with category results from a single batched Turso pipeline request.
  - Only supports `GET` requests (returns 405 for all other methods).

### `netlify/functions/view-recipe.js`
- **Purpose**: Handles `GET` requests to fetch full details for a single recipe identified by a `id` query parameter, including ingredients (with calculated total calories per ingredient) and total recipe calories.
- **Unique Features**:
  - Validates that the recipe ID is a valid integer, returns 400 for invalid/missing IDs and 404 if the recipe does not exist.
  - Calculates per-ingredient and total recipe calories on the fly using ingredient grams and calories per 100g values.
  - Uses `toTursoValue` to wrap all Turso query arguments, preventing JSON parse errors.

---

## Architecture Improvements Implemented
The following improvements have been applied to the codebase:
1. **Deduplicated Shared Utility Logic**: Moved `runPipeline`, `extractRows`, and `toTursoValue` to a shared `utils/turso.js` module, eliminating ~150 lines of duplicated code across functions.
2. **Consistent Turso Value Wrapping**: All Turso query arguments across all functions now use `toTursoValue` to ensure correct typed formatting, fixing the original "JSON parse error" issue.
3. **Added CORS Support**: All functions now handle OPTIONS preflight requests and include `Access-Control-Allow-Origin` headers in all responses, enabling cross-origin requests from the frontend.
4. **Centralized Turso Configuration**: All Turso client setup, environment variable validation, and URL conversion is handled in `getTursoClient()`, ensuring consistent behavior across functions.
5. **Fixed Incorrect Turso Arguments**: `view-recipe.js` previously used hardcoded Turso value objects with stringified integer values; now uses `toTursoValue` to pass correct typed values.

---

## Remaining Recommended Improvements
The following improvements are still recommended to further enhance maintainability, reliability, and developer experience:
1. **Standardize Authentication**: Only `add-recipe.js` implements token-based authentication. Create a shared authentication helper to apply consistent auth rules across functions that require it, and document public functions explicitly.
2. **Add Input Validation Helpers**: Create shared validation helpers for common data types (e.g., recipe IDs, ingredient structures) to ensure consistent validation across functions.
3. **Migrate to TypeScript**: Add TypeScript support to functions and shared utilities to catch type errors early, improve IDE support, and document data shapes via interfaces.
4. **Add Testing**: Add unit tests for shared helpers (e.g., `toTursoValue`, `extractRows`) and integration tests for function handlers using mocks or a test Turso database.
5. **Improve Error Logging**: Add structured logging with context (function name, request ID, operation being performed) to simplify debugging, replacing generic `console.error` calls.
6. **Optimize Pipeline Usage**: Combine compatible Turso pipeline requests into fewer HTTP round trips where possible, while still handling dependent queries (e.g., retrieving generated IDs) correctly.
7. **Restrict CORS Origins**: Replace the wildcard `Access-Control-Allow-Origin: *` with explicit allowed origins (e.g., the production frontend URL) for better security.
8. **Add Rate Limiting**: Implement rate limiting for POST requests to prevent abuse of the recipe creation endpoint.
