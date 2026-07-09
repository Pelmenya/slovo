
import {Prisma,RunStatus} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsDecimal,IsIn,IsNotEmpty,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateAgentRunDto {
  @IsOptional()
@IsString()
parentRunId?: string;
@IsOptional()
@IsString()
resumedFromRunId?: string;
@IsNotEmpty()
@IsString()
goal: string;
@ApiProperty({
  enum: RunStatus,
})
@IsNotEmpty()
@IsIn(["created","planning","awaiting_permission","executing","done","failed","aborted","aborted_by_timeout"])
status: RunStatus;
@ApiProperty({
  type: `number`,
  format: `double`,
})
@IsNotEmpty()
@IsDecimal()
@Type(()=>String)
budgetCapUsd: Prisma.Decimal;
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
finishedAt?: Date;
}
