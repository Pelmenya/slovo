
import {Prisma,RunStatus} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {AgentSession} from '../../agent-session/entities/agent-session.entity'
import {RunEvent} from '../../run-event/entities/run-event.entity'
import {RunSnapshot} from '../../run-snapshot/entities/run-snapshot.entity'
import {Permission} from '../../permission/entities/permission.entity'


export class AgentRun {
  id: string ;
sessionId: string ;
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
session?: AgentSession ;
events?: RunEvent[] ;
snapshots?: RunSnapshot[] ;
permissions?: Permission[] ;
}
