import type { AgentSmithApi } from '@/shared/types';

declare global {
  interface Window {
    agentSmith?: AgentSmithApi;
  }
}

export {};
