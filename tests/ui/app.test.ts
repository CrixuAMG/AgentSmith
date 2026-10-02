// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '@/renderer/App.vue';
import i18n from '@/renderer/i18n';
import { store } from '@/renderer/services/store';

describe('application shell', () => {
  const memoryStorage = {
    data: new Map<string, string>(),
    getItem(key: string) { return this.data.get(key) ?? null; },
    setItem(key: string, value: string) { this.data.set(key, value); },
    removeItem(key: string) { this.data.delete(key); },
    clear() { this.data.clear(); },
  };

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true });
    Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true });
    memoryStorage.clear();
    store.snapshot = null;
    store.activeView = 'dashboard';
  });

  it('loads the dashboard and switches to the project workspace', async () => {
    const wrapper = mount(App, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.text()).toContain('Your development command center.');
    await wrapper.findAll('button.nav-item')[1].trigger('click');
    expect(wrapper.text()).toContain('Inspect the codebase before you change it.');
  });
});
