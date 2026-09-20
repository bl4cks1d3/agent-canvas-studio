import { Module } from "@nestjs/common";
import { CanvasesModule } from "./canvases/canvases.module";
import { ClockController } from "./clock.controller";
import { DatabaseModule } from "./database.module";
import { EventsModule } from "./events/events.module";
import { BuilderModule } from "./builder/builder.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PagesModule } from "./pages/pages.module";
import { PackagesModule } from "./packages/packages.module";
import { RemindersModule } from "./reminders/reminders.module";

@Module({ controllers: [ClockController], imports: [DatabaseModule, EventsModule, CanvasesModule, NotificationsModule, RemindersModule, PackagesModule, IntegrationsModule, PagesModule, BuilderModule] })
export class AppModule {}
