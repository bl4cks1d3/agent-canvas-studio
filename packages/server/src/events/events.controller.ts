import { Controller, Sse } from "@nestjs/common";
import { interval, map, merge, type Observable } from "rxjs";
import { ChangesService } from "./changes.service";

interface MessageEvent {
  data: string | object;
  type?: string;
}

@Controller("events")
export class EventsController {
  constructor(private readonly changes: ChangesService) {}

  /** Canal de eventos da tela: cada mudanca chega como {type, key?}; "ping" so mantem a conexao aberta. */
  @Sse()
  stream(): Observable<MessageEvent> {
    const mudancas = this.changes.stream.pipe(map((c): MessageEvent => ({ data: c })));
    const ping = interval(25_000).pipe(map((): MessageEvent => ({ type: "ping", data: "" })));
    return merge(mudancas, ping);
  }
}
