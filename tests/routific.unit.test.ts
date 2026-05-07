import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for routificOptimize in server/services/routific.ts.
 *
 * The global fetch is mocked so no real HTTP calls are made.
 * vi.useFakeTimers() makes setTimeout instant so the 2-second poll delay
 * does not slow down the test suite.
 * haversineDistance is mocked to return a fixed value so distance assertions
 * remain deterministic regardless of coordinate changes.
 */

vi.mock("../server/services/route-optimizer", () => ({
  haversineDistance: vi.fn(() => 1.5),
}));

import {
  routificOptimize,
  resetCircuitBreaker,
  getCircuitBreakerState,
} from "../server/services/routific";

const THREE_STOPS = [
  { id: "alpha", latitude: 40.0, longitude: -80.0 },
  { id: "beta", latitude: 40.1, longitude: -80.1 },
  { id: "gamma", latitude: 40.2, longitude: -80.2 },
];

// Real Routific VRP-Long output shape:
//   solution.<vehicleId> is a direct array of visit objects (not { visits: [...] })
const GOOD_OUTPUT = {
  solution: {
    vehicle_1: [
      { location_id: "beta", arrival_time: "08:20" },
      { location_id: "alpha", arrival_time: "08:45" },
      { location_id: "gamma", arrival_time: "09:15" },
    ],
  },
  num_unserved: 0,
};

function mockFetchResponses(submitResponse: unknown, pollResponse: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/vrp-long")) {
      return {
        ok: true,
        json: async () => submitResponse,
        text: async () => "",
      } as Response;
    }
    // polling endpoint
    return {
      ok: true,
      json: async () => pollResponse,
      text: async () => "",
    } as Response;
  });
}

/** Mock fetch so submit succeeds but the network call throws. */
function mockFetchThrows(err: Error) {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
}

describe("routificOptimize", () => {
  const originalToken = process.env.ROUTIFIC_API_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCircuitBreaker();
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.ROUTIFIC_API_TOKEN;
    } else {
      process.env.ROUTIFIC_API_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns null when ROUTIFIC_API_TOKEN is not set", async () => {
    delete process.env.ROUTIFIC_API_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null for a single stop without calling the API", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await routificOptimize([THREE_STOPS[0]]);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null and does not throw when the submit call throws", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
  });

  it("returns null when the submit call returns a non-ok status", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as Response);
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
  });

  it("returns null when the solution routes are missing entirely", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockFetchResponses({ job_id: "job-bad" }, { status: "finished", output: {} });
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
  });

  it("returns null when the solution visits do not cover all input stops", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockFetchResponses(
      { job_id: "job-partial" },
      {
        status: "finished",
        output: {
          solution: {
            vehicle_1: [{ location_id: "alpha" }],
          },
          num_unserved: 0,
        },
      }
    );
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
  });

  it("returns ordered stop IDs matching the solution on success", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockFetchResponses({ job_id: "job-123" }, { status: "finished", output: GOOD_OUTPUT });
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    expect(result!.orderedIds).toEqual(["beta", "alpha", "gamma"]);
  });

  it("returns a positive totalDistance on success", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockFetchResponses({ job_id: "job-123" }, { status: "finished", output: GOOD_OUTPUT });
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    expect(result!.totalDistance).toBeGreaterThan(0);
  });

  it("derives totalDuration from the last visit arrival_time when present", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockFetchResponses({ job_id: "job-123" }, { status: "finished", output: GOOD_OUTPUT });
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    // Last visit is 09:15 → (9-8)*60+15 = 75 minutes
    expect(result!.totalDuration).toBe(75);
  });

  it("falls back to speed-estimate duration when arrival_time is absent", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockFetchResponses(
      { job_id: "job-no-time" },
      {
        status: "finished",
        output: {
          solution: {
            vehicle_1: [
              { location_id: "beta" },
              { location_id: "alpha" },
              { location_id: "gamma" },
            ],
          },
          num_unserved: 0,
        },
      }
    );
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    // haversineDistance mocked to 1.5 mi per segment; 3 stops = 2 legs = 3 mi
    // speed estimate: (3 / 25) * 60 = 7.2 min
    expect(result!.totalDuration).toBeCloseTo(7.2, 1);
  });

  it("includes a startPoint leg in the distance calculation when provided", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockFetchResponses({ job_id: "job-123" }, { status: "finished", output: GOOD_OUTPUT });
    const start = { latitude: 39.9, longitude: -80.0 };
    const result = await routificOptimize(THREE_STOPS, start);
    expect(result).not.toBeNull();
    // haversineDistance returns 1.5 per call; start + 3 stops = 3 legs = 4.5 mi
    expect(result!.totalDistance).toBeCloseTo(4.5, 1);
  });
});

