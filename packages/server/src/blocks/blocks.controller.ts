import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { BlocksService } from "./blocks.service";
import { ThemeService } from "./theme.service";

type Body_ = Record<string, unknown>;

@Controller("blocks")
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  list() {
    return this.blocks.list();
  }

  /** Devolve o componente + `warnings` (design fora do padrao, permissoes faltando, APIs bloqueadas). */
  @Post()
  create(@Body() body: Body_) {
    const b = this.blocks.create(body ?? {});
    return { ...b, warnings: this.blocks.lint(b) };
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.blocks.get(id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: Body_) {
    const b = this.blocks.update(id, body ?? {});
    return { ...b, warnings: this.blocks.lint(b) };
  }

  @Get(":id/lint")
  lint(@Param("id") id: string) {
    return { warnings: this.blocks.lint(this.blocks.get(id)) };
  }

  /** Aprovar e a decisao do usuario sobre as permissoes do bloco (o agente nunca aprova). */
  @Patch(":id/approve")
  approve(@Param("id") id: string, @Body() body: { approved?: unknown }) {
    if (typeof body?.approved !== "boolean") throw new BadRequestException("approved deve ser true ou false");
    return this.blocks.approve(id, body.approved);
  }

  @Get(":id/inbox")
  inbox(@Param("id") id: string) {
    this.blocks.get(id);
    return this.blocks.inbox(id);
  }

  // estado proprio do componente (ctx.store)
  @Get(":id/state")
  state(@Param("id") id: string) {
    this.blocks.get(id);
    return this.blocks.getState(id);
  }

  @Put(":id/state/:key")
  setState(@Param("id") id: string, @Param("key") key: string, @Body() body: { value?: unknown }) {
    this.blocks.get(id);
    return this.blocks.setState(id, key, body?.value ?? null);
  }

  @Delete(":id/state/:key")
  removeState(@Param("id") id: string, @Param("key") key: string) {
    this.blocks.get(id);
    return this.blocks.removeState(id, key);
  }

  // historico do design/codigo
  @Get(":id/versions")
  versions(@Param("id") id: string) {
    return this.blocks.versions(id);
  }

  @Get(":id/versions/:versionId")
  version(@Param("id") id: string, @Param("versionId") versionId: string) {
    return this.blocks.version(id, versionId);
  }

  @Post(":id/versions/:versionId/restore")
  restore(@Param("id") id: string, @Param("versionId") versionId: string) {
    return this.blocks.restore(id, versionId);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.blocks.remove(id);
  }
}

/** Design tokens do Studio (valem para todos os componentes e para o app). */
@Controller("theme")
export class ThemeController {
  constructor(private readonly theme: ThemeService) {}

  @Get()
  get() {
    return this.theme.get();
  }

  @Put()
  set(@Body() body: Body_) {
    return this.theme.set(body ?? {});
  }
}
