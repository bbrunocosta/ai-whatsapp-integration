import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import * as dotenv from 'dotenv'
dotenv.config()

const db = await open({
  filename: './chat_history.db',
  driver: sqlite3.Database
});


await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    messageId TEXT,
    chatId TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    role TEXT CHECK(role IN ('user', 'assistant')), 
    isReplied INTEGER DEFAULT 0
  );
`);

await db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    chatId TEXT PRIMARY KEY,
    amountSpent REAL
  );
`);

export async function getUsage(chatId) {
  const result = await db.get(
    `SELECT amountSpent FROM usage
     WHERE chatId = ?`,
    [chatId]
  );
  return result ? result.amountSpent : 0;
}

export async function addUsage(chatId, amountSpent) {
  const result = await db.get(
    `INSERT INTO usage (chatId, amountSpent)
     VALUES (?, ?)
     ON CONFLICT(chatId) DO UPDATE 
     SET amountSpent = amountSpent + ? 
     RETURNING amountSpent`,
    [chatId, amountSpent, amountSpent]
  );
  return result;
}


export async function saveMessage({ messageId, chatId, content, role, isReplied }) {
  const result = await db.run(
    `INSERT INTO messages (messageId, chatId, content, role, isReplied)
     SELECT ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM messages WHERE messageId = ?)`,
    [messageId, chatId, content, role, isReplied, messageId] // messageId is passed twice
  );

  return result.changes > 0
}



export async function getChatHistory(chatId) {
  const result = await db.all(
    `
      SELECT 
        JSON_GROUP_ARRAY(JSON_OBJECT('role', role, 'content', content ))
        FILTER (WHERE isReplied = 1) AS replied,

        JSON_GROUP_ARRAY(JSON_OBJECT('role', role, 'content', content )) 
        FILTER (WHERE isReplied = 0) AS notReplied
      FROM messages
      WHERE chatId = ?;
    `
    ,[chatId]
  );

  return {
    replied: JSON.parse(result[0].replied || '[]'),
    notReplied: JSON.parse(result[0].notReplied || '[]')
  };
}

export async function getLastMessage(chatId) {
  const result = await db.all(
    `SELECT * FROM messages 
     WHERE chatId = ?
     ORDER BY timestamp DESC
     LIMIT 1`
    ,[chatId]
  );
  console.log(result)
  return result[0];
}

export async function markMessagesAsReplied(chatId) {
  await db.run(
    `UPDATE messages 
     SET isReplied = 1 
     WHERE isReplied = 0 AND chatId = ? `,
     [chatId]
  );
}


