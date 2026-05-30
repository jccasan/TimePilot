export { VehicleRepository } from "./VehicleRepository";
export { TimecardRepository, getPeriodBoundaries } from "./TimecardRepository";

import { TimecardRepository } from "./TimecardRepository";
export const timecardRepo = new TimecardRepository();
