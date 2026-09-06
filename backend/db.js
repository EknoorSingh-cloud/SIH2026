const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  console.error("Unexpected database error", err);
});

// query() is the only way the rest of the app talks to Postgres.
// Always pass values as the second argument, never string-concatenate
// them into the SQL. That is what prevents SQL injection.
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { query, pool };