import { APP_BASE_HREF } from '@angular/common';
import { Inject, Injectable, Optional } from '@angular/core';
import type { Movie } from '../models/movie';

const DB_PATH = 'assets/scrapgd.db';
const CATALOG_VIEW = 'v_movies_catalog';
const INDEXED_DB_NAME = 'ViewpgdStorage';
const INDEXED_DB_STORE = 'data';
const PERSISTED_DB_KEY = 'custom-db';

@Injectable({ providedIn: 'root' })
export class DbService {
  private initSqlJs: typeof import('sql.js').default | null = null;
  /** Buffer de la BD cargada por el usuario; null = usar la BD por defecto (assets). */
  private customDbBuffer: ArrayBuffer | null = null;

  constructor(@Optional() @Inject(APP_BASE_HREF) private baseHref: string | null) {}

  /** Indica si se está usando una base de datos cargada por el usuario. */
  hasCustomDb(): boolean {
    return this.customDbBuffer != null;
  }

  /** Carga sql.js de forma dinámica para evitar problemas con el bundler. */
  private async loadSqlJs(): Promise<typeof import('sql.js').default> {
    if (this.initSqlJs) return this.initSqlJs;
    const mod = await import('sql.js');
    this.initSqlJs = mod.default;
    return this.initSqlJs;
  }

  private openIndexedDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(INDEXED_DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        (e.target as IDBOpenDBRequest).result.createObjectStore(INDEXED_DB_STORE, { keyPath: 'key' });
      };
    });
  }

  /** Guarda el buffer de la BD en IndexedDB (persistencia local). */
  async savePersistedDb(buffer: ArrayBuffer): Promise<void> {
    const db = await this.openIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEXED_DB_STORE, 'readwrite');
      const store = tx.objectStore(INDEXED_DB_STORE);
      const request = store.put({ key: PERSISTED_DB_KEY, buffer });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
      tx.oncomplete = () => db.close();
    });
  }

  /** Carga la BD guardada desde IndexedDB. Devuelve true si había una guardada. */
  async loadPersistedDb(): Promise<boolean> {
    const db = await this.openIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEXED_DB_STORE, 'readonly');
      const request = tx.objectStore(INDEXED_DB_STORE).get(PERSISTED_DB_KEY);
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => {
        db.close();
        const row = request.result as { buffer: ArrayBuffer } | undefined;
        if (row?.buffer) {
          this.customDbBuffer = row.buffer;
          resolve(true);
        } else {
          resolve(false);
        }
      };
    });
  }

  /** Borra la BD guardada en IndexedDB. */
  async clearPersistedDb(): Promise<void> {
    const db = await this.openIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(INDEXED_DB_STORE, 'readwrite');
      const request = tx.objectStore(INDEXED_DB_STORE).delete(PERSISTED_DB_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
      tx.oncomplete = () => db.close();
    });
  }

  /** Usa la base de datos por defecto (assets) en la próxima lectura y borra la guardada. */
  useDefaultDb(): void {
    this.customDbBuffer = null;
    this.clearPersistedDb().catch(() => {});
  }

  /** Carga una base de datos desde un archivo elegido por el usuario y la guarda en IndexedDB. */
  async loadCustomDb(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    this.customDbBuffer = buffer;
    await this.savePersistedDb(buffer);
  }

  /** Lee la vista v_movies_catalog y devuelve los registros como Movie[]. Usa BD por defecto o la cargada por el usuario. */
  async getMovies(): Promise<Movie[]> {
    const initSqlJs = await this.loadSqlJs();
    const baseRaw = this.baseHref ?? '/';
    const base = baseRaw.endsWith('/') ? baseRaw : baseRaw + '/';
    const baseUrl = typeof location !== 'undefined' ? new URL(base, location.origin).href : base;
    const SQL = await initSqlJs({
      locateFile: (file: string) => `${baseUrl}${file}`,
    });

    let buffer: ArrayBuffer;
    if (this.customDbBuffer) {
      buffer = this.customDbBuffer;
    } else {
      const response = await fetch(DB_PATH);
      if (!response.ok) throw new Error(`No se pudo cargar la base de datos: ${response.status}`);
      buffer = await response.arrayBuffer();
    }

    const db = new SQL.Database(new Uint8Array(buffer));
    const result = db.exec(`SELECT * FROM ${CATALOG_VIEW}`);
    db.close();

    if (!result.length || !result[0].values.length) return [];

    const { columns, values } = result[0];
    return values.map((row: (string | number | null)[], index: number) =>
      this.rowToMovie(columns, row, index)
    );
  }

  /** Mapea una fila de v_movies_catalog (name, year, quality, url, fuente, preview) a Movie. */
  private rowToMovie(
    columns: string[],
    row: (string | number | null)[],
    index: number
  ): Movie {
    const raw: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      raw[col] = row[i];
    });
    const name = String(raw['name'] ?? '');
    const year = Number(raw['year'] ?? 0);
    return {
      id: String(raw['id'] ?? `movie-${index}`),
      title: name,
      year,
      quality: String(raw['quality'] ?? ''),
      poster: raw['poster_url'] != null ? String(raw['poster_url']) : raw['poster'] != null ? String(raw['poster']) : undefined,
      videoUrl: String(raw['preview'] ?? ''),
    };
  }
}
