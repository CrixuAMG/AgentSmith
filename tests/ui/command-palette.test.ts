// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import App from '@/renderer/App.vue';
import i18n from '@/renderer/i18n';
import { store } from '@/renderer/services/store';

describe('command palette', () => {
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
    store.providerDiscoveries = [];
    store.jobs = [];
    store.activeView = 'dashboard';
  });

  it('opens with Cmd/Ctrl+K and restores focus on Escape', async () => {
    const wrapper = mount(App, { global: { plugins: [i18n] }, attachTo: document.body });
    await flushPromises();
    const trigger = wrapper.find('.command-palette-trigger').element as HTMLButtonElement;
    trigger.focus();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await wrapper.vm.$nextTick();
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(document.activeElement?.getAttribute('placeholder')).toBe('Search commands');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });

  it('filters commands and activates the selected navigation action', async () => {
    const wrapper = mount(App, { global: { plugins: [i18n] }, attachTo: document.body });
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="search"]').setValue('prompt studio');
    expect(wrapper.findAll('.command-palette-item')).toHaveLength(1);
    await wrapper.find('.command-palette-item').trigger('click');
    await flushPromises();
    expect(store.activeView).toBe('prompt-studio');
    wrapper.unmount();
  });

  it('shows unavailable provider readiness and blocks execution until discovery succeeds', async () => {
    const wrapper = mount(App, { global: { plugins: [i18n] }, attachTo: document.body });
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.command-palette-status').text()).toContain('Unavailable');
    const execute = wrapper.findAll('.command-palette-item').find((item) => item.text().includes('Run current prompt'));
    expect(execute?.attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
