import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { DataService } from "./data.service";

type Body_ = Record<string, unknown>;

@Controller("collections")
export class DataController {
  constructor(private readonly data: DataService) {}

  @Get()
  list() {
    return this.data.listCollections();
  }

  @Post()
  create(@Body() body: Body_) {
    return this.data.createCollection(body ?? {});
  }

  @Get(":name")
  get(@Param("name") name: string) {
    return this.data.getCollection(name);
  }

  @Patch(":name")
  update(@Param("name") name: string, @Body() body: Body_) {
    return this.data.updateCollection(name, body ?? {});
  }

  @Delete(":name")
  remove(@Param("name") name: string) {
    return this.data.removeCollection(name);
  }

  /** Filtros: ?campo=valor (igualdade), q (busca), sort, order, limit, offset. */
  @Get(":name/records")
  listRecords(@Param("name") name: string, @Query() query: Record<string, string | undefined>) {
    return this.data.listRecords(name, query);
  }

  @Post(":name/records")
  createRecord(@Param("name") name: string, @Body() body: Body_) {
    return this.data.createRecord(name, body ?? {});
  }

  /** Varias operacoes de uma vez, tudo ou nada: { create: [...], update: [{id, data}], delete: [ids] }. */
  @Post(":name/records/batch")
  batch(@Param("name") name: string, @Body() body: Body_) {
    return this.data.batchRecords(name, body ?? {});
  }

  /** Registros apagados (30 dias). */
  @Get(":name/trash")
  trash(@Param("name") name: string) {
    return this.data.listTrash(name);
  }

  /** Esvazia a lixeira da colecao (irreversivel). */
  @Delete(":name/trash")
  purgeAll(@Param("name") name: string) {
    return this.data.purgeTrash(name);
  }

  @Delete(":name/trash/:id")
  purgeOne(@Param("name") name: string, @Param("id") id: string) {
    return this.data.purgeTrash(name, id);
  }

  @Post(":name/records/:id/restore")
  restoreRecord(@Param("name") name: string, @Param("id") id: string) {
    return this.data.restoreRecord(name, id);
  }

  @Patch(":name/records/:id")
  updateRecord(@Param("name") name: string, @Param("id") id: string, @Body() body: Body_) {
    return this.data.updateRecord(name, id, body ?? {});
  }

  @Delete(":name/records/:id")
  removeRecord(@Param("name") name: string, @Param("id") id: string) {
    return this.data.removeRecord(name, id);
  }
}
