import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { PackagesService } from "./packages.service";

@Controller("packages")
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  list() {
    return this.packages.list();
  }

  /** Salva um pacote criado (o Claude via MCP ou importado). Nao instala: o usuario decide. */
  @Post()
  save(@Body() body: Record<string, unknown>) {
    const source = body?.source === "agent" ? "agent" : "user";
    const { source: _s, ...manifest } = body ?? {};
    return this.packages.saveCustom(manifest, source);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.packages.get(id);
  }

  @Post(":id/install")
  install(@Param("id") id: string) {
    return this.packages.install(id);
  }

  @Delete(":id")
  uninstall(@Param("id") id: string, @Query("dropData") dropData?: string) {
    return this.packages.uninstall(id, dropData === "true");
  }

  @Put(":id/connections")
  connect(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.packages.connect(id, body ?? {});
  }

  @Delete(":id/definition")
  removeDefinition(@Param("id") id: string) {
    return this.packages.removeCustom(id);
  }
}
