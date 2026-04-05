const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function checkDatabases(port) {
  const client = new Client({ connectionString: `postgres://postgres@localhost:${port}/postgres` });
  try {
    await client.connect();
    const res = await client.query("SELECT datname FROM pg_database WHERE datname = 'bcra_alerts'");
    if (res.rows.length > 0) {
      console.log(`Database 'bcra_alerts' EXISTS on port ${port}`);
    } else {
      console.log(`Database 'bcra_alerts' DOES NOT EXIST on port ${port}`);
    }
    await client.end();
  } catch (err) {
    console.error(`Error checking databases on port ${port}: ${err.message}`);
  }
}

async function main() {
  await checkDatabases(5432);
  await checkDatabases(5433);
  process.exit(0);
}

main();
