
import {Prisma,RunEventType} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class RunEventDto {
  @ApiProperty({
  type: `integer`,
  format: `int64`,
})
id: bigint ;
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
}
