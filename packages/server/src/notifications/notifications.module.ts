import { Module } from "@nestjs/common";
import { DesktopNotifier } from "./desktop-notifier";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, DesktopNotifier],
  exports: [NotificationsService],
})
export class NotificationsModule {}
