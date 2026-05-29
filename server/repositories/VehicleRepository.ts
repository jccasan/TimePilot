import { db } from "../db";
import { eq, and, desc, asc, isNull, lte, gte, sql } from "drizzle-orm";
import {
  vehicles,
  vehicleOdometerLogs,
  vehicleMaintenanceLogs,
  vehicleFuelLogs,
  vehicleRepairLogs,
  vehicleDocuments,
  type Vehicle,
  type InsertVehicle,
  type VehicleOdometerLog,
  type InsertOdometerLog,
  type VehicleMaintenanceLog,
  type InsertMaintenanceLog,
  type VehicleFuelLog,
  type InsertFuelLog,
  type VehicleRepairLog,
  type InsertRepairLog,
  type VehicleDocument,
  type InsertVehicleDocument,
} from "@shared/vehicle-schema";
import { objectStorageClient } from "../replit_integrations/object_storage";

async function deleteFromStorage(filePath: string): Promise<void> {
  try {
    const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!privateDir) return;
    const entityId = filePath.startsWith("/objects/")
      ? filePath.slice("/objects/".length)
      : filePath;
    let dir = privateDir;
    if (!dir.endsWith("/")) dir = dir + "/";
    const fullPath = `${dir}${entityId}`;
    if (!fullPath.startsWith("/")) return;
    const parts = fullPath.split("/");
    if (parts.length < 3) return;
    const bucketName = parts[1];
    const objectName = parts.slice(2).join("/");
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (exists) await file.delete();
  } catch (err) {
    console.warn("[VehicleRepository] deleteFromStorage error:", err);
  }
}

