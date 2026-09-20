import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env") });
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.SERVER_PORT ?? 5100);
  // A API nao tem senha: so a propria maquina alcanca (como o servico de terminal). Para acessar de outro computador use um
  // tunel SSH (ssh -L 5100:localhost:5100 …); SERVER_HOST=0.0.0.0 abre para a rede por sua conta e risco.
  const host = process.env.SERVER_HOST?.trim() || "127.0.0.1";
  await app.listen(port, host);
  console.log(`[agent-canvas] servidor em http://localhost:${port} (escutando em ${host})`);
}

bootstrap();
