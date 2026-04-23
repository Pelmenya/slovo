
import {Prisma,KnowledgeSourceType,KnowledgeSourceStatus} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class KnowledgeSourceDto {
  id: string ;
userId: string  | null;
@ApiProperty({
  enum: KnowledgeSourceType,
})
sourceType: KnowledgeSourceType ;
@ApiProperty({
  enum: KnowledgeSourceStatus,
})
status: KnowledgeSourceStatus ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
progress: number ;
title: string  | null;
storageKey: string  | null;
sourceUrl: string  | null;
rawText: string  | null;
extractedText: string  | null;
metadata: Prisma.JsonValue  | null;
error: string  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
createdAt: Date ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
updatedAt: Date ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
startedAt: Date  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
completedAt: Date  | null;
}
