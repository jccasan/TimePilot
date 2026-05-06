import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for routificOptimize in server/services/routific.ts.
 *
 * The routific npm client is mocked so no real HTTP calls are made.
 * haversineDistance is mocked to return a fixed value so distance assertions
 * remain deterministic regardless of coordinate changes.
 */

const mockRoute = vi.fn();

vi.mock("routific", () => {
  function MockClient() {
    return { route: mockRoute };
  }
  function MockVrp() {
    return {
      addVisit: vi.fn(),
      addVehicle: vi.fn(),
      addOption: vi.fn(),
    };
  }
  return {
    default: {
      Client: MockClient,
      Vrp: MockVrp,
    },
  };
});

vi.mock("../server/services/route-optimizer", () => ({
  haversineDistance: vi.fn(() => 1.5),
}));

import { routificOptimize } from "../server/services/routific";

const THREE_STOPS = [
  { id: "alpha", latitude: 40.0, longitude: -80.0 },
  { id: "beta", latitude: 40.1, longitude: -80.1 },
  { id: "gamma", latitude: 40.2, longitude: -80.2 },
];

const GOOD_SOLUTION = {
  jobId: "job-123",
  solution: {
    routes: {
      vehicle_1: {
        visits: [
          { location_id: "beta", arrival_time: "08:20" },
          { location_id: "alpha", arrival_time: "08:45" },
          { location_id: "gamma", arrival_time: "09:15" },
        ],
      },
    },
  },
};

describe("routificOptimize", () => {
  const originalToken = process.env.ROUTIFIC_API_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.ROUTIFIC_API_TOKEN;
    } else {
      process.env.ROUTIFIC_API_TOKEN = originalToken;
    }
  });

  it("returns null when ROUTIFIC_API_TOKEN is not set", async () => {
    delete process.env.ROUTIFIC_API_TOKEN;
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("returns null and does not throw when the API call throws", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockRejectedValueOnce(new Error("503 Service Unavailable"));
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
  });

  it("returns null when the solution routes are missing entirely", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockResolvedValueOnce({
      jobId: "job-bad",
      solution: {},
    });
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
  });

  it("returns null when the solution visits do not cover all input stops", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockResolvedValueOnce({
      jobId: "job-partial",
      solution: {
        routes: {
          vehicle_1: {
            visits: [
              { location_id: "alpha" },
              // beta and gamma are missing
            ],
          },
        },
      },
    });
    const result = await routificOptimize(THREE_STOPS);
    expect(result).toBeNull();
  });

  it("returns null for a single stop without calling the API", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    const result = await routificOptimize([THREE_STOPS[0]]);
    expect(result).toBeNull();
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it("returns ordered stop IDs matching the solution on success", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockResolvedValueOnce(GOOD_SOLUTION);
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    expect(result!.orderedIds).toEqual(["beta", "alpha", "gamma"]);
  });

  it("returns a positive totalDistance on success", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockResolvedValueOnce(GOOD_SOLUTION);
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    expect(result!.totalDistance).toBeGreaterThan(0);
  });

  it("derives totalDuration from the last visit arrival_time when present", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockResolvedValueOnce(GOOD_SOLUTION);
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    // Last visit is 09:15 → (9-8)*60+15 = 75 minutes
    expect(result!.totalDuration).toBe(75);
  });

  it("falls back to speed-estimate duration when arrival_time is absent", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockResolvedValueOnce({
      jobId: "job-no-time",
      solution: {
        routes: {
          vehicle_1: {
            visits: [{ location_id: "beta" }, { location_id: "alpha" }, { location_id: "gamma" }],
          },
        },
      },
    });
    const result = await routificOptimize(THREE_STOPS);
    expect(result).not.toBeNull();
    // haversineDistance is mocked to 1.5 mi per segment; 3 stops = 2 legs = 3 mi
    // speed estimate: (3 / 25) * 60 = 7.2 min
    expect(result!.totalDuration).toBeCloseTo(7.2, 1);
  });

  it("includes a startPoint leg in the distance calculation when provided", async () => {
    process.env.ROUTIFIC_API_TOKEN = "test-token";
    mockRoute.mockResolvedValueOnce(GOOD_SOLUTION);
    const start = { latitude: 39.9, longitude: -80.0 };
    const result = await routificOptimize(THREE_STOPS, start);
    expect(result).not.toBeNull();
    // haversineDistance returns 1.5 per call; start + 3 stops = 3 legs = 4.5 mi
    expect(result!.totalDistance).toBeCloseTo(4.5, 1);
  });
});
