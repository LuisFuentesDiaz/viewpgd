import { Injectable } from '@angular/core';
import type { Movie } from '../models/movie';

const DB_PATH = 'assets/scrapgd.db';
const CATALOG_VIEW = 'v_movies_catalog';

@Injectable({ providedIn: 'root' })
export class DbService {
  private initSqlJs: typeof import('sql.js').default | null = null;
  /** Buffer de la BD cargada por el usuario; null = usar la BD por defecto (assets). */
  private customDbBuffer: ArrayBuffer | null = null;

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

  /** Usa la base de datos por defecto (assets) en la próxima lectura. */
  useDefaultDb(): void {
    this.customDbBuffer = null;
  }

  /** Carga una base de datos desde un archivo elegido por el usuario. */
  async loadCustomDb(file: File): Promise<void> {
    const buffer = await file.arrayBuffer();
    this.customDbBuffer = buffer;
  }

  /** Lee la vista v_movies_catalog y devuelve los registros como Movie[]. Usa BD por defecto o la cargada por el usuario. */
  async getMovies(): Promise<Movie[]> {
    const initSqlJs = await this.loadSqlJs();
    const SQL = await initSqlJs({
      locateFile: (file: string) => `/${file}`,
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
