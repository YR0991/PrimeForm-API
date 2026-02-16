/**
 * Stale marking: after DELETE /api/admin/users/:uid/activities/:id, users/{uid}.metricsMeta
 * must have loadMetricsStale === true and loadMetricsStaleReason set.
 * Unit test: markLoadMetricsStale writes correct payload.
 * Run: NODE_ENV=test node tests/admin.deleteActivity.stale.test.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const { markLoadMetricsStale } = require('../lib/metricsMeta');

async function main() {
  console.log('Admin delete activity — metricsMeta stale marking\n');

  let capturedData = null;
  let capturedMerge = null;
  const mockDb = {
    collection: (name) => ({
      doc: (id) => ({
        set: (data, opts) => {
          capturedData = data;
          capturedMerge = opts && opts.merge;
          return Promise.resolve();
        }
      })
    })
  };
  const mockAdmin = {
    firestore: {
      Timestamp: {
        now: () => ({ toMillis: () => Date.now() })
      }
    }
  };

  await markLoadMetricsStale(mockDb, mockAdmin, 'test-uid-123', 'ADMIN_DELETE');

  assert.ok(capturedData, 'set() must be called with data');
  assert.strictEqual(capturedMerge, true, 'merge must be true');
  assert.ok(capturedData.metricsMeta, 'metricsMeta must be set');
  assert.strictEqual(capturedData.metricsMeta.loadMetricsStale, true, 'loadMetricsStale must be true');
  assert.strictEqual(capturedData.metricsMeta.loadMetricsStaleReason, 'ADMIN_DELETE', 'loadMetricsStaleReason must be ADMIN_DELETE');
  assert.ok(capturedData.metricsMeta.loadMetricsStaleAt != null, 'loadMetricsStaleAt must be set');

  console.log('  ok markLoadMetricsStale writes loadMetricsStale true and ADMIN_DELETE reason');

  capturedData = null;
  await markLoadMetricsStale(mockDb, mockAdmin, 'u2', 'USER_DELETE');
  assert.strictEqual(capturedData.metricsMeta.loadMetricsStaleReason, 'USER_DELETE');

  console.log('  ok markLoadMetricsStale with USER_DELETE reason');

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
