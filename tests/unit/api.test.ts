import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';

import { toPlainIpcValue } from '@/renderer/services/api';

describe('IPC payload normalization', () => {
  it('removes Vue reactive proxies from nested project payloads', () => {
    const reactivePayload = reactive({
      project: { id: 'project', path: '/tmp/project' },
      guardrails: { rules: [{ id: 'deny-env', enabled: true }] },
    });
    const plainPayload = toPlainIpcValue(reactivePayload);

    expect(plainPayload).toEqual(reactivePayload);
    expect(() => structuredClone(plainPayload)).not.toThrow();
  });
});
