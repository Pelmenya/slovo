import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { createAppConfigModule, createAppLoggerModule } from '@slovo/common';
import { CatalogRefreshModule } from './modules/catalog-refresh/catalog-refresh.module';

@Module({
    imports: [
        createAppConfigModule(),
        createAppLoggerModule(),
        ScheduleModule.forRoot(),
        CatalogRefreshModule,
    ],
})
export class WorkerModule {}
