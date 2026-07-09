
import {Prisma,RunEventType} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'
import {AgentRun} from '../../agent-run/entities/agent-run.entity'


export class RunEvent {
  @ApiProperty({
  type: `integer`,
  format: `int64`,
})
id: bigint ;
runId: string ;
@ApiProperty({
  type: `integer`,
  format: `int32`,
})
seq: number ;
@ApiProperty({
  enum: RunEventType,
})
type: RunEventType ;
payload: Prisma.JsonValue ;
@ApiProperty({
  type: `string`,
  format: `date-time`,
})
createdAt: Date ;
run?: AgentRun ;
}