export class VehicleRepository {
  async listVehicles(companyId: string): Promise<Vehicle[]> {
    return db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.companyId, companyId), isNull(vehicles.deletedAt)))
      .orderBy(asc(vehicles.make), asc(vehicles.model));
  }

  async getVehicle(id: string, companyId: string): Promise<Vehicle | null> {
    const [row] = await db
      .select()
      .from(vehicles)
      .where(
        and(eq(vehicles.id, id), eq(vehicles.companyId, companyId), isNull(vehicles.deletedAt))
      );
    return row ?? null;
  }

  async createVehicle(data: InsertVehicle): Promise<Vehicle> {
    const [row] = await db.insert(vehicles).values(data).returning();
    return row;
  }

  async updateVehicle(
    id: string,
    companyId: string,
    data: Partial<InsertVehicle>
  ): Promise<Vehicle> {
    const [row] = await db
      .update(vehicles)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(vehicles.id, id), eq(vehicles.companyId, companyId)))
      .returning();
    return row;
  }

  async softDeleteVehicle(id: string, companyId: string): Promise<void> {
    await db
      .update(vehicles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(vehicles.id, id), eq(vehicles.companyId, companyId)));
  }

  async updatePendingAlertCount(id: string, count: number): Promise<void> {
    await db
      .update(vehicles)
      .set({ pendingAlertCount: count, updatedAt: new Date() })
      .where(eq(vehicles.id, id));
  }

  // ── Odometer ──────────────────────────────────────────────────────────────

  async listOdometerLogs(vehicleId: string, companyId: string): Promise<VehicleOdometerLog[]> {
    return db
      .select()
      .from(vehicleOdometerLogs)
      .where(
        and(
          eq(vehicleOdometerLogs.vehicleId, vehicleId),
          eq(vehicleOdometerLogs.companyId, companyId)
        )
      )
      .orderBy(desc(vehicleOdometerLogs.readingDate), desc(vehicleOdometerLogs.createdAt));
  }

  async createOdometerLog(data: InsertOdometerLog): Promise<VehicleOdometerLog> {
    const [row] = await db.insert(vehicleOdometerLogs).values(data).returning();
    await db
      .update(vehicles)
      .set({ currentMileage: data.odometer, updatedAt: new Date() })
      .where(and(eq(vehicles.id, data.vehicleId), eq(vehicles.companyId, data.companyId)));
    return row;
  }

  async deleteOdometerLog(id: string, companyId: string): Promise<void> {
    await db
      .delete(vehicleOdometerLogs)
      .where(and(eq(vehicleOdometerLogs.id, id), eq(vehicleOdometerLogs.companyId, companyId)));
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  async listMaintenanceLogs(
    vehicleId: string,
    companyId: string
  ): Promise<VehicleMaintenanceLog[]> {
    return db
      .select()
      .from(vehicleMaintenanceLogs)
      .where(
        and(
          eq(vehicleMaintenanceLogs.vehicleId, vehicleId),
          eq(vehicleMaintenanceLogs.companyId, companyId)
        )
      )
      .orderBy(desc(vehicleMaintenanceLogs.performedDate));
  }

  async createMaintenanceLog(data: InsertMaintenanceLog): Promise<VehicleMaintenanceLog> {
    const [row] = await db.insert(vehicleMaintenanceLogs).values(data).returning();
    return row;
  }

  async updateMaintenanceLog(
    id: string,
    companyId: string,
    data: Partial<InsertMaintenanceLog>
  ): Promise<VehicleMaintenanceLog> {
    const [row] = await db
      .update(vehicleMaintenanceLogs)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(vehicleMaintenanceLogs.id, id), eq(vehicleMaintenanceLogs.companyId, companyId))
      )
      .returning();
    return row;
  }

  async deleteMaintenanceLog(id: string, companyId: string): Promise<void> {
    await db
      .delete(vehicleMaintenanceLogs)
      .where(
        and(eq(vehicleMaintenanceLogs.id, id), eq(vehicleMaintenanceLogs.companyId, companyId))
      );
  }

  // ── Fuel ──────────────────────────────────────────────────────────────────

  calculateMPG(logs: VehicleFuelLog[]): {
    perFillup: Array<{ id: string; mpg: number | null }>;
    rollingAverage: number | null;
  } {
    const sorted = [...logs]
      .filter((l) => l.odometer !== null && l.isFullFillup)
      .sort((a, b) => a.odometer! - b.odometer!);

    const perFillup: Array<{ id: string; mpg: number | null }> = logs.map((l) => ({
      id: l.id,
      mpg: null,
    }));

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.odometer && curr.odometer && curr.gallons && parseFloat(curr.gallons) > 0) {
        const miles = curr.odometer - prev.odometer;
        const mpg = miles / parseFloat(curr.gallons);
        const entry = perFillup.find((p) => p.id === curr.id);
        if (entry) entry.mpg = Math.round(mpg * 10) / 10;
      }
    }

    const validMpgs = perFillup.map((p) => p.mpg).filter((m): m is number => m !== null);
    const rollingAverage =
      validMpgs.length > 0
        ? Math.round((validMpgs.reduce((sum, m) => sum + m, 0) / validMpgs.length) * 10) / 10
        : null;

    return { perFillup, rollingAverage };
  }

  async listFuelLogs(vehicleId: string, companyId: string): Promise<VehicleFuelLog[]> {
    return db
      .select()
      .from(vehicleFuelLogs)
      .where(
        and(eq(vehicleFuelLogs.vehicleId, vehicleId), eq(vehicleFuelLogs.companyId, companyId))
      )
      .orderBy(desc(vehicleFuelLogs.fuelDate));
  }

  async createFuelLog(data: InsertFuelLog): Promise<VehicleFuelLog> {
    const [row] = await db.insert(vehicleFuelLogs).values(data).returning();
    return row;
  }

  async updateFuelLog(
    id: string,
    companyId: string,
    data: Partial<InsertFuelLog>
  ): Promise<VehicleFuelLog> {
    const [row] = await db
      .update(vehicleFuelLogs)
      .set(data)
      .where(and(eq(vehicleFuelLogs.id, id), eq(vehicleFuelLogs.companyId, companyId)))
      .returning();
    return row;
  }

  async deleteFuelLog(id: string, companyId: string): Promise<void> {
    await db
      .delete(vehicleFuelLogs)
      .where(and(eq(vehicleFuelLogs.id, id), eq(vehicleFuelLogs.companyId, companyId)));
  }

  // ── Repairs ───────────────────────────────────────────────────────────────

  async listRepairLogs(vehicleId: string, companyId: string): Promise<VehicleRepairLog[]> {
    return db
      .select()
      .from(vehicleRepairLogs)
      .where(
        and(eq(vehicleRepairLogs.vehicleId, vehicleId), eq(vehicleRepairLogs.companyId, companyId))
      )
      .orderBy(desc(vehicleRepairLogs.performedDate));
  }

  async createRepairLog(data: InsertRepairLog): Promise<VehicleRepairLog> {
    const totalCost = String(
      (parseFloat(data.laborCost ?? "0") + parseFloat(data.partsCost ?? "0")).toFixed(2)
    );
    const [row] = await db
      .insert(vehicleRepairLogs)
      .values({ ...data, totalCost })
      .returning();
    return row;
  }

  async updateRepairLog(
    id: string,
    companyId: string,
    data: Partial<InsertRepairLog>
  ): Promise<VehicleRepairLog> {
    const laborCost = data.laborCost ?? "0";
    const partsCost = data.partsCost ?? "0";
    const totalCost = String((parseFloat(laborCost) + parseFloat(partsCost)).toFixed(2));
    const [row] = await db
      .update(vehicleRepairLogs)
      .set({ ...data, totalCost, updatedAt: new Date() })
      .where(and(eq(vehicleRepairLogs.id, id), eq(vehicleRepairLogs.companyId, companyId)))
      .returning();
    return row;
  }

  async deleteRepairLog(id: string, companyId: string): Promise<void> {
    await db
      .delete(vehicleRepairLogs)
      .where(and(eq(vehicleRepairLogs.id, id), eq(vehicleRepairLogs.companyId, companyId)));
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  async listDocuments(vehicleId: string, companyId: string): Promise<VehicleDocument[]> {
    return db
      .select()
      .from(vehicleDocuments)
      .where(
        and(eq(vehicleDocuments.vehicleId, vehicleId), eq(vehicleDocuments.companyId, companyId))
      )
      .orderBy(desc(vehicleDocuments.createdAt));
  }

  async createDocument(data: InsertVehicleDocument): Promise<VehicleDocument> {
    const [row] = await db.insert(vehicleDocuments).values(data).returning();
    return row;
  }

  async getDocument(id: string, companyId: string): Promise<VehicleDocument | null> {
    const [row] = await db
      .select()
      .from(vehicleDocuments)
      .where(and(eq(vehicleDocuments.id, id), eq(vehicleDocuments.companyId, companyId)));
    return row ?? null;
  }

  async deleteDocument(id: string, companyId: string): Promise<void> {
    const doc = await this.getDocument(id, companyId);
    if (doc?.filePath) {
      await deleteFromStorage(doc.filePath);
    }
    await db
      .delete(vehicleDocuments)
      .where(and(eq(vehicleDocuments.id, id), eq(vehicleDocuments.companyId, companyId)));
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  async getVehicleSummary(
    vehicleId: string,
    companyId: string,
    startDate?: string,
    endDate?: string
  ) {
    const fuelWhere = endDate
      ? and(
          eq(vehicleFuelLogs.vehicleId, vehicleId),
          eq(vehicleFuelLogs.companyId, companyId),
          gte(vehicleFuelLogs.fuelDate, startDate!),
          lte(vehicleFuelLogs.fuelDate, endDate)
        )
      : and(eq(vehicleFuelLogs.vehicleId, vehicleId), eq(vehicleFuelLogs.companyId, companyId));

    const maintWhere = endDate
      ? and(
          eq(vehicleMaintenanceLogs.vehicleId, vehicleId),
          eq(vehicleMaintenanceLogs.companyId, companyId),
          gte(vehicleMaintenanceLogs.performedDate, startDate!),
          lte(vehicleMaintenanceLogs.performedDate, endDate)
        )
      : and(
          eq(vehicleMaintenanceLogs.vehicleId, vehicleId),
          eq(vehicleMaintenanceLogs.companyId, companyId)
        );

    const repairWhere = endDate
      ? and(
          eq(vehicleRepairLogs.vehicleId, vehicleId),
          eq(vehicleRepairLogs.companyId, companyId),
          gte(vehicleRepairLogs.performedDate, startDate!),
          lte(vehicleRepairLogs.performedDate, endDate)
        )
      : and(eq(vehicleRepairLogs.vehicleId, vehicleId), eq(vehicleRepairLogs.companyId, companyId));

    const [fuelResult] = await db
      .select({
        totalCost: sql<string>`COALESCE(SUM(total_cost::numeric), 0)`,
        totalGallons: sql<string>`COALESCE(SUM(gallons::numeric), 0)`,
      })
      .from(vehicleFuelLogs)
      .where(fuelWhere);

    const [maintResult] = await db
      .select({ totalCost: sql<string>`COALESCE(SUM(cost::numeric), 0)` })
      .from(vehicleMaintenanceLogs)
      .where(maintWhere);

    const [repairResult] = await db
      .select({
        totalCost: sql<string>`COALESCE(SUM(total_cost::numeric), 0)`,
        totalDowntime: sql<string>`COALESCE(SUM(downtime_days), 0)`,
      })
      .from(vehicleRepairLogs)
      .where(repairWhere);

    const vehicle = await this.getVehicle(vehicleId, companyId);
    const odometerLogs = await this.listOdometerLogs(vehicleId, companyId);
    const fuelLogs = await this.listFuelLogs(vehicleId, companyId);
    const { rollingAverage: avgMpg } = this.calculateMPG(fuelLogs);

    const fuelCost = parseFloat(fuelResult?.totalCost ?? "0");
    const maintCost = parseFloat(maintResult?.totalCost ?? "0");
    const repairCost = parseFloat(repairResult?.totalCost ?? "0");
    const totalCost = fuelCost + maintCost + repairCost;

    let totalMiles = 0;
    if (odometerLogs.length >= 2) {
      const sorted = [...odometerLogs].sort((a, b) => a.odometer - b.odometer);
      totalMiles = sorted[sorted.length - 1].odometer - sorted[0].odometer;
    }

    const costPerMile = totalMiles > 0 ? totalCost / totalMiles : null;
    const downtimeDays = parseInt(repairResult?.totalDowntime ?? "0");

    return {
      vehicle,
      fuelCost,
      maintCost,
      repairCost,
      totalCost,
      totalMiles,
      costPerMile,
      avgMpg,
      downtimeDays,
      fuelPct: totalCost > 0 ? (fuelCost / totalCost) * 100 : 0,
      maintPct: totalCost > 0 ? (maintCost / totalCost) * 100 : 0,
      repairPct: totalCost > 0 ? (repairCost / totalCost) * 100 : 0,
    };
  }

  async getFleetSummary(companyId: string, startDate?: string, endDate?: string) {
    const allVehicles = await this.listVehicles(companyId);
    const summaries = await Promise.all(
      allVehicles.map((v) => this.getVehicleSummary(v.id, companyId, startDate, endDate))
    );

    const totalFuelCost = summaries.reduce((s, v) => s + v.fuelCost, 0);
    const totalMaintCost = summaries.reduce((s, v) => s + v.maintCost, 0);
    const totalRepairCost = summaries.reduce((s, v) => s + v.repairCost, 0);
    const totalCost = summaries.reduce((s, v) => s + v.totalCost, 0);
    const totalMiles = summaries.reduce((s, v) => s + v.totalMiles, 0);
    const totalDowntime = summaries.reduce((s, v) => s + v.downtimeDays, 0);

    const mpgValues = summaries.map((v) => v.avgMpg).filter((m): m is number => m !== null);
    const fleetAvgMpg =
      mpgValues.length > 0
        ? Math.round((mpgValues.reduce((s, m) => s + m, 0) / mpgValues.length) * 10) / 10
        : null;

    const costPerMile = totalMiles > 0 ? totalCost / totalMiles : null;

    return {
      vehicles: summaries,
      totalFuelCost,
      totalMaintCost,
      totalRepairCost,
      totalCost,
      totalMiles,
      totalDowntime,
      fleetAvgMpg,
      costPerMile,
      fuelPct: totalCost > 0 ? (totalFuelCost / totalCost) * 100 : 0,
      maintPct: totalCost > 0 ? (totalMaintCost / totalCost) * 100 : 0,
      repairPct: totalCost > 0 ? (totalRepairCost / totalCost) * 100 : 0,
    };
  }

  async getFleetAlerts(companyId: string) {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const thirtyDaysStr = thirtyDaysFromNow.toISOString().split("T")[0];

    const allVehicles = await this.listVehicles(companyId);
    const alerts: Array<{
      vehicleId: string;
      vehicleName: string;
      type: string;
      message: string;
      urgency: "high" | "medium" | "low";
      dueDate?: string;
    }> = [];

    for (const v of allVehicles) {
      const label = `${v.year} ${v.make} ${v.model}`;

      if (v.insuranceExpiresAt) {
        const expiryStr = v.insuranceExpiresAt.toISOString().split("T")[0];
        if (expiryStr <= thirtyDaysStr) {
          const daysLeft = Math.ceil((v.insuranceExpiresAt.getTime() - Date.now()) / 86400000);
          alerts.push({
            vehicleId: v.id,
            vehicleName: label,
            type: "insurance",
            message: `Insurance expires in ${daysLeft} days`,
            urgency: daysLeft <= 7 ? "high" : "medium",
            dueDate: expiryStr,
          });
        }
      }

      if (v.registrationExpiresAt) {
        const expiryStr = v.registrationExpiresAt.toISOString().split("T")[0];
        if (expiryStr <= thirtyDaysStr) {
          const daysLeft = Math.ceil((v.registrationExpiresAt.getTime() - Date.now()) / 86400000);
          alerts.push({
            vehicleId: v.id,
            vehicleName: label,
            type: "registration",
            message: `Registration expires in ${daysLeft} days`,
            urgency: daysLeft <= 7 ? "high" : "medium",
            dueDate: expiryStr,
          });
        }
      }

      const maintLogs = await this.listMaintenanceLogs(v.id, companyId);
      for (const m of maintLogs) {
        if (m.nextDueDate && m.nextDueDate <= thirtyDaysStr) {
          const dueDate = new Date(m.nextDueDate + "T00:00:00Z");
          const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / 86400000);
          alerts.push({
            vehicleId: v.id,
            vehicleName: label,
            type: "maintenance",
            message: `${m.maintenanceType} due in ${daysLeft} days`,
            urgency: daysLeft <= 7 ? "high" : "medium",
            dueDate: m.nextDueDate,
          });
        }
        if (m.nextDueMiles && v.currentMileage && m.nextDueMiles - v.currentMileage < 500) {
          const gap = m.nextDueMiles - v.currentMileage;
          alerts.push({
            vehicleId: v.id,
            vehicleName: label,
            type: "maintenance_miles",
            message: `${m.maintenanceType} due in ${gap} miles`,
            urgency: gap <= 0 ? "high" : "medium",
          });
        }
      }

      const docs = await this.listDocuments(v.id, companyId);
      for (const d of docs) {
        if (d.expiresAt) {
          const expiryStr = d.expiresAt.toISOString().split("T")[0];
          if (expiryStr <= thirtyDaysStr) {
            const daysLeft = Math.ceil((d.expiresAt.getTime() - Date.now()) / 86400000);
            alerts.push({
              vehicleId: v.id,
              vehicleName: label,
              type: "document",
              message: `${d.name} expires in ${daysLeft} days`,
              urgency: daysLeft <= 7 ? "high" : "medium",
              dueDate: expiryStr,
            });
          }
        }
      }
    }

    return alerts.sort((a, b) => {
      const urgencyOrder = { high: 0, medium: 1, low: 2 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
  }
}
