import { APP_BASE_HREF } from '@angular/common';
import { Inject, Injectable, Optional } from '@angular/core';
import type { Movie } from '../models/movie';

const DB_PATH = 'assets/scrapgd.db';
/** v_movies_catalog: name, year, quality, url_poster, preview. Para "Más recientes": upload_date (TEXT, formato YYYY-MM-DD HH:MM:SS). Opcional: file_size (si falta o es 'fail' no se muestra la película). */
const CATALOG_VIEW = 'v_movies_catalog';
const FILE_SIZE_FILTER = ` file_size IS NOT NULL
  AND LENGTH(TRIM(CAST(file_size AS TEXT))) > 0
  AND LOWER(TRIM(CAST(file_size AS TEXT))) NOT IN ('fail', 'null', 'none', 'n/a', 'na')`;

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
        `SELECT DISTINCT year FROM (SELECT name, year FROM ${CATALOG_VIEW} WHERE${FILE_SIZE_FILTER} GROUP BY name, year) ORDER BY year DESC`
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
      let where = FILE_SIZE_FILTER;
      if (search?.trim()) where += ` AND LOWER(name) LIKE '%' || LOWER('${this.escapeSql(search.trim())}') || '%'`;
      if (year != null && !Number.isNaN(year)) where += ` AND year = ${year}`;
      const result = db.exec(
        `SELECT COUNT(*) AS n FROM (SELECT name, year FROM ${CATALOG_VIEW} WHERE${where} GROUP BY name, year)`
      );
      db.close();
      if (!result.length || !result[0].values.length) return 0;
      return Number(result[0].values[0][0] ?? 0);
    } catch {
      db.close();
      throw new Error('Error al contar películas');
    }
  }

  /** orderBy: 'year' | 'name' | 'upload_date', order: 'asc' | 'desc'. Opcional year para filtrar por año. */
  async getMoviesPage(
    offset: number,
    limit: number,
    search?: string,
    orderBy: 'year' | 'name' | 'upload_date' = 'year',
    order: 'asc' | 'desc' = 'desc',
    year?: number
  ): Promise<Movie[]> {
    const db = await this.openDb();
    try {
      let where = FILE_SIZE_FILTER;
      if (search?.trim()) where += ` AND LOWER(name) LIKE '%' || LOWER('${this.escapeSql(search.trim())}') || '%'`;
      if (year != null && !Number.isNaN(year)) where += ` AND year = ${year}`;
      const ob = orderBy === 'name' ? 'name' : orderBy === 'upload_date' ? 'upload_date' : 'year';
      const dir = order === 'asc' ? 'ASC' : 'DESC';
      const result = db.exec(
        `SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY name, year ORDER BY upload_date DESC NULLS LAST, name, year) AS rn
          FROM ${CATALOG_VIEW} WHERE${where}
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

  /** Devuelve todos los preview (GD) para una película por nombre y año. */
  async getPreviewOptionsForMovie(name: string, year: number | string): Promise<string[]> {
    const db = await this.openDb();
    try {
      const yearVal = typeof year === 'string' ? year : String(year);
      const result = db.exec(
        `SELECT preview FROM ${CATALOG_VIEW} WHERE${FILE_SIZE_FILTER} AND name = '${this.escapeSql(name)}' AND year = '${this.escapeSql(yearVal)}'`
      );
      db.close();
      if (!result.length || !result[0].values.length) return [];
      return result[0].values
        .map((row) => row[0])
        .filter((v): v is string => v != null && v !== '')
        .map(String);
    } catch {
      db.close();
      return [];
    }
  }

  /** Devuelve links de descarga para una película (name+year), 1:1 con filas/preview cuando sea posible. */
  async getDownloadOptionsForMovie(name: string, year: number | string): Promise<string[]> {
    const db = await this.openDb();
    try {
      const yearVal = typeof year === 'string' ? year : String(year);
      const result = db.exec(
        `SELECT download_url, preview FROM ${CATALOG_VIEW} WHERE${FILE_SIZE_FILTER} AND name = '${this.escapeSql(name)}' AND year = '${this.escapeSql(yearVal)}'`
      );
      db.close();
      if (!result.length || !result[0].values.length) return [];
      const { columns, values } = result[0];
      const dlIdx = columns.indexOf('download_url');
      const pvIdx = columns.indexOf('preview');
      const all: string[] = [];
      for (const row of values) {
        const dl = dlIdx >= 0 ? row[dlIdx] : null;
        const pv = pvIdx >= 0 ? String(row[pvIdx] ?? '') : '';
        // Si una fila trae múltiples URLs, mantenemos el orden; NO deduplicamos
        // para que la cantidad se parezca a la de previews.
        const urls = this.parseDownloadUrls(dl, pv);
        all.push(...urls);
      }
      return all.filter(Boolean);
    } catch {
      db.close();
      return [];
    }
  }

  private extractDriveFileId(url: string): string | undefined {
    // /file/d/<id>/
    const m1 = url.match(/\/file\/d\/([^/?]+)/);
    if (m1?.[1]) return m1[1];
    // open?id=<id>  o  uc?id=<id>
    const m2 = url.match(/[?&]id=([^&]+)/);
    if (m2?.[1]) return m2[1];
    return undefined;
  }

  private extractDownloadUrl(previewUrl: string): string | undefined {
    const id = this.extractDriveFileId(previewUrl);
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
    return undefined;
  }

  private parseDownloadUrls(rawDownloadUrl: unknown, previewUrl: string): string[] {
    const fallback = this.extractDownloadUrl(previewUrl);
    if (rawDownloadUrl == null || String(rawDownloadUrl).trim() === '') {
      return fallback ? [fallback] : [];
    }

    const raw = String(rawDownloadUrl).trim();

    // Permite: JSON ["url1","url2"], o separados por |, coma, salto de línea, espacios.
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          const urls = arr
            .map((v) => String(v ?? '').trim())
            .filter((v) => v.startsWith('http://') || v.startsWith('https://'));
          if (urls.length) return Array.from(new Set(urls));
        }
      } catch {
        // cae al split de abajo
      }
    }

    const parts = raw
      .split(/[\n\r|,;\t ]+/g)
      .map((v) => v.trim())
      .filter(Boolean);

    // 1) URLs http(s)
    const urls = parts.filter((v) => v.startsWith('http://') || v.startsWith('https://'));
    if (urls.length) return urls;

    // 2) IDs sueltos de Drive
    const ids = parts
      .filter((v) => /^[a-zA-Z0-9_-]{10,}$/.test(v))
      .map((id) => `https://drive.google.com/uc?export=download&id=${id}`);
    if (ids.length) return ids;

    return fallback ? [fallback] : [];
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

  /** Lee la vista v_movies_catalog; una fila por película (name+year), un solo link. */
  async getMovies(): Promise<Movie[]> {
    const db = await this.openDb();
    try {
      const result = db.exec(
        `SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY name, year ORDER BY upload_date DESC NULLS LAST, name, year) AS rn
          FROM ${CATALOG_VIEW} WHERE${FILE_SIZE_FILTER}
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

  /** Mapea una fila de v_movies_catalog (name, year, quality, url_poster, url, source, preview; opcional id, upload_date) a Movie. */
  private rowToMovie(
    columns: string[],
    row: (string | number | null)[],
    index: number
  ): Movie {
    const raw: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      raw[col] = row[i];
    });
    const originalName = String(raw['name'] ?? '');
    const name = raw['short_title'] != null && String(raw['short_title']).trim() !== ''
      ? String(raw['short_title'])
      : originalName;
    const year = Number(raw['year'] ?? 0);
    const rawSize = raw['file_size'];
    const fileSize = rawSize != null && String(rawSize).toLowerCase().trim() !== 'fail'
      ? String(rawSize)
      : undefined;
    const uploadDate = raw['upload_date'] != null ? String(raw['upload_date']) : undefined;
    const previewUrl = String(raw['preview'] ?? '');
    const downloadUrls = this.parseDownloadUrls(raw['download_url'], previewUrl);
    const downloadUrl = downloadUrls[0];
    return {
      id: raw['id'] != null ? String(raw['id']) : `movie-${index}`,
      title: name,
      originalName,
      year,
      quality: String(raw['quality'] ?? ''),
      poster: raw['url_poster'] != null ? String(raw['url_poster']) : undefined,
      videoUrl: previewUrl,
      downloadUrl,
      downloadUrls: downloadUrls.length ? downloadUrls : undefined,
      uploadDate,
      fileSize,
    };
  }
}
