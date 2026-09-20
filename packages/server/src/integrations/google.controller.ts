import { Body, Controller, Delete, Get, Post, Req } from "@nestjs/common";
import { assertLocal } from "../tools/tools.controller";
import { GoogleService } from "./google.service";

type Req0 = Parameters<typeof assertLocal>[0];

/** Conexao da conta Google (Agenda, Gmail, Tasks). So a propria maquina/Studio: mexe em .env e .mcp.json. */
@Controller("integrations/google")
export class GoogleController {
  constructor(private readonly google: GoogleService) {}

  @Get()
  status(@Req() req: Req0) {
    assertLocal(req);
    return this.google.status();
  }

  @Post("setup")
  setup(@Req() req: Req0, @Body() body: { email?: unknown; clientId?: unknown; clientSecret?: unknown }) {
    assertLocal(req);
    return this.google.setup(body);
  }

  @Post("refresh")
  refresh(@Req() req: Req0) {
    assertLocal(req);
    return this.google.refresh();
  }

  @Post("authorize")
  authorize(@Req() req: Req0) {
    assertLocal(req);
    return this.google.authorize();
  }

  @Post("test")
  test(@Req() req: Req0) {
    assertLocal(req);
    return this.google.test();
  }

  @Delete()
  disconnect(@Req() req: Req0) {
    assertLocal(req);
    return this.google.disconnect();
  }
}
