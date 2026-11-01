/**
 * Pure selectors from the GameState App already holds.
 * No fetch, no TurnCommand, no second simulation.
 */

import { PATHWAY_BUDGET_HEADROOM_TO_HYPE, previewPathway } from '../pathways';
import { previewBurnRate } from '../simulationCore';
import {
  baseBurnRate,
  talentCostFactorClampOf,
  talentCostFactorOf,
} from '../talentMultiplier';

export const CAMPAIGN_RUNWAY_FIELDS = Object.freeze([
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

function runwaySource(dataSource) {
  return dataSource === 'api' ? 'api' : 'local';
}

function sourceProvenance(dataSource) {
  switch (dataSource) {
    case 'api':
      return {
        hype: 'Companies-API hype merged by readApiSnapshot',
        talentCost: 'API read-model',
      };
    case 'local':
      return {
        hype: 'Observed on the sim company',
        talentCost: 'Local dollars',
      };
    default: {
      const neverSource = dataSource;
      throw new Error(`Unknown runway data source: ${String(neverSource)}`);
    }
  }
}

export function campaignRunwayModel(state) {
  const source = runwaySource(state?.dataSource);
  const chips = sourceProvenance(source);
  const taxRate = Number(state?.taxRate);
  const pathway = previewPathway(PATHWAY_BUDGET_HEADROOM_TO_HYPE, state, state?.taxRate);
  return {
    turn: Number(state?.turn ?? 0),
    taxRate,
    cash: Number(state?.company?.cash),
    burnPreview: previewBurnRate(state),
    baseBurn: baseBurnRate(taxRate),
    hype: Number(state?.company?.hype),
    talentCost: Number(state?.company?.talentCost),
    talentCostFactor: talentCostFactorOf(state),
    talentCostFactorClamp: talentCostFactorClampOf(state),
    budgetHeadroom: Number(state?.civic?.budgetHeadroom),
    hypeBias: Number(state?.civic?.hypeBias),
    pathwaySummary: pathway.summary,
    dataSource: source,
    provenance: {
      turn: 'Campaign observed',
      tax: 'Campaign observed',
      cash: 'Campaign observed',
      burnPreview: 'Preview',
      baseBurn: 'Model from tax',
      hype: chips.hype,
      talentCost: chips.talentCost,
      talentCostFactor: 'Observed factor',
      budgetHeadroom: 'Civic projection input',
      hypeBias: 'Projection',
      pathway: 'Projection',
    },
  };
}
