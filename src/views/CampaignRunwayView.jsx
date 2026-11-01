import { formatBudgetHeadroom, formatHypeBias } from '../civicFeedback';
import {
  formatCurrency,
  formatHypePercent,
} from '../triggers';

function RunwayField({ id, label, value, chip, kind, note }) {
  return (
    <div className={`runway-field runway-field--${kind}`} data-testid={`runway-field-${id}`}>
      <dt>{label}</dt>
      <dd>
        {value}
        {note}
        <span className={`runway-chip runway-chip--${kind}`} data-testid={`runway-chip-${id}`}>
          {chip}
        </span>
      </dd>
    </div>
  );
}

export default function CampaignRunwayView({ model }) {
  return (
    <div className="runway-scrim" data-testid="campaign-runway-view">
      <p className="runway-authority" data-testid="runway-authority">
        Hype, talent cost, and the civic projection are campaign authority (GameState / turn commits). Do not read company cash or burn from GET /api/companies.
      </p>
      <dl className="runway-fields">
        <RunwayField
          id="turn"
          label="Turn"
          kind="observed"
          chip={model.provenance.turn}
          value={<span data-testid="runway-turn">{model.turn}</span>}
        />
        <RunwayField
          id="hype"
          label="Company hype"
          kind="observed"
          chip={model.provenance.hype}
          value={(
            <span data-testid="runway-hype">
              {formatHypePercent(model.hype)} ({model.hype})
            </span>
          )}
        />
        <RunwayField
          id="talent-cost"
          label="Talent cost"
          kind="observed"
          chip={model.provenance.talentCost}
          value={(
            // Trailing word keeps this off the bare "$4,480" text node local mode forbids.
            <span data-testid="runway-talent-cost">
              {formatCurrency(model.talentCost)}
              {' '}
              dollars
            </span>
          )}
        />
        <RunwayField
          id="headroom"
          label="Budget headroom"
          kind="projection"
          chip={model.provenance.budgetHeadroom}
          value={<span data-testid="runway-headroom">{formatBudgetHeadroom(model.budgetHeadroom)}</span>}
        />
        <RunwayField
          id="hype-bias"
          label="Civic hype bias"
          kind="projection"
          chip={model.provenance.hypeBias}
          value={(
            <span data-testid="runway-hype-bias">
              {formatHypeBias(model.hypeBias)}
              {' '}
              Bias is 0 at 25% tax.
            </span>
          )}
        />
        <RunwayField
          id="pathway"
          label="Pathway"
          kind="projection"
          chip={model.provenance.pathway}
          value={<span data-testid="runway-pathway">{model.pathwaySummary}</span>}
        />
      </dl>
    </div>
  );
}
