import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req } from "@nestjs/common";
import { ToolRegistry } from "./tool-registry";

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

/** Ferramentas agem direto (sem LLM): so aceitam a propria maquina e, de navegador, so o Studio (Origin conhecida). */
export function assertLocal(req: Request): void {
  const addr = req.socket.remoteAddress ?? "";
  if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") throw new ForbiddenException("so aceita chamadas da propria maquina");
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (origin && !allowedOrigins().has(origin)) throw new ForbiddenException("origem nao permitida");
}

@Controller("tools")
export class ToolsController {
  constructor(private readonly tools: ToolRegistry) {}

  @Get()
  list(@Req() req: Request) {
    assertLocal(req);
    return this.tools.list();
  }

  @Post("reload")
  async reload(@Req() req: Request) {
    assertLocal(req);
    const servers = await this.tools.reloadMcp();
    return { servers, tools: this.tools.list().length };
  }

  /** Usado pela ponte dos blocos (que ja conferiu as permissoes do bloco no navegador). */
  @Post("call")
  async call(@Req() req: Request, @Body() body: { name?: unknown; args?: unknown }) {
    assertLocal(req);
    if (typeof body?.name !== "string" || !body.name) throw new BadRequestException("name e obrigatorio");
    if (!this.tools.list().some((t) => t.name === body.name)) throw new BadRequestException(`ferramenta desconhecida: ${body.name}`);
    try {
      return { result: await this.tools.call(body.name, body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {}) };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }
}
