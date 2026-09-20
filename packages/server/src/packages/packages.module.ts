import { Module } from "@nestjs/common";
import { BlocksModule } from "../blocks/blocks.module";
import { CanvasesModule } from "../canvases/canvases.module";
import { DataModule } from "../data/data.module";
import { PagesModule } from "../pages/pages.module";
import { FactoryController, FactoryService } from "./factory.service";
import { PackagesController } from "./packages.controller";
import { PackagesService } from "./packages.service";

@Module({
  imports: [DataModule, BlocksModule, CanvasesModule, PagesModule],
  controllers: [PackagesController, FactoryController],
  providers: [PackagesService, FactoryService],
  exports: [PackagesService],
})
export class PackagesModule {}
