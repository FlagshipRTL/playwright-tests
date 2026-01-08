-- PostgreSQL schema for Lost Sales test results
-- Target database: appDb (production application database)

CREATE TABLE IF NOT EXISTS test_results (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    test_name VARCHAR(500) NOT NULL,
    test_slug VARCHAR(500) NOT NULL,
    brand_key VARCHAR(100),
    department VARCHAR(100),
    category VARCHAR(100),
    class VARCHAR(100),
    style VARCHAR(500),
    color VARCHAR(100),
    status VARCHAR(20) NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
    duration_ms INTEGER,
    error_message TEXT,
    monitoring_months VARCHAR(100),
    monitoring_values VARCHAR(500),
    planning_headers VARCHAR(500),
    planning_values TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_test_results_timestamp ON test_results(timestamp DESC);
CREATE INDEX idx_test_results_brand_key ON test_results(brand_key);
CREATE INDEX idx_test_results_status ON test_results(status);
CREATE INDEX idx_test_results_test_slug ON test_results(test_slug);

-- Index for finding latest results per product
CREATE INDEX idx_test_results_brand_style_color ON test_results(brand_key, style, color, timestamp DESC);

COMMENT ON TABLE test_results IS 'Lost Sales - Planning vs. Monitoring test results from Playwright automated tests';
COMMENT ON COLUMN test_results.test_name IS 'Human-readable test name (e.g., "Band Collar Madras Shirt - LS / Undyed")';
COMMENT ON COLUMN test_results.test_slug IS 'URL-safe slug (e.g., "band-collar-madras-shirt-ls-undyed")';
COMMENT ON COLUMN test_results.status IS 'Test outcome: passed, failed, or skipped';
COMMENT ON COLUMN test_results.monitoring_months IS 'Months extracted from Monitoring page (e.g., "JUL, AUG, SEP")';
COMMENT ON COLUMN test_results.monitoring_values IS 'Values from Monitoring page (e.g., "[11, 20, 21]")';
COMMENT ON COLUMN test_results.planning_headers IS 'First 6 months from Planning page (e.g., "JAN, FEB, MAR, APR, MAY, JUN")';
COMMENT ON COLUMN test_results.planning_values IS 'All values from Planning page (e.g., "[4, 6, 6, 6, 6, 7, ...]")';
