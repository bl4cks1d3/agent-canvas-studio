import { Module } from "@nestjs/common";
import { CanvasesModule } from "../canvases/canvases.module";
import { DataModule } from "../data/data.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RemindersService } from "./reminders.service";

@Module({
  imports: [DataModule, NotificationsModule, CanvasesModule],
  providers: [RemindersService],
})
export class RemindersModule {}
