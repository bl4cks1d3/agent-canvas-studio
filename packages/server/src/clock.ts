/**
 * Relogio do Studio, sempre no fuso LOCAL da maquina (o do usuario). Os carimbos internos (createdAt/updatedAt) continuam em UTC
 * (padrao ISO, ordenavel); tudo que aparece ao usuario ou preenche um campo usa isto, para nao misturar os dois fusos.
 */
const pad = (n: number, size = 2) => String(Math.abs(n)).padStart(size, "0");

export interface Clock {
  /** Instante em UTC (ISO, com Z): serve para ordenar e comparar. */
  utc: string;
  /** Data e hora locais com o deslocamento do fuso: 2026-09-20T14:11:37-03:00 */
  local: string;
  /** 2026-09-20 */
  date: string;
  /** 14:11 */
  time: string;
  /** domingo, segunda-feira... */
  weekday: string;
  /** America/Sao_Paulo */
  timezone: string;
  /** Deslocamento em minutos em relacao ao UTC (-180 = UTC-03:00). */
  offsetMinutes: number;
  /** Texto pronto para mostrar: "domingo, 20 de setembro de 2026 as 14:11" */
  text: string;
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Data/hora local com deslocamento (ISO 8601): mantem o instante exato e mostra a hora que o usuario ve. */
export function localIso(d = new Date()): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function clock(d = new Date()): Clock {
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "long" });
  return {
    utc: d.toISOString(),
    local: localIso(d),
    date: localDate(d),
    time: localTime(d),
    weekday,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMinutes: -d.getTimezoneOffset(),
    text: `${d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} às ${localTime(d)}`,
  };
}
