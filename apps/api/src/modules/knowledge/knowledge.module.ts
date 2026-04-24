import { Module } from '@nestjs/common';
import { DatabaseModule } from '@slovo/database';
import { StorageModule } from '@slovo/storage';

// Phase 1 (PR4+): CRUD + text-ingestion endpoint.
// Phase 2 (PR5+): Flowise upsert интеграция + worker для video/pdf адаптеров.
// См. docs/features/knowledge-base.md.
@Module({
    imports: [DatabaseModule, StorageModule],
})
export class KnowledgeModule {}
