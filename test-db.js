const { Client } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

async function testConnection() {
  const tryConnect = async (name, url) => {
    const client = new Client({ connectionString: url });
    try {
      console.log(`Testing ${name}...`);
      await client.connect();
      console.log(`Successfully connected to ${name}`);
      await client.end();
    } catch (err) {
      console.error(`Failed ${name}: ${err.message}`);
    }
  };

  await tryConnect('postgres@localhost:5432', 'postgres://postgres@localhost:5432/postgres');
  await tryConnect('postgres@localhost:5433', 'postgres://postgres@localhost:5433/postgres');
  await tryConnect('chatbot@localhost:5433 (from .env)', process.env.DATABASE_URL);
  await tryConnect('chatbot@localhost:5432', process.env.DATABASE_URL.replace('5433', '5432'));

  process.exit(0);
}

testConnection();