// ---------------------------------------------------------------------------
// Circuit-breaker tests
// ---------------------------------------------------------------------------

describe("circuit-breaker", () => {
  const originalToken = process.env.ROUTIFIC_API_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCircuitBreaker();
    process.env.ROUTIFIC_API_TOKEN = "test-token";
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.ROUTIFIC_API_TOKEN;
    } else {
      process.env.ROUTIFIC_API_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts in closed state", () => {
    expect(getCircuitBreakerState()).toBe("closed");
  });

  it("remains closed after fewer than threshold failures", async () => {
    mockFetchThrows(new Error("timeout"));

    // Two failures — threshold is 3
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    expect(getCircuitBreakerState()).toBe("closed");
  });

  it("opens after reaching the failure threshold", async () => {
    mockFetchThrows(new Error("timeout"));

    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    expect(getCircuitBreakerState()).toBe("open");
  });

  it("skips the API call and returns null immediately when open", async () => {
    mockFetchThrows(new Error("timeout"));

    // Trip the breaker
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    expect(getCircuitBreakerState()).toBe("open");

    // Reset spy so we can count future calls cleanly
    vi.restoreAllMocks();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // This call should be skipped entirely
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("transitions to half-open after the cooldown expires", async () => {
    // Use real timers — trip the breaker with real fetch errors, then
    // manipulate Date.now to simulate the cooldown elapsing.
    mockFetchThrows(new Error("timeout"));

    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    expect(getCircuitBreakerState()).toBe("open");

    // Simulate cooldown elapsed by mocking Date.now
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 61_000);

    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 61_000);
    mockFetchResponses({ job_id: "job-probe" }, { status: "finished", output: GOOD_OUTPUT });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await routificOptimize(THREE_STOPS);

    expect(fetchSpy).toHaveBeenCalled();
  });

  it("closes the breaker when the probe request succeeds", async () => {
    mockFetchThrows(new Error("timeout"));

    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    const realNow = Date.now;
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 61_000);
    mockFetchResponses({ job_id: "job-probe" }, { status: "finished", output: GOOD_OUTPUT });
    await routificOptimize(THREE_STOPS);

    expect(getCircuitBreakerState()).toBe("closed");
  });

  it("re-opens the breaker when the probe request fails", async () => {
    mockFetchThrows(new Error("timeout"));

    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    // Simulate cooldown elapsed, but probe also fails
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(realNow() + 61_000);
    await routificOptimize(THREE_STOPS);

    expect(getCircuitBreakerState()).toBe("open");
  });

  it("resets to closed after a successful call following failures below threshold", async () => {
    mockFetchThrows(new Error("timeout"));
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    // Now succeed — breaker should stay closed and consecutive count resets
    vi.restoreAllMocks();
    mockFetchResponses({ job_id: "job-ok" }, { status: "finished", output: GOOD_OUTPUT });
    const result = await routificOptimize(THREE_STOPS);

    expect(result).not.toBeNull();
    expect(getCircuitBreakerState()).toBe("closed");
  });

  it("does not count token-missing calls against the failure threshold", async () => {
    delete process.env.ROUTIFIC_API_TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Many calls without a token — breaker must stay closed
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);
    await routificOptimize(THREE_STOPS);

    expect(getCircuitBreakerState()).toBe("closed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
