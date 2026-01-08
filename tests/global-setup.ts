import { test as setup } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const authFile = 'playwright/.auth/user.json';

setup('verify authentication', async () => {
  const authPath = path.resolve(authFile);

  if (!fs.existsSync(authPath)) {
    console.error(`
╔══════════════════════════════════════════════════════════════════╗
║  AUTH FILE NOT FOUND                                             ║
╠══════════════════════════════════════════════════════════════════╣
║  Run: bun run auth                                               ║
║                                                                  ║
║  Complete Google OAuth, then close browser.                      ║
╚══════════════════════════════════════════════════════════════════╝
    `);
    throw new Error('Auth file not found. Run: bun run auth');
  }

  const authData = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  const sessionCookie = authData.cookies?.find(
    (c: { name: string }) => c.name === '__Secure-authjs.session-token'
  );

  if (!sessionCookie) {
    throw new Error('Invalid auth file. Re-run: bun run auth');
  }

  const now = Date.now() / 1000;
  if (sessionCookie.expires && sessionCookie.expires < now) {
    console.error('Session expired. Re-run: bun run auth');
    throw new Error('Session expired');
  }

  console.log('✅ Authentication verified. Session is valid.');
});
