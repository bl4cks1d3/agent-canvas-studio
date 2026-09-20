import { Body, Controller, Get, Param, Post, Put, Req } from "@nestjs/common";
import { assertLocal } from "../tools/tools.controller";
import { AiService } from "./ai.service";

type Req0 = Parameters<typeof assertLocal>[0];

/** "Provedores de IA" do menu lateral. So a propria maquina/Studio: grava chaves no .env; nenhuma resposta traz a chave. */
@Controller("integrations/ai")
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get()
  status(@Req() req: Req0) {
    assertLocal(req);
    return this.ai.status();
  }

  @Put("preferred")
  preferred(@Req() req: Req0, @Body() body: { preferred?: unknown }) {
    assertLocal(req);
    return this.ai.setPreferred(body?.preferred);
  }

  @Put(":provider")
  save(@Req() req: Req0, @Param("provider") provider: string, @Body() body: { apiKey?: unknown; model?: unknown; remove?: unknown }) {
    assertLocal(req);
    return this.ai.save(provider, body ?? {});
  }

  @Post(":provider/test")
  test(@Req() req: Req0, @Param("provider") provider: string, @Body() body: { model?: unknown }) {
    assertLocal(req);
    return this.ai.test(provider, body?.model);
  }

  @Get(":provider/models")
  models(@Req() req: Req0, @Param("provider") provider: string) {
    assertLocal(req);
    return this.ai.models(provider);
  }
}
