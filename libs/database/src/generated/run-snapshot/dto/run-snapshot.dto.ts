
import {Prisma} from '@prisma/client'
import {ApiProperty} from '@nestjs/swagger'


export class RunSnapshotDto {
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
}
