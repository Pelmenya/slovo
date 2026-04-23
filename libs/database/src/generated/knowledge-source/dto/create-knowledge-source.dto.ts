
import {Prisma,KnowledgeSourceType} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsIn,IsNotEmpty,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateKnowledgeSourceDto {
  @IsOptional()
@IsString()
userId?: string;
@ApiProperty({
  enum: KnowledgeSourceType,
})
@IsNotEmpty()
@IsIn(["text","video","audio","pdf","docx","youtube","article"])
sourceType: KnowledgeSourceType;
@IsOptional()
@IsString()
title?: string;
@IsOptional()
@IsString()
storageKey?: string;
@IsOptional()
@IsString()
sourceUrl?: string;
@IsOptional()
@IsString()
rawText?: string;
@IsOptional()
@IsString()
extractedText?: string;
@IsOptional()
metadata?: Prisma.InputJsonValue;
@IsOptional()
@IsString()
error?: string;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
startedAt?: Date;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
@IsOptional()
@IsRFC3339()
completedAt?: Date;
}
