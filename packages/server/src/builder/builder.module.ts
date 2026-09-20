import { Module } from "@nestjs/common";
import { BlocksModule } from "../blocks/blocks.module";
import { DataModule } from "../data/data.module";
import { PagesModule } from "../pages/pages.module";
import { BuilderController } from "./builder.controller";
import { BuilderService } from "./builder.service";

@Module({
  imports: [BlocksModule, DataModule, PagesModule],
  controllers: [BuilderController],
  providers: [BuilderService],
})
export class BuilderModule {}
