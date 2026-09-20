import { Module } from "@nestjs/common";
import { DataModule } from "../data/data.module";
import { BlocksController, ThemeController } from "./blocks.controller";
import { BlocksService } from "./blocks.service";
import { ThemeService } from "./theme.service";

@Module({
  imports: [DataModule],
  controllers: [BlocksController, ThemeController],
  providers: [BlocksService, ThemeService],
  exports: [BlocksService, ThemeService],
})
export class BlocksModule {}
