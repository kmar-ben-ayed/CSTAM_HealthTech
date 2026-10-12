import { apiFetch } from './client';

export interface ConfigRule {
  rule_id: string;
  title: string;
  severity: 'low' | 'medium' | 'high';
  logic: string;
  corrective_action: string;
  version: string;
  source?: string;
}

export interface ConfigPolicy {
  policy_id: string;
  version: string;
  payer_id: string;
  currency: string;
  submission_window_days: number;
  allowed_providers: string[];
  auth_required_services: string[];
  required_documents: Record<string, string>;
  max_unit_price: Record<string, number>;
  max_quantity_per_line: Record<string, number>;
}

export interface ConfigProvider {
  provider_id: string;
  display: string;
}

export type ConfigServices = Record<string, { description: string }>;

export type ConfigFile = 'rules.json' | 'policies.json' | 'providers.json' | 'services.json';

export function getConfig<T>(filename: ConfigFile, signal?: AbortSignal): Promise<T> {
  return apiFetch<T>(`/api/v1/config/${filename}`, { signal });
}
