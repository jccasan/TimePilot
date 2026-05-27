import { db } from "../db";
import { jobLocks } from "@shared/schema";
import { and, eq, lt } from "drizzle-orm";

/**
 * Attempts to acquire a distributed job lock using INSERT … ON CONFLICT DO NOTHING.
 * Ownership is determined deterministically: the insert either returns the new row
 * (we own the lock) or returns nothing (another instance holds it).
 *
 * Any instance that cannot acquire the lock should skip the job run rather than
 * double-executing.
 *
 * @param jobName    Unique name for the job (primary key).
 * @param ttlSeconds How long the lock is considered valid. Use just under the job
 *                   interval so a crashed process releases the lock before the next
 *                   scheduled run rather than blocking it indefinitely.
 * @returns true if the lock was acquired, false if another instance already holds it.
 */
export async function acquireJobLock(jobName: string, ttlSeconds: number): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlSeconds * 1000);

  try {
    // Delete any expired lock for this job name so a crashed instance can be
    // superseded without waiting the full TTL.
    await db
      .delete(jobLocks)
      .where(and(eq(jobLocks.jobName, jobName), lt(jobLocks.lockedUntil, now)));
  } catch {
    // Non-fatal — if the delete fails the insert below will conflict and we skip.
  }

  try {
    // INSERT … ON CONFLICT DO NOTHING: returns the inserted row only when we win
    // the race (i.e. no other instance holds the lock).  An empty result means
    // another instance already owns it.
    const inserted = await db
      .insert(jobLocks)
      .values({ jobName, lockedAt: now, lockedUntil })
      .onConflictDoNothing()
      .returning({ jobName: jobLocks.jobName });

    return inserted.length > 0;
  } catch (err) {
    console.error(`[job-lock] Failed to acquire lock for "${jobName}":`, err);
    return false;
  }
}

/**
 * Releases the distributed lock for a named job so the next instance or interval
 * can acquire it immediately rather than waiting for TTL expiry.
 */
export async function releaseJobLock(jobName: string): Promise<void> {
  try {
    await db.delete(jobLocks).where(eq(jobLocks.jobName, jobName));
  } catch (err) {
    console.error(`[job-lock] Failed to release lock for "${jobName}":`, err);
  }
}
