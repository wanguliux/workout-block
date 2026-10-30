import type { WebStore } from './store';

export interface UiContext {
  store: WebStore;
  refresh(): void;
}
