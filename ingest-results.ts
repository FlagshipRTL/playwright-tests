import * as fs from 'fs';
import * as path from 'path';
import pkg from 'pg';
const { Pool } = pkg;

/**
 * Ingest test_results.csv into PostgreSQL appDb
 *
 * Prerequisites:
 * - DATABASE_URL environment variable set
 * - test_results.csv exists in current directory
 * - schema.sql applied to database
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:5432/appdb node ingest-results.ts
 */

async function ingest() {
  const csvPath = path.resolve(process.cwd(), 'test_results.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('Error: test_results.csv not found');
    console.error('Run tests first: bash run-all-brands.sh');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable not set');
    console.error('Example: DATABASE_URL=postgresql://user:pass@host:5432/appdb');
    process.exit(1);
  }

  console.log('Loading test_results.csv...');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');

  console.log(`Found ${lines.length - 1} test results`);

  // Connect to database
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query('SELECT 1'); // Test connection
    console.log('✓ Connected to PostgreSQL');

    // Prepare insert statement
    const insertQuery = `
      INSERT INTO test_results (
        timestamp,
        test_name,
        test_slug,
        brand_key,
        department,
        category,
        class,
        style,
        color,
        status,
        duration_ms,
        error_message,
        monitoring_months,
        monitoring_values,
        planning_headers,
        planning_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;

    let inserted = 0;
    let errors = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Parse CSV (handle quoted fields)
      const values = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)?.map(v => v.replace(/^"|"$/g, '').replace(/""/g, '"')) || [];

      if (values.length < 10) {
        console.warn(`Skipping line ${i}: insufficient columns`);
        errors++;
        continue;
      }

      try {
        await pool.query(insertQuery, [
          values[0] || new Date().toISOString(),  // timestamp
          values[1] || '',                        // test_name
          values[2] || '',                        // test_slug
          values[3] || null,                      // brand_key
          values[4] || null,                      // department
          values[5] || null,                      // category
          values[6] || null,                      // class
          values[7] || '',                        // style
          values[8] || '',                        // color
          values[9] || 'failed',                  // status
          parseInt(values[10]) || null,           // duration_ms
          values[11] || null,                     // error_message
          values[12] || null,                     // monitoring_months
          values[13] || null,                     // monitoring_values
          values[14] || null,                     // planning_headers
          values[15] || null                      // planning_values
        ]);

        inserted++;

        if (inserted % 50 === 0) {
          console.log(`  ${inserted} rows inserted...`);
        }
      } catch (err) {
        console.error(`Error inserting row ${i}:`, err);
        errors++;
      }
    }

    console.log(`\n✅ Ingestion complete`);
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Errors: ${errors}`);

    // Show sample query
    const sample = await pool.query(`
      SELECT brand_key, COUNT(*) as test_count,
             SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
             SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
      FROM test_results
      WHERE timestamp > NOW() - INTERVAL '1 hour'
      GROUP BY brand_key
      ORDER BY brand_key
    `);

    console.log('\nResults summary (last hour):');
    console.table(sample.rows);

  } catch (err) {
    console.error('Database error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

ingest().catch(console.error);
