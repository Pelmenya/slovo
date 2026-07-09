
import {ApiProperty} from '@nestjs/swagger'
import {AgentRun} from '../../agent-run/entities/agent-run.entity'


export class AgentSession {
  id: string ;
userId: string  | null;
title: string  | null;
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
runs?: AgentRun[] ;
}
