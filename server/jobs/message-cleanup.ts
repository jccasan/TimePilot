import { db } from "../db";
import { eq, and, lt, inArray } from "drizzle-orm";
import { companies, messages, messageAttachments, smsMessages } from "@shared/schema";

export async function runMessageCleanup() {
  const startTime = Date.now();
  console.log("[MessageCleanup] Starting daily message retention cleanup...");

  try {
    const allCompanies = await db.select({
      id: companies.id,
      name: companies.name,
      messageRetentionDays: companies.messageRetentionDays,
    }).from(companies);

    let totalMessagesDeleted = 0;
    let totalAttachmentsDeleted = 0;
    let totalSmsRecordsDeleted = 0;
    let totalStorageBytesReclaimed = 0;
    let companiesProcessed = 0;

    for (const company of allCompanies) {
      const retentionDays = company.messageRetentionDays ?? 30;
      if (retentionDays <= 0) continue;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      try {
        const expiredMessages = await db.select({
          id: messages.id,
        }).from(messages).where(
          and(
            eq(messages.companyId, company.id),
            lt(messages.createdAt, cutoffDate)
          )
        );

        if (expiredMessages.length === 0) {
          const smsResult = await db.delete(smsMessages).where(
            and(
              eq(smsMessages.companyId, company.id),
              lt(smsMessages.createdAt, cutoffDate)
            )
          ).returning({ id: smsMessages.id });
          totalSmsRecordsDeleted += smsResult.length;
          continue;
        }

        const expiredIds = expiredMessages.map(m => m.id);

        const BATCH_SIZE = 500;
        const attachments: { id: number; storageUrl: string; compressedSizeBytes: number | null }[] = [];
        for (let i = 0; i < expiredIds.length; i += BATCH_SIZE) {
          const batch = expiredIds.slice(i, i + BATCH_SIZE);
          const batchAttachments = await db.select({
            id: messageAttachments.id,
            storageUrl: messageAttachments.storageUrl,
            compressedSizeBytes: messageAttachments.compressedSizeBytes,
          }).from(messageAttachments).where(
            and(
              eq(messageAttachments.companyId, company.id),
              inArray(messageAttachments.messageId, batch)
            )
          );
          attachments.push(...batchAttachments);
        }

        if (attachments.length > 0) {
          try {
            const { ObjectStorageService } = await import("../replit_integrations/object_storage/objectStorage");
            const objStorage = new ObjectStorageService();

            for (const att of attachments) {
              try {
                const file = await objStorage.getObjectEntityFile(att.storageUrl);
                await file.delete();
                totalStorageBytesReclaimed += att.compressedSizeBytes ?? 0;
              } catch (err) {
                console.warn(`[MessageCleanup] Failed to delete object storage file ${att.storageUrl}:`, (err as Error).message);
              }
            }
          } catch (err) {
            console.warn("[MessageCleanup] Object storage unavailable, skipping file deletion:", (err as Error).message);
          }

          const attIds = attachments.map(a => a.id);
          for (let i = 0; i < attIds.length; i += BATCH_SIZE) {
            const batch = attIds.slice(i, i + BATCH_SIZE);
            await db.delete(messageAttachments).where(inArray(messageAttachments.id, batch));
          }
          totalAttachmentsDeleted += attachments.length;
        }

        for (let i = 0; i < expiredIds.length; i += BATCH_SIZE) {
          const batch = expiredIds.slice(i, i + BATCH_SIZE);
          await db.delete(messages).where(and(inArray(messages.id, batch), eq(messages.companyId, company.id)));
        }
        totalMessagesDeleted += expiredIds.length;

        const smsResult = await db.delete(smsMessages).where(
          and(
            eq(smsMessages.companyId, company.id),
            lt(smsMessages.createdAt, cutoffDate)
          )
        ).returning({ id: smsMessages.id });
        totalSmsRecordsDeleted += smsResult.length;

        companiesProcessed++;
      } catch (err) {
        console.error(`[MessageCleanup] Error processing company ${company.name} (${company.id}):`, err);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const storageMB = (totalStorageBytesReclaimed / (1024 * 1024)).toFixed(2);

    console.log(`[MessageCleanup] Completed in ${elapsed}s`);
    console.log(`[MessageCleanup]   Companies processed: ${companiesProcessed}/${allCompanies.length}`);
    console.log(`[MessageCleanup]   Messages deleted: ${totalMessagesDeleted}`);
    console.log(`[MessageCleanup]   Attachments deleted: ${totalAttachmentsDeleted}`);
    console.log(`[MessageCleanup]   SMS records deleted: ${totalSmsRecordsDeleted}`);
    console.log(`[MessageCleanup]   Storage reclaimed: ~${storageMB} MB`);

    return {
      companiesProcessed,
      messagesDeleted: totalMessagesDeleted,
      attachmentsDeleted: totalAttachmentsDeleted,
      smsRecordsDeleted: totalSmsRecordsDeleted,
      storageBytesReclaimed: totalStorageBytesReclaimed,
      elapsedSeconds: parseFloat(elapsed),
    };
  } catch (err) {
    console.error("[MessageCleanup] Fatal error during cleanup:", err);
    throw err;
  }
}
