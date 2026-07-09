
import {Prisma} from '@prisma/client'
import {Type} from 'class-transformer'
import {IsInt,IsNotEmpty} from 'class-validator'
import {ApiProperty,getSchemaPath} from '@nestjs/swagger'




export class CreateRunSnapshotDto {
  @ApiProperty({
  type: `integer`,
  format: `int32`,
})
@IsNotEmpty()
@IsInt()
seq: number;
@IsNotEmpty()
state: Prisma.InputJsonValue;
}
