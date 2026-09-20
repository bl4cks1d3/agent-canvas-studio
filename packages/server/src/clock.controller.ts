import { Controller, Get } from "@nestjs/common";
import { clock } from "./clock";

/** O relogio do Studio (fuso local da maquina): o Claude e os componentes consultam aqui em vez de chamar `date` no terminal. */
@Controller("clock")
export class ClockController {
  @Get()
  now() {
    return clock();
  }
}
