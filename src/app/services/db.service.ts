import { APP_BASE_HREF } from '@angular/common';
import { Inject, Injectable, Optional } from '@angular/core';
import type { Movie } from '../models/movie';

const DB_PATH = 'assets/scrapgd.db';
const CATALOG_VIEW = 'v_movies_catalog';

interface SqlDbResultRow {
  columns: string[];
  values: (string | number | null)[][];
}
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

  /** Años distintos con películas, ordenados descendente (más reciente primero). */
  async getYears(): Promise<number[]> {
    const db = await this.openDb();
    try {
      const result = db.exec(
        `SELECT DISTINCT year FROM (SELECT name, year FROM ${CATALOG_VIEW} GROUP BY name, year) ORDER BY year DESC`
      );
      db.close();
      if (!result.length || !result[0].values.length) return [];
      return result[0].values.map((row) => Number(row[0])).filter((y) => !Number.isNaN(y));
    } catch {
      db.close();
      return [];
    }
  }

  /** Devuelve el total de películas (una por name+year), opcionalmente filtradas por nombre y/o año. */
  async getMoviesCount(search?: string, year?: number): Promise<number> {
    const db = await this.openDb();
    try {
      let where = '';
      if (search?.trim()) where += ` WHERE LOWER(name) LIKE '%' || LOWER('${this.escapeSql(search.trim())}') || '%'`;
      if (year != null && !Number.isNaN(year)) where += (where ? ' AND ' : ' WHERE ') + ` year = ${year}`;
      const result = db.exec(
        `SELECT COUNT(*) AS n FROM (SELECT name, year FROM ${CATALOG_VIEW}${where} GROUP BY name, year)`
      );
      db.close();
      if (!result.length || !result[0].values.length) return 0;
      return Number(result[0].values[0][0] ?? 0);
    } catch {
      db.close();
      throw new Error('Error al contar películas');
    }
  }

  /** orderBy: 'year' | 'name', order: 'asc' | 'desc'. Opcional year para filtrar por año. */
  async getMoviesPage(
    offset: number,
    limit: number,
    search?: string,
    orderBy: 'year' | 'name' = 'year',
    order: 'asc' | 'desc' = 'desc',
    year?: number
  ): Promise<Movie[]> {
    const db = await this.openDb();
    try {
      let where = '';
      if (search?.trim()) where += ` WHERE LOWER(name) LIKE '%' || LOWER('${this.escapeSql(search.trim())}') || '%'`;
      if (year != null && !Number.isNaN(year)) where += (where ? ' AND ' : ' WHERE ') + ` year = ${year}`;
      const ob = orderBy === 'name' ? 'name' : 'year';
      const dir = order === 'asc' ? 'ASC' : 'DESC';
      const result = db.exec(
        `SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY name, year ORDER BY name, year) AS rn
          FROM ${CATALOG_VIEW}${where}
        ) t WHERE rn = 1 ORDER BY ${ob} ${dir} LIMIT ${Math.max(0, limit)} OFFSET ${Math.max(0, offset)}`
      );
      db.close();
      if (!result.length || !result[0].values.length) return [];
      const { columns, values } = result[0];
      const colIdx = columns.indexOf('rn');
      const cols = colIdx >= 0 ? columns.filter((_, i) => i !== colIdx) : columns;
      return values.map((row: (string | number | null)[], index: number) => {
        const r = colIdx >= 0 ? row.filter((_, i) => i !== colIdx) : row;
        return this.rowToMovie(cols, r, offset + index);
      });
    } catch {
      db.close();
      throw new Error('Error al cargar películas');
    }
  }

  private escapeSql(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "''");
  }

  private async openDb(): Promise<{ exec: (sql: string) => SqlDbResultRow[]; close: () => void }> {
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
    return new SQL.Database(new Uint8Array(buffer));
  }

  /** Devuelve una película aleatoria del catálogo (una por name+year). */
  async getRandomMovie(): Promise<Movie | null> {
    const db = await this.openDb();
    try {
      const result = db.exec(
        `SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY name, year ORDER BY name, year) AS rn
          FROM ${CATALOG_VIEW}
        ) t WHERE rn = 1 ORDER BY RANDOM() LIMIT 1`
      );
      db.close();
      if (!result.length || !result[0].values.length) return null;
      const { columns, values } = result[0];
      const colIdx = columns.indexOf('rn');
      const cols = colIdx >= 0 ? columns.filter((_, i) => i !== colIdx) : columns;
      const row = values[0] as (string | number | null)[];
      const r = colIdx >= 0 ? row.filter((_, i) => i !== colIdx) : row;
      return this.rowToMovie(cols, r, 0);
    } catch {
      db.close();
      return null;
    }
  }

  /** Lee la vista v_movies_catalog; una fila por película (name+year), un solo link. */
  async getMovies(): Promise<Movie[]> {
    const db = await this.openDb();
    try {
      const result = db.exec(
        `SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY name, year ORDER BY name, year) AS rn
          FROM ${CATALOG_VIEW}
        ) t WHERE rn = 1 ORDER BY year DESC`
      );
      db.close();
      if (!result.length || !result[0].values.length) return [];
      const { columns, values } = result[0];
      const colIdx = columns.indexOf('rn');
      const cols = colIdx >= 0 ? columns.filter((_, i) => i !== colIdx) : columns;
      return values.map((row: (string | number | null)[], index: number) => {
        const r = colIdx >= 0 ? row.filter((_, i) => i !== colIdx) : row;
        return this.rowToMovie(cols, r, index);
      });
    } catch {
      db.close();
      throw new Error('Error al cargar películas');
    }
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
