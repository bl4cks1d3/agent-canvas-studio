import { Module } from "@nestjs/common";
import { BlocksModule } from "../blocks/blocks.module";
import { DataModule } from "../data/data.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { McpManager } from "../tools/mcp-manager";
import { ToolRegistry } from "../tools/tool-registry";
import { ToolsController } from "../tools/tools.controller";
import { CanvasesController } from "./canvases.controller";
import { CanvasesService } from "./canvases.service";

@Module({
  imports: [DataModule, BlocksModule, NotificationsModule],
  controllers: [CanvasesController, ToolsController],
  providers: [McpManager, ToolRegistry, CanvasesService],
  exports: [CanvasesService, ToolRegistry],
})
export class CanvasesModule {}
