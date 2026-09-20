import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { CanvasesService } from "./canvases.service";

type Body_ = Record<string, unknown>;

@Controller()
export class CanvasesController {
  constructor(private readonly canvases: CanvasesService) {}

  @Get("health")
  health() {
    return { ok: true, service: "agent-canvas-server" };
  }

  /** Tipos de no, ferramentas, provedores e Claude Code: o que o editor e o MCP precisam para montar. */
  @Get("catalog")
  catalog() {
    return this.canvases.catalog();
  }

  @Get("canvases")
  list() {
    return this.canvases.list();
  }

  @Post("canvases")
  create(@Body() body: Body_) {
    return this.canvases.create(body ?? {});
  }

  @Get("canvases/:id")
  get(@Param("id") id: string) {
    return this.canvases.get(id);
  }

  @Put("canvases/:id")
  update(@Param("id") id: string, @Body() body: Body_) {
    return this.canvases.update(id, body ?? {});
  }

  @Delete("canvases/:id")
  remove(@Param("id") id: string) {
    return this.canvases.remove(id);
  }

  @Post("canvases/:id/run")
  run(@Param("id") id: string, @Body() body: Body_) {
    return this.canvases.run(id, body ?? {});
  }

  @Get("canvases/:id/runs")
  runs(@Param("id") id: string, @Query("limit") limit?: string) {
    return this.canvases.runs(id, Number(limit) || 10);
  }

  @Get("runs/:runId")
  getRun(@Param("runId") runId: string) {
    return this.canvases.getRun(runId);
  }

  @Post("runs/:runId/cancel")
  cancel(@Param("runId") runId: string) {
    return this.canvases.cancel(runId);
  }
}
