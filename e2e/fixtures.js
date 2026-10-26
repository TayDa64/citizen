import { test as base, expect } from '@playwright/test';

const TRIGGER_COLLECTION = 'http://127.0.0.1:8787/api/triggers';

async function clearServerTriggers(request) {
  if (!process.env.CITIZEN_API_E2E) return;
  const response = await request.delete(TRIGGER_COLLECTION);
  if (response.status() !== 204) {
    throw new Error(`DELETE /api/triggers failed (${response.status()})`);
  }
}

export const test = base.extend({
  page: async ({ page, request }, use) => {
    await clearServerTriggers(request);
    await use(page);
    await clearServerTriggers(request);
  },
});

export { expect };
