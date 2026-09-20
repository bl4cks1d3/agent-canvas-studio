import { Body, Controller, ForbiddenException, Get, Param, Post, Req } from "@nestjs/common";
import { BuilderService } from "./builder.service";

interface Request {
  socket: { remoteAddress?: string };
  headers: { origin?: string | string[] };
}

function allowedOrigins(): Set<string> {
  const extra = (process.env.TOOLS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set(["http://localhost:5200", "http://127.0.0.1:5200", ...extra]);
}

/** Roda o Claude Code no seu computador: so a propria maquina e, de navegador, so o Studio. */
function assertLocal(req: Request): void {
  const addr = req.socket.remoteAddress ?? "";
  if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") throw new ForbiddenException("so aceita chamadas da propria maquina");
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (origin && !allowedOrigins().has(origin)) throw new ForbiddenException("origem nao permitida");
}

@Controller("builder")
export class BuilderController {
  constructor(private readonly builder: BuilderService) {}

  @Get("status")
  status(@Req() req: Request) {
    assertLocal(req);
    return this.builder.status();
  }

  @Get("runs")
  list(@Req() req: Request) {
    assertLocal(req);
    return this.builder.list();
  }

  @Post("runs")
  start(@Req() req: Request, @Body() body: { prompt?: unknown; pageId?: unknown }) {
    assertLocal(req);
    return this.builder.start(body?.prompt, body?.pageId);
  }

  @Get("runs/:id")
  get(@Req() req: Request, @Param("id") id: string) {
    assertLocal(req);
    return this.builder.get(id);
  }

  @Post("runs/:id/cancel")
  cancel(@Req() req: Request, @Param("id") id: string) {
    assertLocal(req);
    return this.builder.cancel(id);
  }
}
