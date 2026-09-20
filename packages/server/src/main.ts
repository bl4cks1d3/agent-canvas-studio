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
  await app.listen(port);
  console.log(`[agent-canvas] servidor em http://localhost:${port}`);
}

bootstrap();
