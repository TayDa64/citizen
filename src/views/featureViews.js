import CompanyOpsForms from '../components/CompanyOpsForms';
import { CAMPAIGN_RUNWAY_ID, COMPANY_OPS_ID } from '../shell/windowModel';
import CampaignRunwayView from './CampaignRunwayView';

export function resolveFeatureView(viewId) {
  switch (viewId) {
    case CAMPAIGN_RUNWAY_ID:
      return CampaignRunwayView;
    case COMPANY_OPS_ID:
      return CompanyOpsForms;
    default:
      return null;
  }
}
