import { Module } from "@nestjs/common";
import { BlocksModule } from "../blocks/blocks.module";
import { PagesController } from "./pages.controller";
import { PagesService } from "./pages.service";

@Module({
  imports: [BlocksModule],
  controllers: [PagesController],
  providers: [PagesService],
  exports: [PagesService],
})
export class PagesModule {}
