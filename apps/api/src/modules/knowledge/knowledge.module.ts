import { Module } from '@nestjs/common';
import { DatabaseModule } from '@slovo/database';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

// Phase 1 (PR4): CRUD + text-ingestion endpoint (синхронно, без worker'а).
// Phase 2 (PR5+): StorageModule вернётся (video/pdf blob lifecycle),
// плюс Flowise upsert интеграция + worker для тяжёлых адаптеров.
// См. docs/features/knowledge-base.md.
@Module({
    imports: [DatabaseModule],
    controllers: [KnowledgeController],
    providers: [KnowledgeService],
    exports: [KnowledgeService],
})
export class KnowledgeModule {}
