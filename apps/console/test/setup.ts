import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.stubGlobal(
  "matchMedia",
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);

import { setSelectedWorkspaceId } from "../src/client/lib/workspace-selection";

beforeEach(() => {
  setSelectedWorkspaceId("ws-1");
});
