// Type declaration for the SQLCipher-capable drop-in replacement of
// better-sqlite3. The package ships the same runtime API as better-sqlite3
// but does not bundle its own types, so we re-export better-sqlite3's types
// here. This keeps the Database instance type-compatible with the type
// drizzle's better-sqlite3 driver expects.
declare module "better-sqlite3-multiple-ciphers" {
  import Database from "better-sqlite3";
  export = Database;
}
