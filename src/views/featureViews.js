import { CAMPAIGN_RUNWAY_ID } from '../shell/windowModel';
import CampaignRunwayView from './CampaignRunwayView';

export function resolveFeatureView(viewId) {
  if (viewId === CAMPAIGN_RUNWAY_ID) return CampaignRunwayView;
  return null;
}
