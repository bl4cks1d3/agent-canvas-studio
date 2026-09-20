import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { PagesService } from "./pages.service";

type Body_ = Record<string, unknown>;

@Controller("pages")
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get()
  list() {
    return this.pages.list();
  }

  @Post()
  create(@Body() body: Body_) {
    return this.pages.create(body ?? {});
  }

  @Put("order")
  reorder(@Body() body: { ids?: unknown }) {
    return this.pages.reorder(body?.ids);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.pages.get(id);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: Body_) {
    return this.pages.update(id, body ?? {});
  }

  @Post(":id/place")
  place(@Param("id") id: string, @Body() body: { blockId?: unknown; w?: unknown; h?: unknown }) {
    return this.pages.place(id, String(body?.blockId ?? ""), body ?? {});
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.pages.remove(id);
  }
}
