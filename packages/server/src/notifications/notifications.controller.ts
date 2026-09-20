import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Sse } from "@nestjs/common";
import { interval, map, merge, type Observable } from "rxjs";
import { assertLocal } from "../tools/tools.controller";
import { desktopSupported, showDesktop } from "./desktop-notifier";
import { NotificationsService } from "./notifications.service";

interface MessageEvent {
  data: string | object;
  type?: string;
}

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.notifications.list(Number(limit) || 50);
  }

  /** Canal de eventos do Studio: cada aviso novo chega como mensagem; "ping" so mantem a conexao aberta. */
  @Sse("stream")
  stream(): Observable<MessageEvent> {
    const novas = this.notifications.created.pipe(map((n): MessageEvent => ({ data: n })));
    const ping = interval(25_000).pipe(map((): MessageEvent => ({ type: "ping", data: "" })));
    return merge(novas, ping);
  }

  /** Preferencias de entrega (som e modo desktop). */
  @Get("settings")
  settings() {
    return { ...this.notifications.getSettings(), platform: process.platform, desktopSupported: desktopSupported() };
  }

  @Put("settings")
  saveSettings(@Req() req: Parameters<typeof assertLocal>[0], @Body() body: { desktop?: unknown; sound?: unknown }) {
    assertLocal(req);
    return { ...this.notifications.setSettings(body ?? {}), platform: process.platform, desktopSupported: desktopSupported() };
  }

  /** Mostra uma notificacao nativa agora e diz se funcionou (nao cria aviso no sino). */
  @Post("desktop-test")
  async desktopTest(@Req() req: Parameters<typeof assertLocal>[0]) {
    assertLocal(req);
    try {
      await showDesktop({ title: "Agent Canvas", message: "Notificação de desktop funcionando.", level: "ok" }, this.notifications.getSettings().sound);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  @Post()
  create(@Req() req: Parameters<typeof assertLocal>[0], @Body() body: { title?: unknown; message?: unknown; level?: unknown; source?: unknown }) {
    assertLocal(req);
    return this.notifications.create({ ...body, source: body?.source ?? "api" });
  }

  @Post("read")
  read(@Req() req: Parameters<typeof assertLocal>[0], @Body() body: { ids?: unknown }) {
    assertLocal(req);
    return this.notifications.markRead(Array.isArray(body?.ids) ? body.ids.map(String) : undefined);
  }

  @Delete()
  clear(@Req() req: Parameters<typeof assertLocal>[0]) {
    assertLocal(req);
    return this.notifications.clear();
  }

  @Delete(":id")
  remove(@Req() req: Parameters<typeof assertLocal>[0], @Param("id") id: string) {
    assertLocal(req);
    return this.notifications.remove(id);
  }
}
