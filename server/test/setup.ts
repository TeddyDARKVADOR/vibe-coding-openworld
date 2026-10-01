// Imported first by every server test: isolated data directory, immediate writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'openworld-test-'));
process.env.SAVE_INTERVAL_MS ??= '0';
