import type { ResearchConnector, ResearchConnectorFetchOptions, NormalizedResearchRecord } from '../types';

export { ResearchConnector, ResearchConnectorFetchOptions, NormalizedResearchRecord };

export function connectorTimeoutMs(): number {
  const value = Number(process.env.RESEARCH_CONNECTOR_TIMEOUT_MS || '8000');
  return Number.isFinite(value) && value > 0 ? value : 8000;
}

export function researchUserAgent(): string {
  return process.env.RESEARCH_USER_AGENT || 'FitnessAssistantResearchBot/1.0 (+contact via RESEARCH_CONTACT_EMAIL)';
}
