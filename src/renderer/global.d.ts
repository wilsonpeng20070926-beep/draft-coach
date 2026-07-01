import type { DraftCoachApi } from "../main/ipc";

declare global {
  interface Window {
    api: DraftCoachApi;
  }
}

export {};
