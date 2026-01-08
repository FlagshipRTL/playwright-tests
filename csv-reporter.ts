import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Custom Playwright reporter that exports test results to CSV
 * Output: test_results.csv with timestamp, test details, and pass/fail status
 */
class CSVReporter implements Reporter {
  private results: Array<{
    timestamp: string;
    test_name: string;
    test_slug: string;
    brand_key: string;
    department: string;
    category: string;
    class: string;
    style: string;
    color: string;
    status: 'passed' | 'failed' | 'skipped';
    duration_ms: number;
    error_message?: string;
    monitoring_months?: string;
    monitoring_values?: string;
    planning_headers?: string;
    planning_values?: string;
  }> = [];

  onTestEnd(test: TestCase, result: TestResult) {
    const timestamp = new Date().toISOString();
    const testTitle = test.title; // e.g., "Band Collar Madras Shirt - LS / Undyed"

    // Parse test title to extract style/color
    const match = testTitle.match(/^(.+?)\s+\/\s+(.+)$/);
    const style = match ? match[1] : testTitle;
    const color = match ? match[2] : '';

    // Extract brand/hierarchy from test output logs
    const logs = result.stdout.join('\n');
    const brandMatch = logs.match(/brand\/([^\/]+)\//);
    const deptMatch = logs.match(/department=([^&]+)/);
    const catMatch = logs.match(/category=([^&]+)/);
    const classMatch = logs.match(/class=([^&]+)/);

    // Extract monitoring/planning data from logs
    const monitoringMatch = logs.match(/\[Monitoring\] .+?: (.+?) = \[(.+?)\]/);
    const planningHeadersMatch = logs.match(/\[Planning\] Headers: \[(.+?)\.\.\.\] \((\d+) total\)/);
    const planningValuesMatch = logs.match(/\[Planning\] Values: \[(.+?)\.\.\.\] \((\d+) total\)/);

    const status = result.status === 'passed' ? 'passed'
                 : result.status === 'skipped' ? 'skipped'
                 : 'failed';

    this.results.push({
      timestamp,
      test_name: testTitle,
      test_slug: testTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      brand_key: brandMatch ? decodeURIComponent(brandMatch[1]) : '',
      department: deptMatch ? decodeURIComponent(deptMatch[1]) : '',
      category: catMatch ? decodeURIComponent(catMatch[1]) : '',
      class: classMatch ? decodeURIComponent(classMatch[1]) : '',
      style,
      color,
      status,
      duration_ms: result.duration,
      error_message: result.error?.message?.split('\n')[0],
      monitoring_months: monitoringMatch ? monitoringMatch[1] : undefined,
      monitoring_values: monitoringMatch ? monitoringMatch[2] : undefined,
      planning_headers: planningHeadersMatch ? planningHeadersMatch[1] : undefined,
      planning_values: planningValuesMatch ? planningValuesMatch[1] : undefined
    });
  }

  onEnd() {
    // Generate CSV
    const csvPath = path.resolve(process.cwd(), 'test_results.csv');
    const headers = [
      'timestamp',
      'test_name',
      'test_slug',
      'brand_key',
      'department',
      'category',
      'class',
      'style',
      'color',
      'status',
      'duration_ms',
      'error_message',
      'monitoring_months',
      'monitoring_values',
      'planning_headers',
      'planning_values'
    ];

    const rows = this.results.map(r => [
      r.timestamp,
      `"${r.test_name.replace(/"/g, '""')}"`,
      r.test_slug,
      r.brand_key,
      r.department,
      r.category,
      r.class,
      `"${r.style.replace(/"/g, '""')}"`,
      `"${r.color.replace(/"/g, '""')}"`,
      r.status,
      r.duration_ms,
      r.error_message ? `"${r.error_message.replace(/"/g, '""')}"` : '',
      r.monitoring_months || '',
      r.monitoring_values || '',
      r.planning_headers || '',
      r.planning_values || ''
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    fs.writeFileSync(csvPath, csv);
    console.log(`\n✅ Results exported to: ${csvPath}`);
    console.log(`   ${this.results.length} test results saved`);

    // Print summary
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const skipped = this.results.filter(r => r.status === 'skipped').length;

    console.log(`\nTest Summary:`);
    console.log(`  ✓ Passed: ${passed}`);
    console.log(`  ✘ Failed: ${failed}`);
    console.log(`  - Skipped: ${skipped}`);
  }
}

export default CSVReporter;
