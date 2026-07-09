
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsInt,IsOptional} from 'class-validator'
import {ApiProperty} from '@nestjs/swagger'




export class UpdateRunSnapshotDto {
  @ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsOptional()
@IsInt()
seq?: number;
@IsOptional()
state?: Prisma.InputJsonValue;
}
