import { Module } from '@nestjs/common';
import { createAppConfigModule, createAppLoggerModule } from '@slovo/common';

@Module({
    imports: [createAppConfigModule(), createAppLoggerModule()],
})
export class WorkerModule {}
