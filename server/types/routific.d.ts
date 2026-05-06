declare module "routific" {
  interface VisitLocation {
    name?: string;
    lat: number;
    lng: number;
  }

  interface Visit {
    location: VisitLocation;
    duration?: number;
    [key: string]: unknown;
  }

  interface VehicleStartLocation {
    id: string;
    lat: number;
    lng: number;
  }

  interface Vehicle {
    start_location?: VehicleStartLocation;
    end_location?: VehicleStartLocation;
    [key: string]: unknown;
  }

  class Vrp {
    static routingShortEndpoint: string;
    static routingLongEndpoint: string;
    data: {
      visits: Record<string, Visit>;
      fleet: Record<string, Vehicle>;
      options: Record<string, unknown>;
    };
    addVisit(id: string, visit: Visit): void;
    addVehicle(id: string, vehicle: Vehicle): void;
    addOption(id: string, option: unknown): void;
  }

  class Pdp {
    static routingShortEndpoint: string;
    static routingLongEndpoint: string;
    addVisit(id: string, visit: unknown): void;
    addVehicle(id: string, vehicle: unknown): void;
    addOption(id: string, option: unknown): void;
  }

  interface RouteVisit {
    location_id?: string;
    arrival_time?: string;
    finish_time?: string;
    [key: string]: unknown;
  }

  interface VehicleRoute {
    visits?: RouteVisit[];
    [key: string]: unknown;
  }

  interface RoutificSolution {
    routes: Record<string, VehicleRoute>;
    total_travel_time?: number;
    total_idle_time?: number;
    num_unserved?: number;
    unserved?: Record<string, unknown>;
    [key: string]: unknown;
  }

  interface RouteResult {
    jobId: string;
    solution: RoutificSolution;
  }

  interface ClientInstance {
    token?: string;
    url: string;
    version: number;
    pollDelay: number;
    login(
      email: string,
      password: string,
      cb?: (err: Error | null, body: unknown) => void
    ): Promise<unknown>;
    route(
      problem: Vrp | Pdp,
      cb?: (err: Error | null, solution: RoutificSolution, jobId: string) => void
    ): Promise<RouteResult>;
    job(jobId: string, cb?: (err: Error | null, result: unknown) => void): Promise<unknown>;
    jobPoll(jobId: string, cb?: (err: Error | null, result: unknown) => void): Promise<unknown>;
  }

  interface RoutificModule {
    Client: new (config: {
      token?: string;
      url?: string;
      version?: number;
      pollDelay?: number;
    }) => ClientInstance;
    Vrp: typeof Vrp;
    Pdp: typeof Pdp;
  }

  const routific: RoutificModule;
  export default routific;
}
