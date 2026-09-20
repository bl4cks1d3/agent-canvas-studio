import { Global, Module } from "@nestjs/common";
import { ChangesService } from "./changes.service";
import { EventsController } from "./events.controller";

@Global()
@Module({ controllers: [EventsController], providers: [ChangesService], exports: [ChangesService] })
export class EventsModule {}
