import type {
  AgentExecutionRequest,
  ExecutionConfiguration,
  Model,
  ModelVariant,
  ProviderCapabilities,
  ProviderInstallation,
} from './types';

/** Shell-independent contract implemented by each provider adapter. */
export interface AIProviderAdapter {
  id: string;
  name: string;
  detectInstallation(): Promise<ProviderInstallation>;
  getAvailableModels(): Promise<Model[]>;
  getModelVariants(modelId: string): Promise<ModelVariant[]>;
  getCapabilities(): ProviderCapabilities;
  buildExecutionCommand(request: AgentExecutionRequest): Promise<ExecutionConfiguration>;
}
