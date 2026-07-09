
import {Prisma,RunStatus} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class AgentRunDto {
  id: string ;
parentRunId: string  | null;
resumedFromRunId: string  | null;
goal: string ;
@ApiProperty({
  enum: RunStatus,
})
status: RunStatus ;
@ApiProperty({
  type: `number`,
  format: `double`,
})
budgetSpentUsd: Prisma.Decimal ;
@ApiProperty({
  type: `number`,
  format: `double`,
})
budgetCapUsd: Prisma.Decimal ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
createdAt: Date ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
startedAt: Date  | null;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
finishedAt: Date  | null;
}
