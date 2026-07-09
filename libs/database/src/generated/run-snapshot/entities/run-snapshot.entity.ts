
import {Prisma} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {AgentRun} from '../../agent-run/entities/agent-run.entity'


export class RunSnapshot {
  runId: string ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
seq: number ;
state: Prisma.JsonValue ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
createdAt: Date ;
run?: AgentRun ;
}
