import CausalRulesPanel from '../components/CausalRulesPanel';
import { CompanyMetrics } from '../components/Dashboard';
import CompanyOpsForms from '../components/CompanyOpsForms';
import WorkflowDiagram from '../WorkflowDiagram';
import {
  CAMPAIGN_CAUSAL_ID,
  CAMPAIGN_RUNWAY_ID,
  COMPANY_METRICS_ID,
  COMPANY_OPS_ID,
  WORKFLOW_DIAGRAM_ID,
} from '../shell/windowModel';
import CampaignRunwayView from './CampaignRunwayView';

export function resolveFeatureView(viewId) {
  switch (viewId) {
    case CAMPAIGN_RUNWAY_ID:
      return CampaignRunwayView;
    case CAMPAIGN_CAUSAL_ID:
      return CausalRulesPanel;
    case COMPANY_OPS_ID:
      return CompanyOpsForms;
    case COMPANY_METRICS_ID:
      return CompanyMetrics;
    case WORKFLOW_DIAGRAM_ID:
      return WorkflowDiagram;
    default:
      return null;
  }
}
