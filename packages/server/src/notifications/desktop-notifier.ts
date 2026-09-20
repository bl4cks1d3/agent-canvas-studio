import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { spawn } from "node:child_process";
import type { Subscription } from "rxjs";
import { NotificationsService, type AppNotification } from "./notifications.service";

/**
 * Toast nativo do Windows (WinRT via PowerShell, sem instalar nada). Titulo/mensagem chegam por variaveis de ambiente e sao
 * escapados como XML: nada do texto vira comando. O AppId e o do proprio PowerShell (o Windows so mostra toast de app registrado).
 * Sons do sistema: Default (info/ok) e Reminder (aviso/erro); sem som = <audio silent>.
 */
const WINDOWS_TOAST = `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$t = [System.Security.SecurityElement]::Escape($env:AC_TITLE)
$m = [System.Security.SecurityElement]::Escape($env:AC_MSG)
if ($env:AC_SOUND -eq '1') { $audio = '<audio src="ms-winsoundevent:' + $env:AC_SOUND_EVENT + '"/>' } else { $audio = '<audio silent="true"/>' }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>' + $t + '</text><text>' + $m + '</text></binding></visual>' + $audio + '</toast>')
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)
`;

const MAC_TOAST = 'display notification (system attribute "AC_MSG") with title (system attribute "AC_TITLE")';

export const desktopSupported = (): boolean => ["win32", "darwin", "linux"].includes(process.platform);

const soundEvent = (level: string) => (level === "warn" || level === "error" ? "Notification.Reminder" : level === "ok" ? "Notification.IM" : "Notification.Default");

/** Mostra a notificacao no sistema e espera o processo terminar (falha vira erro, para o teste da tela mostrar o motivo). */
export function showDesktop(n: { title: string; message: string; level: string }, sound: boolean): Promise<void> {
  const env = { ...process.env, AC_TITLE: n.title, AC_MSG: n.message || " ", AC_SOUND: sound ? "1" : "0", AC_SOUND_EVENT: soundEvent(n.level) };
  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {
    cmd = "powershell.exe";
    args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(WINDOWS_TOAST, "utf16le").toString("base64")];
  } else if (process.platform === "darwin") {
    cmd = "osascript";
    args = ["-e", sound ? `${MAC_TOAST} sound name "Glass"` : MAC_TOAST];
  } else if (process.platform === "linux") {
    cmd = "notify-send";
    args = ["--app-name=Agent Canvas", n.title, n.message || " "];
  } else {
    return Promise.reject(new Error(`notificação de desktop não suportada em ${process.platform}`));
  }
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => (err += String(d)));
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error("a notificação do sistema demorou demais (15 s)"));
    }, 15_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      fail(new Error(e.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else fail(new Error(err.trim().split(/\r?\n/)[0]?.slice(0, 300) || `saiu com código ${code}`));
    });
  });
}

/**
 * "Modo desktop": com a opcao ligada, cada aviso (ferramenta notify, no Notificar, lembretes) tambem vira notificacao nativa do
 * sistema, com o som do sistema — mesmo com o navegador fechado. O Studio deixa de tocar som/notificar por conta propria (sem duplicar).
 */
@Injectable()
export class DesktopNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DesktopNotifier.name);
  private sub?: Subscription;

  constructor(private readonly notifications: NotificationsService) {}

  onModuleInit(): void {
    this.sub = this.notifications.created.subscribe((n: AppNotification) => {
      const s = this.notifications.getSettings();
      if (!s.desktop) return;
      showDesktop(n, s.sound).catch((e) => this.logger.warn(`notificação de desktop falhou: ${e instanceof Error ? e.message : e}`));
    });
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
  }
}
