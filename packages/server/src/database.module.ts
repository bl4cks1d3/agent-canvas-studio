import { Global, Module } from "@nestjs/common";
import { openDatabase } from "./db";

export const CANVAS_DB = Symbol("CANVAS_DB");

@Global()
@Module({
  providers: [{ provide: CANVAS_DB, useFactory: () => openDatabase() }],
  exports: [CANVAS_DB],
})
export class DatabaseModule {}
