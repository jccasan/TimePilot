import { db } from "../../db";
import { sql } from "drizzle-orm";

export interface IChatStorage {
  getConversation(id: number): Promise<any>;
  getAllConversations(): Promise<any[]>;
  createConversation(title: string): Promise<any>;
  deleteConversation(id: number): Promise<void>;
  getMessagesByConversation(conversationId: number): Promise<any[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<any>;
}

export const chatStorage: IChatStorage = {
  async getConversation(id: number) {
    const result = await db.execute(sql`SELECT * FROM conversations WHERE id = ${id} LIMIT 1`);
    return result.rows[0];
  },

  async getAllConversations() {
    const result = await db.execute(sql`SELECT * FROM conversations ORDER BY created_at DESC`);
    return result.rows as any[];
  },

  async createConversation(title: string) {
    const result = await db.execute(sql`INSERT INTO conversations (title) VALUES (${title}) RETURNING *`);
    return result.rows[0];
  },

  async deleteConversation(id: number) {
    await db.execute(sql`DELETE FROM messages WHERE conversation_id = ${id}`);
    await db.execute(sql`DELETE FROM conversations WHERE id = ${id}`);
  },

  async getMessagesByConversation(conversationId: number) {
    const result = await db.execute(sql`SELECT * FROM messages WHERE conversation_id = ${conversationId} ORDER BY created_at ASC`);
    return result.rows as any[];
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const result = await db.execute(sql`INSERT INTO messages (conversation_id, role, content) VALUES (${conversationId}, ${role}, ${content}) RETURNING *`);
    return result.rows[0];
  },
};

