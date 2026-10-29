import { test as base, expect } from '@playwright/test';

const TRIGGER_COLLECTION = 'http://127.0.0.1:8787/api/triggers';

async function clearServerTriggers(request) {
  if (!process.env.CITIZEN_API_E2E) return;
  const response = await request.delete(TRIGGER_COLLECTION);
  if (response.status() !== 204) {
    throw new Error(`DELETE /api/triggers failed (${response.status()})`);
  }
}

export function roundTo(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Math.sign(value) * 1e-10) * scale) / scale;
}

export function clampedTalentCostFactor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return roundTo(Math.min(3, Math.max(0.1, numeric)), 4);
}

export function simulationBurn(company, taxRate = 0.25) {
  const employee = Number(company?.talentMultiplier);
  const safeEmployee = Number.isFinite(employee) && employee >= 0 ? employee : 1;
  const factor = clampedTalentCostFactor(company?.talentCostFactor ?? 1);
  const tax = Number.isFinite(Number(taxRate)) ? Number(taxRate) : 0.25;
  const base = Math.round(2000 * (1 + tax * 0.4));
  return Math.round(base * safeEmployee * factor);
}

export function formatMoney(value) {
  const amount = roundTo(Number(value), 2);
  const body = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(Math.abs(amount))
    .replace(/\.00$/, '');
  return amount < 0 ? `-${body}` : body;
}

export function formatFactor(value) {
  let text = roundTo(Number(value), 4).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (!text.includes('.')) text = `${text}.00`;
  else if (text.split('.')[1].length < 2) text = `${text}0`;
  return text;
}

export function equationNumber(value) {
  return roundTo(Number(value), 4).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

export const test = base.extend({
  page: async ({ page, request }, use) => {
    await clearServerTriggers(request);
    // Seed campaign lens so legacy smokes see TriggerPanel + full desk without
    // clicking role select (product first visit still shows the gate).
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('citizen.playerRole', 'campaign');
      } catch {
        // ignore quota / private-mode
      }
    });
    await use(page);
    await clearServerTriggers(request);
  },
});

export { expect };
