import { Body, Controller, Delete, Get, Param, Put, Req } from "@nestjs/common";
import { assertLocal } from "../tools/tools.controller";
import { KeysService } from "./keys.service";

type Req0 = Parameters<typeof assertLocal>[0];

/** Chaves privadas avulsas (Configuracoes). So a propria maquina/Studio; nenhuma resposta traz um valor. */
@Controller("integrations/keys")
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  @Get()
  list(@Req() req: Req0) {
    assertLocal(req);
    return this.keys.list();
  }

  @Put()
  save(@Req() req: Req0, @Body() body: { name?: unknown; value?: unknown }) {
    assertLocal(req);
    return this.keys.save(body ?? {});
  }

  @Delete(":name")
  remove(@Req() req: Req0, @Param("name") name: string) {
    assertLocal(req);
    return this.keys.remove(name);
  }
}
