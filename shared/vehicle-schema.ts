import {
  pgTable,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const vehicles = pgTable("vehicles", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id", { length: 255 }).notNull(),
  make: varchar("make", { length: 100 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  year: integer("year").notNull(),
  vin: varchar("vin", { length: 17 }),
  licensePlate: varchar("license_plate", { length: 20 }),
  color: varchar("color", { length: 50 }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  assignedTechId: varchar("assigned_tech_id", { length: 255 }),
  currentMileage: integer("current_mileage").notNull().default(0),
  insuranceExpiresAt: timestamp("insurance_expires_at"),
  registrationExpiresAt: timestamp("registration_expires_at"),
  pendingAlertCount: integer("pending_alert_count").notNull().default(0),
  estimatedCostPerMile: decimal("estimated_cost_per_mile", { precision: 8, scale: 4 }),
  notes: text("notes"),
  statusChangedAt1: timestamp("status_changed_at_1"),
  statusChangedAt2: timestamp("status_changed_at_2"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const vehicleOdometerLogs = pgTable("vehicle_odometer_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id", { length: 255 }).notNull(),
  companyId: varchar("company_id", { length: 255 }).notNull(),
  odometer: integer("odometer").notNull(),
  readingDate: date("reading_date").notNull(),
  source: varchar("source", { length: 20 }).notNull().default("manual"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vehicleMaintenanceLogs = pgTable("vehicle_maintenance_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id", { length: 255 }).notNull(),
  companyId: varchar("company_id", { length: 255 }).notNull(),
  maintenanceType: varchar("maintenance_type", { length: 100 }).notNull(),
  performedDate: date("performed_date").notNull(),
  mileageAtService: integer("mileage_at_service"),
  nextDueDate: date("next_due_date"),
  nextDueMiles: integer("next_due_miles"),
  cost: decimal("cost", { precision: 10, scale: 2 }),
  provider: varchar("provider", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const vehicleFuelLogs = pgTable("vehicle_fuel_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id", { length: 255 }).notNull(),
  companyId: varchar("company_id", { length: 255 }).notNull(),
  fuelDate: date("fuel_date").notNull(),
  gallons: decimal("gallons", { precision: 8, scale: 3 }).notNull(),
  pricePerGallon: decimal("price_per_gallon", { precision: 8, scale: 3 }),
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }),
  odometer: integer("odometer"),
  isFullFillup: boolean("is_full_fillup").notNull().default(true),
  stationName: varchar("station_name", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vehicleRepairLogs = pgTable("vehicle_repair_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id", { length: 255 }).notNull(),
  companyId: varchar("company_id", { length: 255 }).notNull(),
  description: text("description").notNull(),
  performedDate: date("performed_date").notNull(),
  mileageAtRepair: integer("mileage_at_repair"),
  laborCost: decimal("labor_cost", { precision: 10, scale: 2 }),
  partsCost: decimal("parts_cost", { precision: 10, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }),
  provider: varchar("provider", { length: 255 }),
  isDowntime: boolean("is_downtime").notNull().default(false),
  downtimeDays: integer("downtime_days"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const vehicleDocuments = pgTable("vehicle_documents", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id", { length: 255 }).notNull(),
  companyId: varchar("company_id", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  documentType: varchar("document_type", { length: 50 }).notNull().default("other"),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  pendingAlertCount: true,
});

export const insertOdometerLogSchema = createInsertSchema(vehicleOdometerLogs).omit({
  id: true,
  createdAt: true,
});

export const insertMaintenanceLogSchema = createInsertSchema(vehicleMaintenanceLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFuelLogSchema = createInsertSchema(vehicleFuelLogs).omit({
  id: true,
  createdAt: true,
});

export const insertRepairLogSchema = createInsertSchema(vehicleRepairLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVehicleDocumentSchema = createInsertSchema(vehicleDocuments).omit({
  id: true,
  createdAt: true,
});

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type VehicleOdometerLog = typeof vehicleOdometerLogs.$inferSelect;
export type InsertOdometerLog = z.infer<typeof insertOdometerLogSchema>;
export type VehicleMaintenanceLog = typeof vehicleMaintenanceLogs.$inferSelect;
export type InsertMaintenanceLog = z.infer<typeof insertMaintenanceLogSchema>;
export type VehicleFuelLog = typeof vehicleFuelLogs.$inferSelect;
export type InsertFuelLog = z.infer<typeof insertFuelLogSchema>;
export type VehicleRepairLog = typeof vehicleRepairLogs.$inferSelect;
export type InsertRepairLog = z.infer<typeof insertRepairLogSchema>;
export type VehicleDocument = typeof vehicleDocuments.$inferSelect;
export type InsertVehicleDocument = z.infer<typeof insertVehicleDocumentSchema>;
