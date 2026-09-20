import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

/** O que mudou: data (colecoes/registros), blocks (componentes), pages, canvases, packages, theme. `key` = colecao, id do componente... */
export type ChangeType = "data" | "blocks" | "pages" | "canvases" | "packages" | "theme";
export interface Change {
  type: ChangeType;
  key?: string;
}

const BATCH_MS = 80;

/**
 * Avisa a tela quando ALGO muda no banco, por quem for: o proprio app, o Claude (pelo MCP), um agente rodando um canvas ou uma
 * ferramenta. A tela assina GET /events e atualiza na hora, em vez de esperar a proxima consulta periodica.
 * Avisos iguais dentro de 80 ms viram um so (um agente que grava 20 registros gera 1 aviso, nao 20).
 */
@Injectable()
export class ChangesService {
  readonly stream = new Subject<Change>();
  private readonly pending = new Map<string, Change>();
  private timer?: NodeJS.Timeout;

  emit(type: ChangeType, key?: string): void {
    this.pending.set(`${type}:${key ?? ""}`, { type, key });
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const batch = [...this.pending.values()];
      this.pending.clear();
      for (const c of batch) this.stream.next(c);
    }, BATCH_MS);
  }
}
