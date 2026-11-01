import { describe, expect, test } from 'vitest';
import { initialState } from '../simulationCore';
import { CAMPAIGN_RUNWAY_FIELDS, campaignRunwayModel } from './simulationAdapter';

const BANNED_KEY = /revenue|profit|sku|invoice/i;

describe('campaignRunwayModel', () => {
  test('locks initialState runway figures and provenance', () => {
    const model = campaignRunwayModel(initialState);

    expect(model.turn).toBe(0);
    expect(model.taxRate).toBe(0.25);
    expect(model.cash).toBe(15000);
    expect(model.burnPreview).toBe(2200);
    expect(model.baseBurn).toBe(2200);
    expect(model.hype).toBe(0.3);
    expect(model.talentCost).toBe(4000);
    expect(model.budgetHeadroom).toBe(0.75);
    expect(model.hypeBias).toBe(0);
    expect(model.pathwaySummary).toMatch(/budgetHeadroom/);
    expect(model.pathwaySummary).toMatch(/company\.hype/);

    expect(model.provenance.turn).toMatch(/campaign observed/i);
    expect(model.provenance.tax).toMatch(/campaign observed/i);
    expect(model.provenance.cash).toMatch(/campaign observed/i);
    expect(model.provenance.burnPreview).toMatch(/preview/i);
    expect(model.provenance.baseBurn).toMatch(/model/i);
    expect(model.provenance.hype).toMatch(/observed/i);
    expect(model.provenance.talentCost).toMatch(/local dollars/i);
    expect(model.provenance.talentCostFactor).toMatch(/observed/i);
    expect(model.provenance.budgetHeadroom).toMatch(/projection/i);
    expect(model.provenance.hypeBias).toMatch(/projection/i);
    expect(model.provenance.pathway).toMatch(/projection/i);
    expect(model.talentCostFactorClamp).toBeNull();
  });

  test('field list is only the runway reads', () => {
    expect(CAMPAIGN_RUNWAY_FIELDS).toEqual([
      'turn',
      'tax',
      'cash',
      'burnPreview',
      'baseBurn',
      'hype',
      'talentCost',
      'talentCostFactor',
      'budgetHeadroom',
      'hypeBias',
      'pathway',
    ]);

    const model = campaignRunwayModel(initialState);
    for (const key of Object.keys(model)) {
      expect(key).not.toMatch(BANNED_KEY);
    }
    for (const key of Object.keys(model.provenance)) {
      expect(key).not.toMatch(BANNED_KEY);
    }
    expect(JSON.stringify(model)).not.toMatch(BANNED_KEY);
    expect(model).not.toHaveProperty('revenue');
    expect(model).not.toHaveProperty('profit');
    expect(model).not.toHaveProperty('sku');
    expect(model).not.toHaveProperty('invoice');
    expect(model).not.toHaveProperty('grossProfit');
    expect(model).not.toHaveProperty('netProfit');
  });

  test('api hype and talent cost use the companies read-model chip', () => {
    const model = campaignRunwayModel({
      ...initialState,
      dataSource: 'api',
    });
    expect(model.provenance.hype).toMatch(/readApiSnapshot/);
    expect(model.provenance.talentCost).toMatch(/API read-model/);
    expect(model.cash).toBe(15000);
    expect(model.burnPreview).toBe(2200);
  });

  test('talent cost factor clamp is present only when the flag is set', () => {
    const capped = campaignRunwayModel({
      ...initialState,
      company: { ...initialState.company, talentCost: 40000 },
    });
    expect(capped.talentCostFactorClamp).toBe('cap');
    expect(capped.talentCost).toBe(40000);
  });
});
