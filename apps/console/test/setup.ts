import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

import { setSelectedWorkspaceId } from "../src/client/lib/workspace-selection";

beforeEach(() => {
  setSelectedWorkspaceId("ws-1");
});
