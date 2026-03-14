declare module 'sql.js' {
  interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }
  interface QueryExecResult {
    columns: string[];
    values: (string | number | null)[][];
  }
  interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): QueryExecResult[];
    close(): void;
  }
  interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}
