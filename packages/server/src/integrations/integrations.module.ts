import { Module } from "@nestjs/common";
import { CanvasesModule } from "../canvases/canvases.module";
import { PackagesModule } from "../packages/packages.module";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { GoogleController } from "./google.controller";
import { GoogleService } from "./google.service";
import { KeysController } from "./keys.controller";
import { KeysService } from "./keys.service";

@Module({
  imports: [CanvasesModule, PackagesModule],
  controllers: [GoogleController, AiController, KeysController],
  providers: [GoogleService, AiService, KeysService],
})
export class IntegrationsModule {}
