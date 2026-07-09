
import {Prisma,RunStatus} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsDecimal,IsIn,IsOptional,IsRFC3339,IsString} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateAgentRunDto {
  @IsOptional()
@IsString()
parentRunId?: string;
@IsOptional()
@IsString()
resumedFromRunId?: string;
@IsOptional()
@IsString()
goal?: string;
@ApiProperty({
  enum: RunStatus,
})
@IsOptional()
@IsIn(["created","planning","awaiting_permission","executing","done","failed","aborted","aborted_by_timeout"])
status?: RunStatus;
@ApiProperty({
  type: `number`,
  format: `double`,
})
@IsOptional()
@IsDecimal()
@Type(()=>String)
budgetCapUsd?: Prisma.Decimal;
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
