import { Module } from "@nestjs/common";
import { CanvasesModule } from "../canvases/canvases.module";
import { DataModule } from "../data/data.module";
import { PackagesModule } from "../packages/packages.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { GoogleController } from "./google.controller";
import { GoogleTasksController, GoogleTasksService } from "./google-tasks.service";
import { GoogleService } from "./google.service";
import { KeysController } from "./keys.controller";
import { KeysService } from "./keys.service";

@Module({
  imports: [CanvasesModule, DataModule, PackagesModule],
  controllers: [GoogleController, AiController, KeysController, GoogleTasksController],
  providers: [GoogleService, AiService, KeysService, GoogleTasksService],
})
export class IntegrationsModule {}
