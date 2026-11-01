import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { PLAYER_ROLE_CAMPAIGN } from '../playerRole';
import { initialState } from '../simulationCore';
import { campaignRunwayModel } from '../shell/simulationAdapter';
import CampaignRunwayView from './CampaignRunwayView';

const BANNED_COPY = /revenue|gross profit|net profit|invoice|SKU/i;

function renderRunway(state = initialState) {
  const model = campaignRunwayModel(state);
  render(<CampaignRunwayView model={model} />);
  return model;
}

describe('CampaignRunwayView', () => {
  test('renders the runway figures, provenance, and authority sentence', () => {
    const model = renderRunway();

    expect(screen.getByTestId('runway-turn')).toHaveTextContent('0');
    expect(screen.getByTestId('runway-tax')).toHaveTextContent('25%');
    expect(screen.getByTestId('runway-cash').textContent.replace(/,/g, '')).toContain('$15000');
    expect(screen.getByTestId('runway-burn')).toHaveTextContent('$2,200');
    expect(screen.getByTestId('runway-base-burn')).toHaveTextContent('$2,200');
    expect(screen.getByTestId('runway-hype')).toHaveTextContent('0.3');
    expect(screen.getByTestId('runway-talent-cost').textContent.replace(/,/g, '')).toContain('4000');
    expect(screen.getByTestId('runway-talent-factor')).toHaveTextContent('1.00');
    expect(screen.getByTestId('runway-headroom')).toHaveTextContent('75%');
    expect(screen.getByTestId('runway-hype-bias')).toHaveTextContent('0');
    expect(screen.getByTestId('runway-hype-bias')).toHaveTextContent(/bias is 0 at 25% tax/i);
    expect(screen.getByTestId('runway-pathway')).toHaveTextContent(model.pathwaySummary);
    expect(screen.getByTestId('runway-authority')).toHaveTextContent(/campaign authority/i);
    expect(screen.getByTestId('runway-authority')).toHaveTextContent(/companies/i);

    expect(screen.getByTestId('runway-chip-turn')).toHaveTextContent(/campaign observed/i);
    expect(screen.getByTestId('runway-chip-cash')).toHaveTextContent(/campaign observed/i);
    expect(screen.getByTestId('runway-chip-burn')).toHaveTextContent(/preview/i);
    expect(screen.getByTestId('runway-chip-base-burn')).toHaveTextContent(/model/i);
    expect(screen.getByTestId('runway-chip-hype')).toHaveTextContent(/observed/i);
    expect(screen.getByTestId('runway-chip-talent-cost')).toHaveTextContent(/local dollars/i);
    expect(screen.getByTestId('runway-chip-pathway')).toHaveTextContent(/projection/i);
    expect(screen.getByTestId('runway-field-pathway').className).toMatch(/projection/);

    expect(screen.queryByTestId('runway-talent-factor-clamp')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /hire/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advance month/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cash & Burn Rate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /economic intelligence/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-runway-view').textContent).not.toMatch(BANNED_COPY);
  });

  test('shows the talent-factor clamp note only when the flag is set', () => {
    renderRunway({
      ...initialState,
      company: { ...initialState.company, talentCost: 40000 },
    });
    expect(screen.getByTestId('runway-talent-factor-clamp')).toHaveTextContent(/capped at 3×/);
  });

  test('api chips name the companies read model', () => {
    renderRunway({ ...initialState, dataSource: 'api' });
    expect(screen.getByTestId('runway-chip-hype')).toHaveTextContent(/readApiSnapshot/);
    expect(screen.getByTestId('runway-chip-talent-cost')).toHaveTextContent(/API read-model/);
  });

  test('mounts one runway beside the existing islands and hides it on the role gate', async () => {
    const { unmount } = render(<App initialPlayerRole={null} />);
    expect(screen.getByTestId('role-select')).toBeInTheDocument();
    expect(screen.queryByTestId('campaign-runway')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: /tax rate/i })).not.toBeInTheDocument();
    unmount();

    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    const runway = screen.getByTestId('campaign-runway');
    expect(runway).toHaveTextContent(/campaign runway/i);
    expect(runway).not.toHaveTextContent(/economic intelligence/i);
    expect(screen.getByTestId('runway-burn')).toHaveTextContent('$2,200');
    expect(screen.getAllByTestId('burn-value')).toHaveLength(1);
    expect(screen.getAllByTestId('cash-value')).toHaveLength(1);
    expect(await screen.findAllByRole('heading', { name: 'Cash & Burn Rate' })).toHaveLength(1);
    expect(screen.getAllByRole('slider', { name: /tax rate/i })).toHaveLength(1);
    expect(screen.getByTestId('campaign-desk')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-authority-note')).toBeInTheDocument();
    expect(runway.textContent).not.toMatch(BANNED_COPY);
  });
});
