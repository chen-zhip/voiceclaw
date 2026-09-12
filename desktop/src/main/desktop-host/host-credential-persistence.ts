import type { HostCredentialPersistence } from './host-transport.js'

type CredentialDatabase = {
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...parameters: unknown[]): unknown
    run(...parameters: unknown[]): unknown
  }
}

export class SqliteHostCredentialPersistence implements HostCredentialPersistence {
  constructor(private readonly getDatabase: () => CredentialDatabase) {}

  async write(hostId: string, encryptedCredential: Buffer): Promise<void> {
    this.#database()
      .prepare(
        'INSERT OR REPLACE INTO desktop_host_credentials (slot, host_id, credential_enc) VALUES (?, ?, ?)'
      )
      .run('remote', hostId, encryptedCredential)
  }

  async read(): Promise<{ hostId: string; encryptedCredential: Buffer } | null> {
    const row = this.#database()
      .prepare('SELECT host_id, credential_enc FROM desktop_host_credentials WHERE slot = ?')
      .get('remote') as { host_id: string; credential_enc: Buffer } | undefined
    return row ? { hostId: row.host_id, encryptedCredential: row.credential_enc } : null
  }

  async clear(): Promise<void> {
    this.#database().prepare('DELETE FROM desktop_host_credentials WHERE slot = ?').run('remote')
  }

  #database(): CredentialDatabase {
    const database = this.getDatabase()
    database.exec(
      'CREATE TABLE IF NOT EXISTS desktop_host_credentials (slot TEXT PRIMARY KEY, host_id TEXT NOT NULL, credential_enc BLOB NOT NULL)'
    )
    return database
  }
}
