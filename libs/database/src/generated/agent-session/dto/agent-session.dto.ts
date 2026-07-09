
import {ApiProperty} from '@nestjs/swagger'


export class AgentSessionDto {
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
}
